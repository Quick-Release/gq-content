// Immutable source provenance and source-assertion allocation for issue #9.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const source = resolve(process.argv[2] ?? "../gq-site");
const checkpoint = "eaec13488d57b3d04059309b5b36de5d016f3de1";
const git = (...args) => execFileSync("git", ["-C", source, ...args]);
const upstream = git("ls-remote", "origin", "refs/heads/main").toString().split(/\s/)[0];
assert.equal(
  upstream,
  git("rev-parse", "origin/main").toString().trim(),
  "new upstream needs delta review",
);
// Check the complete accepted relevant path set, not only files copied in this slice.
const roots = [
  "blueprint/templates/apps/frontend/src",
  "blueprint/templates/apps/frontend/migrations",
  "blueprint/templates/apps/cms/web/app/mu-plugins",
  "scripts/smoke",
  "docs/adr",
];
const rootDelta = git("diff", "--name-only", checkpoint, upstream, "--", ...roots)
  .toString()
  .trim()
  .split("\n");
assert.deepEqual(
  rootDelta,
  ["scripts/smoke/ci-composer.mjs", "scripts/smoke/ci-composer.sh"],
  "review changed files within broad relevant roots",
);
assert.equal(
  git("diff", upstream, "--", ...roots).length,
  0,
  "source working tree must match observed upstream",
);
const paths = [
  ...[
    "reconciliation.test",
    "language-updates.test",
    "lib/reconciliation",
    "lib/delivery",
    "lib/publications",
    "lib/events",
    "lib/wordpress",
    "pages/gq/events",
    "pages/gq/refresh",
  ].map((p) => `blueprint/templates/apps/frontend/src/${p}.ts`),
  "blueprint/templates/apps/cms/web/app/mu-plugins/delivery-retries.php",
  ...[
    "cms-events.mjs",
    "frontend-runtime.mjs",
    "frontend-runtime-lib.mjs",
    "frontend-languages.mjs",
    "cms-polylang.mjs",
  ].map((p) => `scripts/smoke/${p}`),
  ...[
    "0009-reconcile-missed-changes-on-the-cms-scheduler",
    "0010-declare-a-new-content-site-ready-through-one-readiness-gate",
    "0013-serve-each-language-from-its-own-shared-rows",
  ].map((p) => `docs/adr/${p}.md`),
];
assert.equal(
  git("diff", checkpoint, upstream, "--", ...paths).length,
  0,
  "review relevant runtime delta",
);
const directory = "docs/evidence/issue-9";
mkdirSync(directory, { recursive: true });
const write = (name, value) =>
  writeFileSync(`${directory}/${name}.json`, JSON.stringify(value, null, 2) + "\n");
write("provenance", {
  sourceRepository: "Quick-Release/gq-site",
  checkpoint,
  observedUpstream: upstream,
  base: "0c939635e27e40cbb6fb47565f270461ee03adfe",
  verifiedRelevantRoots: roots,
  reviewedRootDelta: rootDelta,
  rootDeltaReview:
    "Only two added CI Composer installer proof scripts in scripts/smoke; neither changes runtime/reconciliation/readiness source. Both reviewed explicitly; no runtime extraction from upstream.",
  relevantDelta:
    "none: accepted runtime paths unchanged (broad roots reviewed) through latest upstream and source working tree",
  upstreamChangedPaths: git("diff", "--name-only", checkpoint, upstream)
    .toString()
    .trim()
    .split("\n"),
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
const suite = "frontend/tests/reconciliation.test.ts";
const languageSuite = "frontend/tests/settings-languages.test.ts";
const rules = [
  [/^shared helper/, "signed reconciliation repairs a missed publication"],
  [/^a publication and an update/, "signed reconciliation repairs a missed publication"],
  [/^a lost move|absolute URIs, lost/, "missed changes, moves and confirmed removals"],
  [
    /absolute URIs, an unchanged|^with nothing changed/,
    "canonical shared comparisons report unchanged",
  ],
  [
    /^lost changes to every shared/,
    "missed home, menu, logo, icon, identity and design changes",
    languageSuite,
  ],
  [/^a change that left/, "canonical shared comparisons report unchanged"],
  [/^during an outage/, "outages preserve public content"],
  [/^a list WordPress fails/, "incomplete paginated lists cannot remove"],
  [/^an accepted withdrawal/, "withdrawals survive older scans"],
  [/^a reconciliation read in flight/, "a withdrawal accepted during reconciliation"],
  [/^a republication/, "withdrawals survive older scans"],
  [/^a run while another/, "D1 lease excludes overlapping runs"],
  [/^more changes than|^the report says/, "budgeted partial runs persist pending evidence"],
  [/^refused reconcile/, "preserves strict envelope validation"],
];
const files = baseline.files
  .filter((f) => paths.includes(f.path))
  .map((f) => ({
    sourcePath: f.path,
    sourceBlob: f.sourceBlob,
    assertions: f.assertions.map((row) => {
      const line = row.sourceLines[0],
        context = row.context;
      let status = "prior allocation retained",
        destination =
          "docs/evidence/issue-6/assertion-allocation.json; docs/evidence/issue-7/assertion-allocation.json; docs/evidence/issue-8/assertion-allocation.json",
        note = "This overlay does not change prior completed allocations.";
      if (f.path.endsWith("reconciliation.test.ts")) {
        const rule = rules.find(([re]) => re.test(context));
        assert.ok(rule, context);
        destination = `${rule[2] ?? suite} :: ${rule[1]}`;
        status = "runtime projection #9";
        note =
          "Public signed handlers/delivery DTOs replace Astro markup and private module calls. Complete row and attempt persistence comparisons live only in the disposable installed Alchemy consumer. Timing is controlled, not a live production guarantee.";
      } else if (f.path.endsWith("language-updates.test.ts") && line >= 660) {
        status = "runtime projection #9";
        destination =
          languageSuite +
          " :: reconciliation compares every language; reconciliation repairs missed English; multilingual reconciliation reserves language shared reads";
        note =
          "Shared rows, ALL-language listing, bilingual budget and public language delivery; rendering stays gq-site #77.";
      } else if (f.path.endsWith("cms-events.mjs") && line >= 1075 && line <= 1153) {
        status = "integrated installed runtime projection #9; orchestration remains Blueprint";
        destination =
          "scripts/reconciliation-proof.py; scripts/fixtures/alchemy-p1/reconciliation.mjs; " +
          suite;
        note =
          "Actual installed WordPress/Polylang/hooks/CLI/scheduler HTTP to installed workerd/D1, snapshot GraphQL boundary. Signed check evidence and CMS health/CLI are runtime-owned; gq site check orchestration, independent media and live provisioning stay gq-site #77.";
      } else if (f.path.endsWith("cms-events.mjs") && line >= 264 && line <= 377) {
        status = "runtime evidence #9 with Blueprint handoff";
        destination =
          suite +
          " :: signed check distinguishes an unprepared store; scripts/cms-proof.py; scripts/reconciliation-proof.py; gq-site #77";
        note =
          "Runtime store/check metadata and installed CMS checks are covered; gq site check command, real GETQUICK GraphQL schema validation, installer guidance and orchestration stay Blueprint-owned. No claim of running the Site CLI.";
      } else if (f.path.endsWith("frontend-runtime.mjs") && line >= 404) {
        status = "installed workerd runtime projection #9";
        destination =
          "scripts/reconciliation-proof.py; scripts/fixtures/alchemy-p1/reconciliation.mjs; " +
          suite;
        note =
          "Integrated real WordPress snapshot projected through GraphQL into installed workerd. Budget continuation, changes/removals, outages and recovery retained; skeleton HTML stays gq-site #77.";
      } else if (f.path.endsWith("cms-events.mjs") && line >= 1210) {
        status = "prior scheduler invocation retained; daemon/provisioning handoff";
        destination = "docs/evidence/issue-8/README.md; gq-content #11; gq-site #77";
        note =
          "Actual CLI scheduler and shell invocation retained; no new claim of cron daemon/Ploi provisioning.";
      }
      return { ...row, status, destination, note };
    }),
  }));
write("assertion-allocation", {
  checkpoint,
  note: "Per-assertion overlay over immutable #3 inventory. Source presentation stays Blueprint-owned. P2/P6 integrated installed WordPress→workerd evidence is added, not substituted by disjoint Node and workerd proofs. Full release gate remains #11.",
  files,
});
execFileSync(
  "vp",
  ["fmt", `${directory}/provenance.json`, `${directory}/assertion-allocation.json`],
  { stdio: "inherit" },
);
console.log(
  `Issue #9: ${paths.length} provenance paths; complete runtime paths unchanged (broad roots reviewed); ${files.reduce((n, f) => n + f.assertions.length, 0)} assertion spans allocated.`,
);
