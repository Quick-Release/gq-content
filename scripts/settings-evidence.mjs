// Overlay the original source inventory; builds and consumers need no source checkout.
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const source = resolve(process.argv[2] ?? "../gq-site");
const checkpoint = "eaec13488d57b3d04059309b5b36de5d016f3de1";
const git = (...args) => execFileSync("git", ["-C", source, ...args]);
const base = "blueprint/templates/apps/frontend/src/";
const paths = [
  ...["settings", "languages", "language-updates"].map((name) => `${base}${name}.test.ts`),
  ...["events", "delivery", "publications", "wordpress", "site-language"].map(
    (name) => `${base}lib/${name}.ts`,
  ),
  `${base}lib/site-language.test.ts`,
  ...["settings-events", "publication-events"].map(
    (name) => `blueprint/templates/apps/cms/web/app/mu-plugins/${name}.php`,
  ),
  ...["cms-events.mjs", "cms-polylang.mjs", "cms-polylang.sh", "frontend-languages.mjs"].map(
    (name) => `scripts/smoke/${name}`,
  ),
];
const live = git("ls-remote", "origin", "refs/heads/main").toString().split(/\s/)[0];
assert.equal(
  live,
  git("rev-parse", "origin/main").toString().trim(),
  "inspect new upstream before regenerating",
);
assert.equal(
  git("diff", checkpoint, live, "--", ...paths).length,
  0,
  "review relevant upstream delta",
);
const directory = "docs/evidence/issue-7";
mkdirSync(directory, { recursive: true });
const write = (name, data) =>
  writeFileSync(`${directory}/${name}.json`, JSON.stringify(data, null, 2) + "\n");
write("provenance", {
  checkpoint,
  observedUpstream: live,
  base: "49b194340a6031df533468b82487f328e1ab2464",
  note: "Relevant settings/language runtime, CMS and smoke paths unchanged. The 10 upstream changed files concern CI Composer policy, release/development documentation and smoke fixtures; extraction source remains the reviewed checkpoint. No owner-repository writes.",
  upstreamChangedPaths: git("diff", "--name-only", checkpoint, live).toString().trim().split("\n"),
  files: paths.map((path) => ({
    sourcePath: path,
    sourceBlob: git("rev-parse", `${checkpoint}:${path}`).toString().trim(),
    sha256: createHash("sha256")
      .update(git("show", `${checkpoint}:${path}`))
      .digest("hex"),
  })),
});
const suite = "frontend/tests/settings-languages.test.ts";
const text = readFileSync(suite, "utf8");
// Every source test context maps to a named public-boundary test, or remains an explicit owner handoff.
const rules = [
  [/^a change to the %s/, "shared %s changes reach every stored page"],
  [/^a %s event during/, "failed %s retains last-known-good settings"],
  [/^a design refresh failing/, "invalid design read (%s)"],
  [/^a partly failed identity/, "partly failed identity refresh"],
  [/^a duplicate settings/, "shared %s changes reach every stored page"],
  [/^a delayed settings/, "older settings cannot roll back"],
  [/^a newer refreshed|^settings are ordered apart/, "a newer successful setting supersedes"],
  [/^a read that started/, "a slower settings read"],
  [/^an entry published after/, "an entry published with lagging design"],
  [/^a Site prepared before|^shared presets this/, "legacy design %s"],
  [/^a settings event with/, "invalid settings envelope %j"],
  [/^a settings event signed/, "settings signed by another Site key"],
  [
    /^\/ and \/en\/|^each home links|^\/sobre\/ and/,
    "each language's home, chrome, routes and alternates",
  ],
  [/^the refresh reads each/, "whole refresh reads both languages"],
  [/^a language whose home/, "a never-stored English home"],
  [
    /^an English page without|^an English page the store/,
    "a cold English entry and an English-only entry",
  ],
  [/^\/en\/sobre\/|^a withdrawn translation/, "wrong-language CMS entry never falls back"],
  [/^an entry stored before/, "a legacy entry with no language"],
  [/^a route that resolves/, "a route resolving to an English front page"],
  [/^withdrawing the English/, "settings and whole refresh never lift"],
  [
    /^publishing an English page|^publishing the Portuguese/,
    "a %s publication refreshes only its own entry",
  ],
  [/^publishing the English front/, "publication updates only its own language home"],
  [/^an entry whose language|^a language the Site doesn't/, "invalid language subject %j"],
  [
    /^reassigning the English|^changing the English|^each language's settings/,
    "language-specific %s refreshes only its own subject",
  ],
  [
    /^changing the logo|^a change to the site's own title/,
    "shared %s changes reach every stored page",
  ],
  [/^a menu change in the default|^a failed English menu/, "a failed English menu event"],
  [
    /^the refresh is ready|^a targeted refresh/,
    "the whole refresh requires every language's chrome",
  ],
  [/^the signed check/, "%s English home never falls back"],
];
for (const [, name] of rules) assert.ok(text.includes(name), name);
const baseline = JSON.parse(
  readFileSync("docs/evidence/issue-3/assertion-allocation.json", "utf8"),
);
const files = baseline.files
  .filter((file) => paths.includes(file.path))
  .map((file) => {
    const lines = git("show", `${checkpoint}:${file.path}`).toString().split("\n");
    return {
      sourcePath: file.path,
      sourceBlob: file.sourceBlob,
      assertions: file.assertions.map((row) => {
        const expression = lines.slice(row.sourceLines[0] - 1, row.sourceLines[1]).join("\n");
        let status, destination, note;
        if (file.path.endsWith("site-language.test.ts")) {
          status = "preserved #3";
          destination = "frontend/tests/site-language.test.ts";
        } else if (
          /reconciliation in each language/.test(lines.slice(0, row.sourceLines[0]).join("\n"))
        ) {
          status = "deferred #9";
          destination =
            "gq-content #9 reconciliation per-language reads, canonical comparison, budget and recovery";
        } else if (file.path.includes("/smoke/")) {
          if (
            /polylang\.sh|generated deploy|configures Polylang|default language, then|URL directory|content without a language|running polylang|no longer lists|never deletes/.test(
              row.context,
            )
          ) {
            status = "Blueprint provisioning retained";
            destination = "gq-site #77 Polylang provisioning/deploy policy";
          } else if (
            file.path.endsWith("cms-events.mjs") &&
            !/setting|menu|logo|design|identity|tagline|palette/i.test(row.context)
          ) {
            status = "prior allocation retained";
            destination =
              "docs/evidence/issue-5/assertion-allocation.json; docs/evidence/issue-6/assertion-allocation.json; scheduler #8/reconciliation #9";
          } else {
            status = "runtime projection #7";
            destination =
              "scripts/multilingual-proof.py; scripts/fixtures/alchemy-p1/{worker.ts,proof.mjs}; " +
              suite;
            note =
              "Real Composer/Bedrock WordPress/Polylang saves and signed transport into installed consumer reads; real Alchemy migration/update separately. GraphQL answers are boundary fixtures exported from real CMS state. Live schema/REST editor composition and Site CLI orchestration are not proved.";
          }
        } else if (row.context === "a Portuguese 404 is in Portuguese") {
          status = "Blueprint presentation retained";
          destination =
            "gq-site #77 translated 404 document/copy; package wrong-language/missing DTO tests retained";
        } else if (row.context === "shared helper") {
          status = "test support projection #7";
          destination = suite + " public Request/Response/DTO helpers";
        } else {
          const rule = rules.find(([pattern]) => pattern.test(row.context));
          assert.ok(rule, row.context);
          status = "runtime behavior migrated #7";
          destination = `${suite} :: ${rule[1]}`;
          note = /recordedEvents|storedRows|reread\(|readTimes/.test(expression)
            ? "SQL introspection replaced by observable public reads and duplicate/retry/order outcomes; actual CMS record keys/CLI fields retained in multilingual pair proof."
            : /\.html|\.status|alternates|switcher/.test(expression)
              ? "Runtime content/chrome/design/alternate/status DTO projection. Site document markup, translated copy, CSS, href/hreflang and metadata composition remain gq-site #77. Canonical language identity asserted directly."
              : "Configured package handler/public-delivery assertion. No Astro wrapper or internal-module mocks.";
        }
        return {
          sourceLines: row.sourceLines,
          context: row.context,
          status,
          destination,
          ...(note ? { note } : {}),
        };
      }),
    };
  });
write("assertion-allocation", {
  checkpoint,
  note: "Per-assertion overlay of #3; #3–#6 inventories remain immutable. Mixed HTML checks preserve runtime DTO guarantees here and presentation in gq-site #77. Pending #9 is not completed. CMS expectSent helper invocations additionally map to actual language publication/menu/string/logo/identity events in multilingual-proof.py; custom helper calls are not counted as independent assertions in the original AST inventory.",
  files,
});
console.log(
  `Issue #7 source verified: ${paths.length} unchanged paths; ${files.reduce((n, f) => n + f.assertions.length, 0)} assertion spans allocated.`,
);

execFileSync(
  "vp",
  ["fmt", `${directory}/provenance.json`, `${directory}/assertion-allocation.json`],
  { stdio: "inherit" },
);
