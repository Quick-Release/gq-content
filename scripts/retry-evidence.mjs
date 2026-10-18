// Verify immutable extraction provenance and overlay only this slice's assertion allocation.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const source = resolve(process.argv[2] ?? "../gq-site");
const checkpoint = "eaec13488d57b3d04059309b5b36de5d016f3de1";
const git = (...args) => execFileSync("git", ["-C", source, ...args]);
const paths = [
  ...["delivery-retries", "publication-events", "settings-events"].map(
    (p) => `blueprint/templates/apps/cms/web/app/mu-plugins/${p}.php`,
  ),
  ...["retries.test", "lib/events", "lib/delivery", "lib/publications"].map(
    (p) => `blueprint/templates/apps/frontend/src/${p}.ts`,
  ),
  ...[
    "cms-events.mjs",
    "cms-events.sh",
    "frontend-runtime.mjs",
    "frontend-runtime.sh",
    "frontend-runtime-lib.mjs",
  ].map((p) => `scripts/smoke/${p}`),
  "docs/adr/0008-retry-event-delivery-from-the-cms-on-a-server-cron.md",
];
const live = git("ls-remote", "origin", "refs/heads/main").toString().split(/\s/)[0];
assert.equal(
  live,
  git("rev-parse", "origin/main").toString().trim(),
  "review newly observed upstream before extraction",
);
assert.equal(
  git("diff", checkpoint, live, "--", ...paths).length,
  0,
  "review relevant source delta",
);
const directory = "docs/evidence/issue-8";
mkdirSync(directory, { recursive: true });
const write = (name, value) =>
  writeFileSync(`${directory}/${name}.json`, JSON.stringify(value, null, 2) + "\n");
write("provenance", {
  checkpoint,
  observedUpstream: live,
  base: "b931ee5f1c3a4b57ab3aaf2f79a287b793bf0dd0",
  note: "Explicit upstream delta review: only the previously reviewed CI/Composer, fixture and release/development documentation paths changed. All relevant retry paths unchanged. Source remains the accepted checkpoint; no source repository writes or new runtime extraction.",
  upstreamChangedPaths: git("diff", "--name-only", checkpoint, live).toString().trim().split("\n"),
  files: paths.map((path) => ({
    sourcePath: path,
    sourceBlob: git("rev-parse", `${checkpoint}:${path}`).toString().trim(),
    sha256: createHash("sha256")
      .update(git("show", `${checkpoint}:${path}`))
      .digest("hex"),
  })),
});
const baseline = JSON.parse(
  readFileSync("docs/evidence/issue-3/assertion-allocation.json", "utf8"),
);
const suite = "frontend/tests/retries.test.ts";
const tests = readFileSync(suite, "utf8");
const rules = [
  [/^a publication whose/, "publication recovers hours later"],
  [/^a settings change/, "failed shared setting recovers"],
  [/^work interrupted/, "failed outcome persistence is completed"],
  [/^a retry of an older/, "older retry after a newer publication"],
  [/^a retry's signature/, "replayed old signature is refused"],
];
for (const [, name] of rules) assert.ok(tests.includes(name), name);
const files = baseline.files
  .filter((f) => paths.includes(f.path))
  .map((file) => ({
    sourcePath: file.path,
    sourceBlob: file.sourceBlob,
    assertions: file.assertions.map((row) => {
      let status = "prior allocation retained",
        destination =
          "docs/evidence/issue-5/assertion-allocation.json; docs/evidence/issue-6/assertion-allocation.json; docs/evidence/issue-7/assertion-allocation.json";
      let note = "No broader completion claim in this overlay.";
      const line = row.sourceLines[0];
      if (file.path.endsWith("retries.test.ts")) {
        status = "runtime projection #8";
        destination =
          suite +
          " :: " +
          (rules.find(([re]) => re.test(row.context))?.[1] ?? "prepare public refresh helper");
        note =
          "Public Request/Response and delivery DTOs replace Astro rendering and internal SQL outcome inspection. Persistent duplicate/recovery/supersede results prove outcomes; Site document markup stays gq-site #77. Interrupted database outcome uses a real SQLite failing trigger, then reopen, without runtime mocks.";
      } else if (
        file.path.endsWith("cms-events.mjs") &&
        ((line >= 656 && line <= 893) ||
          (line >= 994 && line <= 1044) ||
          /retry delivers|records the failed delivery/.test(row.context))
      ) {
        status = "installed runtime projection #8";
        destination =
          "scripts/retry-proof.py; cms/tests/retry-extension.php; scripts/pair-proof.py; frontend/tests/retries.test.ts";
        note =
          "Actual installed WordPress APIs/CLI/signatures, persisted records and installed package public delivery. Callback HTTP work, concurrent CLI processes and wall-clock budget replace mocked arithmetic. Secret-safe editor REST/CLI/Site Health asserted. HTML presentation stays Blueprint-owned.";
      } else if (/reconcil/.test(row.context)) {
        status = "deferred #9";
        destination = "gq-content #9";
        note =
          "Scheduler retry proofs explicitly disable reconciliation; unavailable implementation remains 503.";
      } else if (line >= 1154 && file.path.endsWith("cms-events.mjs")) {
        status = "cron invocation projected #8; daemon/provisioning deferred";
        destination =
          "scripts/retry-proof.py :: cron; gq-content #11 daemon proof; gq-site #77 crontab provisioning";
        note =
          "Actual shell command wp gq-events retry-due --quiet with disposable minimal environment and real installed WP-CLI; no WP-Cron scheduling. No cron daemon/container, Ploi crontab generation or lost-event reconciliation claim.";
      }
      return { ...row, status, destination, note };
    }),
  }));
write("assertion-allocation", {
  checkpoint,
  note: "Per-source-assertion overlay; earlier inventories immutable. Runtime recovery is projected at public handlers and real installed CMS/CLI. Source SQL side-channel checks become durable public outcomes. Reconciliation #9 and broader real daemon #11 remain explicit.",
  files,
});
execFileSync(
  "vp",
  ["fmt", `${directory}/provenance.json`, `${directory}/assertion-allocation.json`],
  { stdio: "inherit" },
);
console.log(
  `Issue #8: ${paths.length} unchanged source paths; ${files.reduce((n, f) => n + f.assertions.length, 0)} assertion spans allocated.`,
);
