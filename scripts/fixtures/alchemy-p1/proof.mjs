import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash, createHmac } from "node:crypto";
import { join, resolve } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Core from "alchemy/Test/Core";
// Pinned Alchemy's real providers; no replaced lifecycle or migration executor.
import { Database, DatabaseProvider } from "./node_modules/alchemy/lib/Cloudflare/D1/Database.js";
import { Worker } from "./node_modules/alchemy/lib/Cloudflare/Workers/Worker.js";
import { WorkerProvider } from "./node_modules/alchemy/lib/Cloudflare/Workers/WorkerProvider.js";
import { CloudflareEnvironment } from "./node_modules/alchemy/lib/Cloudflare/CloudflareEnvironment.js";
import { migrationsDirectory } from "@getquick/content/migrations";

assert.ok(migrationsDirectory.startsWith(resolve("node_modules")));
const names = [
  "0001_publications.sql",
  "0002_entries.sql",
  "0003_publication_events.sql",
  "0004_withdrawals.sql",
  "0005_reconciliation.sql",
];
const hashes = Object.fromEntries(
  names.map((name) => [
    name,
    createHash("sha256")
      .update(readFileSync(join(migrationsDirectory, name)))
      .digest("hex"),
  ]),
);
// Local providers need an account identity, but do not use a Cloudflare credential.
const environment = Layer.succeed(
  CloudflareEnvironment,
  Effect.succeed({
    type: "apiToken",
    apiToken: Redacted.make("local-unused"),
    accountId: "00000000000000000000000000000000",
    source: { type: "env" },
  }),
);
const providers = Layer.mergeAll(DatabaseProvider(), WorkerProvider()).pipe(
  Layer.provideMerge(environment),
);
const options = { providers, dev: true, sidecar: false, stage: "p1" };
const stack = Core.scratchStack(options, "content-installed-p1", "proof");
const eventSecret = "workerd-disposable-event-key-01234567890123456789";
const refreshToken = "workerd-disposable-refresh-key-01234567890123456789";
const event = (id, action, occurredAt) => ({
  site: "P1",
  id,
  action,
  occurredAt,
  entry: { id: "workerd-page-1", uri: "/entry/" },
});
const send = (url, event, offline = false) =>
  Effect.promise(async () => {
    const body = JSON.stringify(event),
      timestamp = String(Math.floor(Date.now() / 1000));
    const response = await fetch(new URL(offline ? "/gq/events?cms-offline" : "/gq/events", url), {
      method: "POST",
      body,
      headers: {
        "GQ-Event-Timestamp": timestamp,
        "GQ-Event-Signature":
          "v1=" +
          createHmac("sha256", eventSecret)
            .update(timestamp + "." + body)
            .digest("hex"),
      },
    });
    assert.equal(response.status, offline ? 503 : 200);
    assert.equal(response.headers.get("Cache-Control"), "no-store");
    return response.json();
  });
const program = (revision) =>
  Effect.gen(function* () {
    const db = yield* Database("Publications", {
      name: "content-installed-p1",
      migrations: migrationsDirectory,
    });
    const worker = yield* Worker("Frontend", {
      name: "content-installed-p1",
      main: "./worker.ts",
      env: {
        PUBLICATION_DB: db,
        REVISION: revision,
        PUBLICATION_EVENT_SECRET: eventSecret,
        FRONTEND_REFRESH_TOKEN: refreshToken,
      },
      // Latest supported by beta.79's pinned workerd (today's date is rejected).
      compatibility: { date: "2026-09-08" },
    });
    return { db, worker };
  });
const get = (url, method = "GET") =>
  Effect.promise(async () => {
    const response = await fetch(url, { method });
    assert.equal(response.status, 200);
    return response.json();
  });
try {
  await Core.run(
    Effect.gen(function* () {
      yield* stack.destroy(); // Recover an interrupted prior local proof, if present.
      const first = yield* stack.deploy(program("first"));
      assert.deepEqual(first.db.migrationsHashes, hashes);
      const empty = yield* get(first.worker.url);
      assert.equal(empty.ledger.length, 5);
      assert.deepEqual(Object.fromEntries(empty.ledger.map((row) => [row.name, row.hash])), hashes);
      for (const name of [
        "publications",
        "refresh_attempts",
        "publication_events",
        "withdrawals",
        "reconciliation",
      ])
        assert.ok(empty.tables.some((table) => table.name === name));
      assert.equal(empty.delivery.kind, "unavailable");
      const firstRead = yield* get(first.worker.url, "POST");
      assert.equal(firstRead.revision, "first");
      assert.equal(firstRead.delivery.kind, "found");
      assert.equal(firstRead.delivery.content.home.settings.title, "P1 durable Site");
      assert.deepEqual(firstRead.ledger, empty.ledger);
      console.log(
        "P1 first lifecycle: all five migrations precede the package-consuming Worker; stored delivery passes without CMS/secrets.",
      );
      const occurredAt = Date.now() - 1000;
      const publish = event("workerd-publish-0001", "publish", occurredAt);
      assert.equal((yield* send(first.worker.url, publish)).status, "refreshed");
      const found = yield* get(new URL("/entry/", first.worker.url));
      assert.equal(found.kind, "found");
      assert.equal(found.content.entry.content, "<p>Signed publication in workerd</p>");
      assert.equal(
        (yield* send(
          first.worker.url,
          event("workerd-withdraw-0001", "withdraw", occurredAt + 100),
        )).status,
        "withdrawn",
      );
      assert.equal((yield* get(new URL("/entry/", first.worker.url))).kind, "missing");
      const languageEvent = {
        site: "P1",
        id: "workerd-home-en",
        action: "publish",
        occurredAt: Date.now() - 500,
        entry: { id: "front-en", uri: "/en/", language: "en" },
      };
      assert.equal((yield* send(first.worker.url, languageEvent)).status, "refreshed");
      const settingsEvent = {
        site: "P1",
        id: "workerd-design",
        action: "settings",
        occurredAt: Date.now() - 300,
        setting: "design",
      };
      assert.equal((yield* send(first.worker.url, settingsEvent)).status, "refreshed");
      assert.equal(
        (yield* get(new URL("/en/", first.worker.url))).content.home.page.content,
        "<h1>English workerd home</h1>",
      );
      const englishBefore = yield* get(new URL("/en/", first.worker.url));
      assert.deepEqual(englishBefore.content.home.colors, [{ slug: "brand", color: "#0a0" }]);
      const retryEvent = {
        site: "P1",
        id: "workerd-retry-0008",
        action: "settings",
        setting: "design",
        occurredAt: Date.now() - 100,
      };
      yield* send(first.worker.url, retryEvent, true);
      assert.equal((yield* get(new URL("/entry/", first.worker.url))).kind, "missing");
      const protocolRows = yield* get(first.worker.url);
      const failedRetryRecord = protocolRows.events.find((row) => row.id === retryEvent.id);
      assert.ok(failedRetryRecord);
      assert.equal(failedRetryRecord.status, "failed");
      assert.equal(failedRetryRecord.attempts, 1);
      const second = yield* stack.deploy(program("second"));
      assert.equal(second.db.databaseId, first.db.databaseId);
      assert.deepEqual(second.db.migrationsHashes, hashes);
      const secondRead = yield* get(second.worker.url);
      assert.equal(secondRead.revision, "second");
      assert.deepEqual(secondRead.ledger, firstRead.ledger);
      assert.deepEqual(secondRead.rows, protocolRows.rows);
      assert.deepEqual(
        secondRead.events.find((row) => row.id === retryEvent.id),
        failedRetryRecord,
        "the complete failed event record must survive Worker update before any retry",
      );
      assert.deepEqual(secondRead.delivery, protocolRows.delivery);
      assert.deepEqual(yield* get(new URL("/en/", second.worker.url)), englishBefore);
      assert.equal((yield* send(second.worker.url, settingsEvent)).duplicate, true);
      console.log(
        "P6 #7 workerd: language-specific home, shared design, canonical alternates and signed settings duplicate persist across Worker update.",
      );
      assert.deepEqual(secondRead.tables, firstRead.tables);
      console.log(
        JSON.stringify(
          {
            migrationsDirectory,
            databaseId: second.db.databaseId,
            migrationHashes: hashes,
            ledger: secondRead.ledger,
            tables: secondRead.tables,
            publicationRows: secondRead.rows,
            delivery: secondRead.delivery,
          },
          null,
          2,
        ),
      );
      console.log(
        "P1 repeat lifecycle: database identity, five complete ledger identities, publication bytes and public delivery preserved; database noop, Worker updated.",
      );
      assert.equal((yield* get(new URL("/entry/", second.worker.url))).kind, "missing");
      const duplicate = yield* send(second.worker.url, publish);
      assert.equal(duplicate.duplicate, true);
      assert.equal((yield* get(new URL("/entry/", second.worker.url))).kind, "missing");
      const refreshResponse = yield* Effect.promise(() =>
        fetch(new URL("/gq/refresh", second.worker.url), {
          method: "POST",
          headers: { Authorization: "Bearer " + refreshToken },
          body: JSON.stringify({ uris: ["/entry/"] }),
        }),
      );
      assert.equal(refreshResponse.status, 200);
      assert.equal(
        (yield* Effect.promise(() => refreshResponse.json())).entries["/entry/"].outcome,
        "withdrawn",
      );
      assert.equal(
        (yield* send(second.worker.url, event("workerd-publish-0002", "publish", occurredAt + 200)))
          .status,
        "refreshed",
      );
      assert.equal((yield* get(new URL("/entry/", second.worker.url))).kind, "found");
      console.log(
        "P6 #6 workerd: real HMAC verification, publication/withdrawal SQL, restart persistence, duplicate ordering, refresh protection and later republication passed.",
      );
      assert.equal((yield* send(second.worker.url, retryEvent)).status, "refreshed");
      const recoveredRetryRecord = (yield* get(second.worker.url)).events.find(
        (row) => row.id === retryEvent.id,
      );
      assert.ok(recoveredRetryRecord);
      assert.equal(recoveredRetryRecord.status, "refreshed");
      assert.equal(recoveredRetryRecord.attempts, failedRetryRecord.attempts + 1);
      assert.equal(recoveredRetryRecord.reason, null);
      assert.equal(recoveredRetryRecord.message, null);
      for (const key of [
        "id",
        "action",
        "node_id",
        "uri",
        "previous_uri",
        "occurred_at",
        "received_at",
      ])
        assert.equal(recoveredRetryRecord[key], failedRetryRecord[key]);
      assert.equal((yield* get(new URL("/entry/", second.worker.url))).kind, "found");
      assert.deepEqual((yield* get(new URL("/en/", second.worker.url))).content.home.colors, [
        { slug: "brand", color: "#00a" },
      ]);
      assert.equal((yield* send(second.worker.url, retryEvent)).duplicate, true);
      assert.deepEqual(
        (yield* get(second.worker.url)).events.find((row) => row.id === retryEvent.id),
        recoveredRetryRecord,
        "a duplicate must not advance the recovered event record",
      );
      console.log(JSON.stringify({ failedRetryRecord, recoveredRetryRecord }, null, 2));
      console.log(
        "P6 #8 workerd: failed signed event survives Worker update and retries same identity to public delivery; duplicate is durable.",
      );
      yield* stack.destroy();
    }),
    options,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
// Alchemy's own CLI also exits after finalizers to release keep-alive handles.
process.exit(process.exitCode ?? 0);
