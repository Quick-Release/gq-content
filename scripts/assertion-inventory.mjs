import ts from "typescript";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { resolve } from "node:path";
import assert from "node:assert/strict";
const sourceRepo = resolve(process.argv[2] ?? "../gq-site");
const checkpoint = "eaec13488d57b3d04059309b5b36de5d016f3de1";
const base = "blueprint/templates/apps/frontend/src/";
const migrated = [
  "wp-block-renderer",
  "wp-block-styles",
  "wp-container-layout",
  "wordpress",
  "wordpress-access",
  "site-language",
];
const suites = [
  ...migrated.map((name) => `${base}lib/${name}.test.ts`),
  ...[
    "homepage",
    "entries",
    "routes",
    "events",
    "withdrawals",
    "settings",
    "retries",
    "reconciliation",
    "languages",
    "language-updates",
  ].map((name) => `${base}${name}.test.ts`),
];
const smokes = [
  "frontend-runtime.sh",
  "frontend-runtime.mjs",
  "frontend-runtime-lib.mjs",
  "cms-events.sh",
  "cms-events.mjs",
  "frontend-languages.mjs",
  "cms-polylang.sh",
  "cms-polylang.mjs",
].map((name) => `scripts/smoke/${name}`);
const support = ["sqlite-d1", "wordpress-stub"].map((name) => `${base}test/${name}.ts`);
function calls(text, path) {
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const assertions = [];
  const printer = ts.createPrinter({ removeComments: true });
  function visit(node) {
    if (ts.isCallExpression(node)) {
      const expression = node.expression.getText(file);
      if (
        (expression.startsWith("expect(") && expression.includes(").")) ||
        (expression === "check" && node.arguments[0] && ts.isStringLiteral(node.arguments[0]))
      ) {
        const start = file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1;
        const end = file.getLineAndCharacterOfPosition(node.end).line + 1;
        let context =
          expression === "check" && node.arguments[0] && ts.isStringLiteral(node.arguments[0])
            ? node.arguments[0].text
            : "shared helper";
        for (let parent = node.parent; parent; parent = parent.parent) {
          if (ts.isCallExpression(parent) && /^(test|it)\b/.test(parent.expression.getText(file))) {
            context =
              parent.arguments.find((arg) => ts.isStringLiteral(arg))?.text ?? "parameterized test";
            break;
          }
        }
        assertions.push({
          start,
          end,
          context,
          printed: printer.printNode(ts.EmitHint.Unspecified, node, file),
        });
      }
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  return assertions;
}
function allocation(path, assertion) {
  if (path.endsWith(".sh"))
    return {
      home: "gq-site#77 harness generation/provisioning; gq-content#11 owns replacement installed-package runner",
      status: "handoff/pending",
    };
  if (path.includes("/lib/"))
    return { home: `frontend/tests/${path.split("/").at(-1)}`, status: "migrated #3" };
  const description = assertion.context + " " + assertion.printed;
  const blueprint =
    /gq site check|polylang configuration|generated|installer|WordPress running but not installed|isn't a WPGraphQL endpoint|GETQUICK Design/i.test(
      description,
    );
  if (blueprint)
    return {
      home: "gq-site#77 readiness orchestration/provisioning; retain runtime response obligation in #9/#11",
      status: "handoff/pending",
    };
  let owner = "#4 publishedHome/publishedEntry/pageChrome";
  if (/events|withdrawals/.test(path))
    owner = "#6 handleEvent/handleRefresh and CMS publication/withdrawal";
  if (/settings|languages|language-updates|cms-polylang|frontend-languages/.test(path))
    owner = "#7 shared settings and language-specific delivery";
  if (/retries/.test(path) || /retry|scheduler|backoff|cron/i.test(description))
    owner = "#8 CMS retry scheduler";
  if (
    /reconciliation/.test(path) ||
    /reconcil|lease|budget|lost change|missed change|behind/i.test(description)
  )
    owner = "#9 reconciliation/readiness";
  if (
    /token|unauthoriz|POST|bearer|refresh.*refus|invalid.*request|100.URI|unknown.field/i.test(
      assertion.context,
    )
  )
    owner = "#6 handleRefresh protocol";
  const html = /html|switcher\(|alternates\(|served\(/i.test(assertion.printed);
  return {
    home: `gq-content${owner}: public boundary equivalent${html ? "; gq-site#77 retains HTML composition, labels, metadata and CSS wiring" : ""}${path.startsWith("scripts/") ? "; installed real-runtime proof #11" : ""}`,
    status: "pending",
  };
}
const files = [];
for (const path of [...suites, ...smokes, ...support]) {
  const text = execFileSync("git", ["-C", sourceRepo, "show", `${checkpoint}:${path}`], {
    encoding: "utf8",
  });
  const assertions = path.endsWith(".sh") ? [] : calls(text, path);
  const rows = assertions.map((item) => ({
    sourceLines: [item.start, item.end],
    context: item.context,
    ...allocation(path, item),
  }));
  if (path.includes("/lib/")) {
    const destination = `frontend/tests/${path.split("/").at(-1)}`;
    const actual = calls(readFileSync(destination, "utf8"), destination);
    assert.equal(actual.length, assertions.length, `${path}: assertion count`);
    for (let i = 0; i < assertions.length; i++) {
      const original = assertions[i].printed
        .replaceAll("{{project}}-admin.ddev.site", "cms.example.test")
        .replaceAll("{{project}}.example", "frontend.example.test");
      assert.equal(
        actual[i].printed,
        original,
        `${path}:${assertions[i].start}: preserved assertion`,
      );
      rows[i].destinationLines = [actual[i].start, actual[i].end];
    }
  }
  files.push({
    path,
    sourceBlob: execFileSync("git", ["-C", sourceRepo, "rev-parse", `${checkpoint}:${path}`], {
      encoding: "utf8",
    }).trim(),
    assertions: rows,
    ...(rows.length
      ? {}
      : {
          allocation: path.endsWith(".sh")
            ? allocation(path, { printed: "" })
            : {
                home: "private test support #4/#6/#11; frontend-runtime-lib helpers #11 with Blueprint HTML wiring retained by gq-site#77",
                status: "pending",
              },
        }),
  });
}
writeFileSync(
  "docs/evidence/issue-3/assertion-allocation.json",
  JSON.stringify(
    {
      checkpoint,
      note: "Exact assertion spans at immutable checkpoint; test.each rows retain their entire data tables in migrated suites. Pending allocations are requirements, not passed proof. Mixed HTML assertions require runtime DTO equivalents and Blueprint presentation handoff.",
      files,
    },
    null,
    2,
  ) + "\n",
);
execFileSync("vp", ["fmt", "docs/evidence/issue-3/assertion-allocation.json"], {
  stdio: "inherit",
});
console.log(
  `Inventoried ${files.length} source files and ${files.reduce((n, file) => n + file.assertions.length, 0)} assertions; all six migrated suites preserve their assertion expressions.`,
);
