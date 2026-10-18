import assert from "node:assert/strict";
import { readFileSync, writeFileSync } from "node:fs";
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

import { createServer } from "node:http";
import { execFile } from "node:child_process";
import { promisify } from "node:util";
const root = process.env.RECONCILIATION_REPO;
assert.ok(root);
const fixture = join(root, ".proofs/reconciliation/graphql.json");
const control = join(root, ".proofs/reconciliation/control.json");
writeFileSync(fixture, JSON.stringify({ entries: {} }));
writeFileSync(control, "{}");
let requests = 0;
const bridge = createServer(async (req, res) => {
  try {
    if (req.url === "/stats") {
      res.end(JSON.stringify({ requests }));
      return;
    }
    requests++;
    const chunks = [];
    for await (const chunk of req) chunks.push(chunk);
    const { query, variables = {} } = JSON.parse(Buffer.concat(chunks));
    const state = JSON.parse(readFileSync(control, "utf8"));
    const saved = JSON.parse(readFileSync(fixture, "utf8"));
    if (state.offline || (state.entryFailure && query.includes("EntryByUri"))) {
      res.writeHead(502, { "Content-Type": "application/json" });
      res.end("{}");
      return;
    }
    if (state.holdUri === variables.uri && query.includes("EntryByUri")) {
      writeFileSync(
        join(root, ".proofs/reconciliation/held.json"),
        JSON.stringify({ uri: variables.uri }),
      );
      const deadline = Date.now() + 6000;
      while (!JSON.parse(readFileSync(control, "utf8")).release && Date.now() < deadline)
        await new Promise((resolve) => setTimeout(resolve, 20));
    }
    if (state.delayMs) await new Promise((resolve) => setTimeout(resolve, state.delayMs));
    let data;
    if (query.includes("HomePage")) data = saved.homes[variables.language === "EN" ? "en" : "pt"];
    else if (query.includes("SiteChrome"))
      data = saved.chrome[variables.language === "EN" ? "en" : "pt"];
    else if (query.includes("DesignPresets")) data = { designTokens: saved.design };
    else if (query.includes("EntryByUri"))
      data = {
        pageBy: saved.entries[variables.uri] ?? null,
        postBy: null,
        designTokens: saved.design,
      };
    else if (query.includes("PublishedRoutes"))
      data = {
        contentNodes: {
          nodes: Object.values(saved.entries).map(({ id, uri, modifiedGmt }) => ({
            id,
            uri,
            modifiedGmt,
          })),
          pageInfo: { hasNextPage: !!state.incomplete, endCursor: null },
        },
      };
    else throw new Error("Unexpected GraphQL operation");
    res.writeHead(200, { "Content-Type": "application/json" });
    res.end(JSON.stringify({ data }));
  } catch (error) {
    console.error(error);
    res.writeHead(500);
    res.end("{}");
  }
});
await new Promise((resolve) => bridge.listen(0, "127.0.0.1", resolve));
const cmsGraphql = "http://127.0.0.1:" + bridge.address().port + "/graphql";
writeFileSync(
  join(root, ".proofs/reconciliation/bridge.json"),
  JSON.stringify({ origin: new URL(cmsGraphql).origin }),
);
const options = { providers, dev: true, sidecar: false, stage: "p9" };
const stack = Core.scratchStack(options, "content-installed-reconciliation", "proof");
const program = (revision) =>
  Effect.gen(function* () {
    const db = yield* Database("Publications", {
      name: "content-installed-reconciliation",
      migrations: migrationsDirectory,
    });
    const worker = yield* Worker("Frontend", {
      name: "content-installed-reconciliation",
      main: "./reconciliation-worker.ts",
      env: {
        PUBLICATION_DB: db,
        REVISION: revision,
        CMS_GRAPHQL: cmsGraphql,
        PUBLICATION_EVENT_SECRET: "workerd-disposable-event-key-01234567890123456789",
        FRONTEND_REFRESH_TOKEN: "workerd-disposable-refresh-key-01234567890123456789",
      },
      compatibility: { date: "2026-09-08" },
    });
    return { db, worker };
  });
const phase = (name, url) =>
  Effect.promise(async () => {
    try {
      const result = await promisify(execFile)(
        "python3",
        [join(root, "scripts/reconciliation-proof.py"), name, url, cmsGraphql],
        { env: process.env, timeout: 180000, maxBuffer: 4 * 1024 * 1024 },
      );
      process.stdout.write(result.stdout);
      process.stderr.write(result.stderr);
    } catch (error) {
      process.stdout.write(error.stdout ?? "");
      process.stderr.write(error.stderr ?? "");
      throw error;
    }
  });
const diagnostics = (url) =>
  Effect.promise(async () => {
    const r = await fetch(new URL("/proof/diagnostics", url));
    assert.equal(r.status, 200);
    return r.json();
  });
try {
  await Core.run(
    Effect.gen(function* () {
      yield* stack.destroy();
      const first = yield* stack.deploy(program("first"));
      assert.deepEqual(first.db.migrationsHashes, hashes);
      yield* phase("prepare-partial", first.worker.url);
      const pending = yield* diagnostics(first.worker.url);
      assert.equal(pending.reconciliation[0].outcome, "behind");
      assert.ok(pending.reconciliation[0].pending > 0);
      const second = yield* stack.deploy(program("second"));
      assert.equal(second.db.databaseId, first.db.databaseId);
      const pendingAfter = yield* diagnostics(second.worker.url);
      assert.deepEqual(
        pendingAfter.reconciliation,
        pending.reconciliation,
        "complete pending reconciliation survives update BEFORE continuation",
      );
      assert.deepEqual(pendingAfter.events, pending.events);
      assert.deepEqual(pendingAfter.attempts, pending.attempts);
      assert.deepEqual(pendingAfter.ledger, pending.ledger);
      yield* phase("continue-outage", second.worker.url);
      const failed = yield* diagnostics(second.worker.url);
      assert.equal(failed.reconciliation[0].outcome, "failed");
      assert.ok(failed.reconciliation[0].failed > 0);
      const third = yield* stack.deploy(program("third"));
      assert.equal(third.db.databaseId, first.db.databaseId);
      const failedAfter = yield* diagnostics(third.worker.url);
      assert.deepEqual(
        failedAfter.reconciliation,
        failed.reconciliation,
        "complete failed reconciliation survives update BEFORE recovery",
      );
      assert.deepEqual(failedAfter.events, failed.events);
      assert.deepEqual(failedAfter.attempts, failed.attempts);
      assert.deepEqual(failedAfter.ledger, failed.ledger);
      yield* phase("recover", third.worker.url);
      yield* phase("daemon", third.worker.url);
      const recovered = yield* diagnostics(third.worker.url);
      for (const before of failed.events.filter((e) => e.status === "failed")) {
        const after = recovered.events.find((e) => e.id === before.id);
        assert.ok(after);
        assert.equal(after.attempts, before.attempts + 1);
        assert.equal(after.status, "refreshed");
        for (const key of [
          "id",
          "action",
          "node_id",
          "uri",
          "previous_uri",
          "occurred_at",
          "received_at",
        ])
          assert.equal(after[key], before[key]);
        assert.equal(after.reason, null);
        assert.equal(after.message, null);
      }
      writeFileSync(
        join(root, ".proofs/reconciliation/persistence.json"),
        JSON.stringify({ pending, pendingAfter, failed, failedAfter, recovered }, null, 2) + "\n",
      );
      console.log(
        "P2/P6 #9 integrated WordPress CLI/scheduler → installed package/workerd: convergence, partial continuation, outage/recovery, complete failed/pending records and event attempt progression across Worker updates passed.",
      );
      yield* phase("runtime", third.worker.url);
      const aged = yield* diagnostics(third.worker.url);
      const fourth = yield* stack.deploy(program("fourth"));
      assert.equal(fourth.db.databaseId, first.db.databaseId);
      const agedAfter = yield* diagnostics(fourth.worker.url);
      for (const key of ["publications", "events", "attempts", "withdrawals", "ledger"])
        assert.deepEqual(
          agedAfter[key],
          aged[key],
          `complete ${key} survives redeploy during outage`,
        );
      yield* phase("aged-after-update", fourth.worker.url);
      yield* phase("bulk", fourth.worker.url);
      writeFileSync(
        join(root, ".proofs/reconciliation/aged-persistence.json"),
        JSON.stringify({ aged, agedAfter }, null, 2) + "\n",
      );
      yield* stack.destroy();
    }),
    options,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
bridge.close();
process.exit(process.exitCode ?? 0);
