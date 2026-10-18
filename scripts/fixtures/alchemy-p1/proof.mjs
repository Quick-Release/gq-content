import assert from "node:assert/strict";
import { readFileSync } from "node:fs";
import { createHash } from "node:crypto";
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
const program = (revision) =>
  Effect.gen(function* () {
    const db = yield* Database("Publications", {
      name: "content-installed-p1",
      migrations: migrationsDirectory,
    });
    const worker = yield* Worker("Frontend", {
      name: "content-installed-p1",
      main: "./worker.ts",
      env: { PUBLICATION_DB: db, REVISION: revision },
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
      const second = yield* stack.deploy(program("second"));
      assert.equal(second.db.databaseId, first.db.databaseId);
      assert.deepEqual(second.db.migrationsHashes, hashes);
      const secondRead = yield* get(second.worker.url);
      assert.equal(secondRead.revision, "second");
      assert.deepEqual(secondRead.ledger, firstRead.ledger);
      assert.deepEqual(secondRead.rows, firstRead.rows);
      assert.deepEqual(secondRead.delivery, firstRead.delivery);
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
