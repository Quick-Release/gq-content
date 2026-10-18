import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const source = resolve(process.argv[2] ?? "../gq-site");
const checkpoint = "eaec13488d57b3d04059309b5b36de5d016f3de1";
const git = (...args) => execFileSync("git", ["-C", source, ...args]);
const base = "blueprint/templates/apps/frontend/";
const paths = [
  "src/lib/events.ts",
  "src/lib/reconciliation.ts",
  "src/lib/delivery.ts",
  "src/lib/publications.ts",
  "src/pages/gq/events.ts",
  "src/pages/gq/refresh.ts",
  ...["events", "withdrawals", "homepage", "entries"].map((name) => `src/${name}.test.ts`),
  "blueprint/templates/apps/cms/web/app/mu-plugins/publication-events.php",
  "scripts/smoke/cms-events.mjs",
  "scripts/smoke/frontend-runtime.mjs",
].map((path) => (path.startsWith("src/") ? base + path : path));
const live = git("ls-remote", "origin", "refs/heads/main").toString().split(/\s/)[0];
assert.equal(
  live,
  git("rev-parse", "origin/main").toString().trim(),
  "inspect new upstream before regenerating evidence",
);
assert.equal(git("diff", checkpoint, live, "--", ...paths).length, 0);
const directory = "docs/evidence/issue-6";
mkdirSync(directory, { recursive: true });
const files = paths.map((path) => {
  const bytes = git("show", `${checkpoint}:${path}`);
  return {
    sourcePath: path,
    sourceBlob: git("rev-parse", `${checkpoint}:${path}`).toString().trim(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
  };
});
writeFileSync(
  `${directory}/provenance.json`,
  JSON.stringify(
    {
      checkpoint,
      observedUpstream: live,
      note: "Relevant paths unchanged upstream; extraction source remains reviewed checkpoint. Private configured adaptations, standard protocol wrappers and public DTO tests; no source history imported.",
      files,
    },
    null,
    2,
  ) + "\n",
);
const baseline = JSON.parse(
  readFileSync("docs/evidence/issue-3/assertion-allocation.json", "utf8"),
);
const prior = JSON.parse(readFileSync("docs/evidence/issue-4/assertion-allocation.json", "utf8"));
const rules = [
  [
    /preparing a Site|preparation's report|after a refresh|reads WordPress anonymously/,
    "whole-Site refresh prepares all shared rows and listed entries, then serves through an outage",
  ],
  [/refresh.*read started earlier/, "a later %s refresh wins over an older in-flight read"],
  [
    /chrome read fails|no front page is set/,
    "first refresh with failed chrome is not ready; confirmed absent front page becomes missing",
  ],
  [
    /refresh.*failing on|failed chrome read|refresh replaces/,
    "failed %s refresh retains its last-known-good content and promotes independent reads",
  ],
  [
    /refresh.*can't write/,
    "failed store writes preserve stored content and return an operator failure report",
  ],
  [
    /failed list of published/,
    "failed published-route listing refreshes stored entries and reports incomplete refresh",
  ],
  [
    /changed menus and design/,
    "shared chrome and design refresh reaches every stored entry without republishing",
  ],
  [
    /refreshing a new publication|moved entry|moved back|refresh confirming an entry|route confirmed missing/,
    "refresh follows moves in both directions and replaces confirmed missing routes on later publication",
  ],
  [
    /full refresh.*absolute|absolute URI.*refreshed|percent-encoded/,
    "whole refresh normalizes absolute and percent-encoded CMS routes and carries no operator credentials to CMS",
  ],
  [/refresh request with/, "refresh validates body before transport: %s"],
  [/refresh.*without the token|refresh with %s/, "refresh authorization precedes JSON parsing: %s"],
  [
    /refresh is disabled/,
    "handlers refuse absent or short credentials independently of stored reads: %s",
  ],
  [/refresh is a POST/, "standard handlers reject other methods without bindings or CMS access"],
  [
    /refresh token.*another Site|entries and refresh token/,
    "long-lived handlers acquire current bindings and keep Site configurations isolated",
  ],
];
const suiteText =
  readFileSync("frontend/tests/refresh.test.ts", "utf8") +
  readFileSync("frontend/tests/protocol.test.ts", "utf8");
const allocation = baseline.files
  .filter((file) => paths.includes(file.path) && file.assertions.length)
  .map((file) => {
    const lines = git("show", `${checkpoint}:${file.path}`).toString().split("\n");
    const name = file.path.split("/").at(-1);
    const direct = /^(events|withdrawals)\.test\.ts$/.test(name);
    const destination = direct ? `frontend/tests/${name}` : undefined;
    return {
      sourcePath: file.path,
      assertions: file.assertions.map((row) => {
        const expression = lines.slice(row.sourceLines[0] - 1, row.sourceLines[1]).join("\n");
        if (direct) {
          const context = row.context.replaceAll("Worker restart", "database reopen");
          if (context !== "shared helper")
            assert.ok(
              readFileSync(destination, "utf8").includes(context.replaceAll('"', '\\"')),
              context,
            );
          if (/cacheControl/.test(expression))
            return {
              sourceLines: row.sourceLines,
              context: row.context,
              status: "Blueprint presentation retained",
              destination:
                "gq-site #77 public-page Cache-Control: no-cache; package handlers separately prove no-store",
            };
          return {
            sourceLines: row.sourceLines,
            context: row.context,
            status: "runtime behavior migrated #6",
            destination: destination + " :: " + context,
            note: /recordedEvents|storedRows|withdrawals\(\)/.test(expression)
              ? "Source SQL introspection replaced by handler duplicate/retry/order results and public delivery. Actual CMS record keys/wire shapes are tested by scripts/pair-proof.py."
              : /\.html/.test(expression)
                ? "Content projection uses public page/entry HTML field; no Site document rendering."
                : /301|[Ll]ocation/.test(expression)
                  ? "Redirect destination and moved DTO replace Site HTTP redirect wrapping (gq-site #77)."
                  : "Standard handler Response / public delivery projection. Node database reopen is not a Worker restart; local workerd update proof is separate.",
          };
        }
        if (/homepage|entries/.test(name)) {
          // Site markup, copy and CSS remain owned by the Blueprint even where a
          // corresponding runtime publication guarantee is separately exercised.
          if (
            /<title>|<a href|src=|prose-wp|--wp--|almost ready|Nothing here|Temporarily unavailable|September 30/.test(
              expression,
            )
          )
            return {
              sourceLines: row.sourceLines,
              context: row.context,
              status: "Blueprint presentation retained",
              destination: "gq-site #77; public DTO/store semantics in #4/#6",
            };
          const rule = rules.find(([pattern]) => pattern.test(row.context));
          if (rule) {
            assert.ok(suiteText.includes(rule[1]), rule[1]);
            return {
              sourceLines: row.sourceLines,
              context: row.context,
              status: "runtime behavior migrated #6",
              destination:
                "frontend/tests/" +
                (readFileSync("frontend/tests/refresh.test.ts", "utf8").includes(rule[1])
                  ? "refresh"
                  : "protocol") +
                ".test.ts :: " +
                rule[1],
              note: "Behavioral projection; SQL detail and Site HTML composition are not asserted at the package seam.",
            };
          }
          const previous = prior.files
            .find((f) => f.sourcePath === file.path)
            ?.assertions.find((a) => a.sourceLines.join() == row.sourceLines.join());
          return {
            ...(previous ?? row),
            status: previous?.status ?? "retained from #3 allocation",
          };
        }
        const paired =
          /publishing the page|an update reaches|a rename sends|new page is delivered|entry is served before|unpublishing sends|republishing serves|password-protecting|removing the password|deleting a published page/.test(
            row.context,
          );
        return {
          sourceLines: row.sourceLines,
          context: row.context,
          status: paired
            ? "installed transport/store projection #6; full smoke #11 pending"
            : "retained source allocation; not claimed by #6",
          destination: paired
            ? "scripts/pair-proof.py; GraphQL boundary stub, actual Composer/Bedrock/WordPress transport and installed Frontend; source full WPGraphQL/HTML/provisioning smoke remains #11 / gq-site #77"
            : row.home,
        };
      }),
    };
  });
writeFileSync(
  `${directory}/assertion-allocation.json`,
  JSON.stringify(
    {
      checkpoint,
      baseline: "../issue-3/assertion-allocation.json",
      priorDelivery: "../issue-4/assertion-allocation.json",
      note: "Assertion-span overlay for #6; projections are not copied Site HTML or private SQL expressions. #7/#8/#9/#11 and Blueprint allocations remain open as named. Source route wrappers have no standalone source test file; their validation/status/header statements are migrated to protocol.test.ts and exercised by all handler suites.",
      files: allocation,
      protocol: {
        source: ["src/pages/gq/events.ts", "src/pages/gq/refresh.ts"],
        destination: "frontend/tests/protocol.test.ts",
        guarantees: [
          "standard Response",
          "405 / Allow",
          "Cache-Control no-store",
          "authority before auth before JSON/schema",
          "WWW-Authenticate bearer challenge",
          "16 KiB byte cap and declared size",
          "5 minute HMAC window",
          "100 URIs",
          "path, JSON, unknown fields and language-home rejection",
          "binding freshness, browser guards and secret-safe failures",
        ],
      },
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Verified ${files.length} unchanged source paths against ${live}; allocated ${allocation.reduce((n, f) => n + f.assertions.length, 0)} source assertion spans.`,
);
