// Consent records, reads and purge in workerd against local D1 (#22, #26),
// and the commerce packaging proof (#28): the installed package's consent
// exports run in a Worker that never initialises the content runtime.
import assert from "node:assert/strict";
import { readFileSync, readdirSync, realpathSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
import { join, resolve, dirname } from "node:path";
import * as Effect from "effect/Effect";
import * as Layer from "effect/Layer";
import * as Redacted from "effect/Redacted";
import * as Core from "alchemy/Test/Core";
import { Database, DatabaseProvider } from "./node_modules/alchemy/lib/Cloudflare/D1/Database.js";
import { Worker } from "./node_modules/alchemy/lib/Cloudflare/Workers/Worker.js";
import { WorkerProvider } from "./node_modules/alchemy/lib/Cloudflare/Workers/WorkerProvider.js";
import { CloudflareEnvironment } from "./node_modules/alchemy/lib/Cloudflare/CloudflareEnvironment.js";
import { consentMigrationsDirectory } from "@getquick/content/consent/migrations";

const installed = realpathSync(resolve("node_modules/@getquick/content"));
assert.ok(consentMigrationsDirectory.startsWith(installed));
assert.deepEqual(readdirSync(consentMigrationsDirectory), ["0001_consent_records.sql"]);

// Isolation: the consent entries' import closure holds no content runtime,
// WordPress client or publication store, and no framework import.
const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
assert.equal(manifest.peerDependencies, undefined);
const closure = new Set();
const visit = (file) => {
  if (closure.has(file)) return;
  closure.add(file);
  for (const [, spec] of readFileSync(file, "utf8").matchAll(/from\s*["'](\.[^"']+)["']/g))
    visit(join(dirname(file), spec));
};
for (const entry of ["consent", "consent-server", "consent-client"])
  visit(join(installed, "dist", `${entry}.js`));
for (const file of closure) {
  const text = readFileSync(file, "utf8");
  assert.doesNotMatch(
    text,
    /createContentRuntime|graphqlEndpoint|PUBLICATION_DB|publication_events|WPGraphQL|from\s*["'](?:astro|react|zod|node:)/,
    file,
  );
}
const worker = readFileSync("worker.ts", "utf8");
assert.doesNotMatch(worker, /["']@getquick\/content["']|@getquick\/content\/server/);
console.log(
  `#28 isolation: ${closure.size} installed modules behind consent, consent/server and consent/client import no content runtime, WordPress client, D1 publication store, framework or zod.`,
);

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
const options = { providers, dev: true, sidecar: false, stage: "consent" };
const stack = Core.scratchStack(options, "consent-installed", "proof");
const readToken = "workerd-consent-read-token-0123456789abcdef";
const program = (revision) =>
  Effect.gen(function* () {
    const db = yield* Database("Consent", {
      name: "consent-installed",
      migrations: consentMigrationsDirectory,
    });
    const worker = yield* Worker("Storefront", {
      name: "consent-installed",
      main: "./worker.ts",
      env: { CONSENT_DB: db, CONSENT_READ_TOKEN: readToken, REVISION: revision },
      compatibility: { date: "2026-09-08" },
    });
    return { db, worker };
  });
const call = (url, init = {}) =>
  Effect.promise(async () => {
    const response = await fetch(url, init);
    const type = response.headers.get("Content-Type") ?? "";
    return {
      status: response.status,
      headers: response.headers,
      body: type.includes("json") ? await response.json() : await response.text(),
    };
  });

const evidence = [];
const pass = (criteria, detail) => {
  evidence.push({ criteria, detail });
  console.log(`PASS ${criteria.join(", ")}: ${detail}`);
};
try {
  await Core.run(
    Effect.gen(function* () {
      yield* stack.destroy();
      const first = yield* stack.deploy(program("first"));
      const base = first.worker.url;
      const origin = new URL(base).origin;
      const hash = createHash("sha256")
        .update(readFileSync(join(consentMigrationsDirectory, "0001_consent_records.sql")))
        .digest("hex");
      assert.deepEqual(first.db.migrationsHashes, { "0001_consent_records.sql": hash });

      // Banner state in the commerce consumer.
      let state = yield* call(new URL("/state", base));
      assert.deepEqual(
        [state.body.prompt, state.body.analytics, state.body.turnstile],
        ["first", false, true],
      );
      assert.deepEqual(state.body.categories, ["analytics"]);
      const decided = yield* call(new URL("/decide?choice=reject_all", base), { method: "POST" });
      const cookie = decided.headers.get("Set-Cookie").split(";")[0];
      state = yield* call(new URL("/state", base), { headers: { Cookie: cookie } });
      assert.deepEqual([state.body.prompt, state.body.analytics], [null, false]);
      pass(
        ["CN-R5", "CN-C2"],
        "banner state in the Worker consumer: first visit prompts, a rejection is in force, Turnstile stays necessary",
      );

      // Records against local D1 in workerd.
      const post = (body, headers = {}) =>
        call(new URL("/gq/consent", base), {
          method: "POST",
          headers: {
            "Content-Type": "application/json",
            Origin: origin,
            "Sec-Fetch-Site": "same-origin",
            ...headers,
          },
          body: typeof body === "string" ? body : JSON.stringify(body),
        });
      const record = decided.body.record;
      assert.equal((yield* post(record)).status, 201);
      assert.equal((yield* post(record)).status, 200);
      assert.equal((yield* post(record, { Origin: "https://evil.example" })).status, 403);
      assert.equal((yield* post(record, { "Sec-Fetch-Site": "cross-site" })).status, 403);
      assert.equal((yield* post({ ...record, ip: "203.0.113.1" })).status, 400);
      assert.equal(
        (yield* post(JSON.stringify({ ...record, uiVersion: "x".repeat(5000) }))).status,
        413,
      );
      const accepted = yield* call(new URL("/decide?choice=accept_all", base), {
        method: "POST",
        headers: { Cookie: cookie },
      });
      assert.equal(accepted.body.record.consentId, record.consentId);
      assert.equal(accepted.body.record.action, "accept_all");
      assert.equal(
        (yield* post(accepted.body.record, {
          "CF-Connecting-IP": "203.0.113.9",
          "User-Agent": "Proof/1.0",
        })).status,
        201,
      );
      const rows = (yield* call(new URL("/rows", base))).body;
      assert.deepEqual(
        rows.map((row) => row.action),
        ["reject_all", "accept_all"],
      );
      assert.ok(
        !JSON.stringify(rows).includes("203.0.113") && !JSON.stringify(rows).includes("Proof/1.0"),
      );
      pass(
        ["CN-R7", "CN-R8", "CN-R9"],
        "workerd + local D1: records append (retry adds none), cross-origin/invalid/oversize rejected, no IP or user agent stored",
      );

      // Authenticated reads.
      const read = (path, token = readToken) =>
        call(new URL(path, base), { headers: token ? { Authorization: `Bearer ${token}` } : {} });
      assert.equal((yield* read(`/gq/consent/records/${record.consentId}`, null)).status, 401);
      assert.equal(
        (yield* read(`/gq/consent/records/${record.consentId}`, "x".repeat(40))).status,
        401,
      );
      const lookup = yield* read(`/gq/consent/records/${record.consentId}`);
      assert.equal(lookup.status, 200);
      assert.deepEqual(
        lookup.body.records.map((each) => [each.action, each.siteId, each.decisions.analytics]),
        [
          ["reject_all", "shop", false],
          ["accept_all", "shop", true],
        ],
      );
      const today = new Date().toISOString().slice(0, 10);
      const csv = yield* read(`/gq/consent/export?from=${today}&to=${today}`);
      assert.equal(csv.headers.get("Content-Type"), "text/csv; charset=utf-8");
      assert.equal(csv.body.trimEnd().split("\r\n").length, 3);
      const stats = yield* read(`/gq/consent/stats?from=${today}&to=${today}`);
      assert.deepEqual(
        [stats.body.total, stats.body.byAction.accept_all, stats.body.byCategory.analytics],
        [2, 1, { granted: 1, denied: 1 }],
      );
      pass(
        ["CN-R11"],
        "workerd: bearer-authenticated lookup, CSV export and counts match stored decisions",
      );

      // Retention purge, then a Worker update keeps the records.
      yield* call(new URL("/seed-old", base), { method: "POST" });
      assert.deepEqual((yield* call(new URL("/purge", base), { method: "POST" })).body, {
        deleted: 1,
      });
      const second = yield* stack.deploy(program("second"));
      assert.equal(second.db.databaseId, first.db.databaseId);
      assert.equal((yield* call(new URL("/state", second.worker.url))).body.revision, "second");
      assert.deepEqual((yield* call(new URL("/rows", second.worker.url))).body, rows);
      pass(
        ["CN-R10"],
        "workerd: purge deletes a record 5 years past its end of force, keeps current ones; records survive a Worker update",
      );
      yield* stack.destroy();
    }),
    options,
  );
} catch (error) {
  console.error(error);
  process.exitCode = 1;
}
if (process.env.CONSENT_EVIDENCE)
  writeFileSync(process.env.CONSENT_EVIDENCE, JSON.stringify(evidence, null, 2));
// Alchemy's own CLI also exits after finalizers to release keep-alive handles.
process.exit(process.exitCode ?? 0);
