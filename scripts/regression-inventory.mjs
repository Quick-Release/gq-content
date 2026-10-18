// Final allocation at the immutable source checkpoint; never rewrite historical overlays.
import ts from "typescript";
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync } from "node:fs";
import { createHash } from "node:crypto";
const baseline = JSON.parse(readFileSync("docs/evidence/issue-3/assertion-allocation.json"));
const decisions = JSON.parse(readFileSync("docs/evidence/issue-11/assertion-map.json"));
const overlays = [3, 4, 6, 7, 8, 9].map((issue) => {
  const path = `docs/evidence/issue-${issue}/assertion-allocation.json`;
  const text = readFileSync(path, "utf8");
  const overlay = JSON.parse(text);
  assert.equal(overlay.checkpoint, baseline.checkpoint);
  for (const file of overlay.files) {
    const original = baseline.files.find((f) => f.path === (file.sourcePath ?? file.path));
    assert.ok(original, path);
    if (file.sourceBlob) assert.equal(file.sourceBlob, original.sourceBlob);
    for (const row of file.assertions)
      assert.ok(
        original.assertions.some((a) => a.sourceLines.join(":") === row.sourceLines.join(":")),
        `${path}: source span`,
      );
  }
  return { path, sha256: createHash("sha256").update(text).digest("hex") };
});
const source = process.argv[2] ?? "../gq-site";
const sha = (value) => createHash("sha256").update(value).digest("hex");
const testCache = new Map();
function tests(path) {
  if (testCache.has(path)) return testCache.get(path);
  const text = readFileSync(path, "utf8");
  const file = ts.createSourceFile(path, text, ts.ScriptTarget.Latest, true);
  const found = [];
  function visit(node) {
    if (ts.isCallExpression(node) && /^(test|it)\b/.test(node.expression.getText(file))) {
      const name = node.arguments.find(ts.isStringLiteral)?.text;
      if (name)
        found.push({
          name,
          lines: [
            file.getLineAndCharacterOfPosition(node.getStart(file)).line + 1,
            file.getLineAndCharacterOfPosition(node.end).line + 1,
          ],
        });
    }
    ts.forEachChild(node, visit);
  }
  visit(file);
  testCache.set(path, found);
  return found;
}
const files = baseline.files.map((file) => {
  const text = execFileSync("git", ["-C", source, "show", `${baseline.checkpoint}:${file.path}`], {
    encoding: "utf8",
  });
  const blob = execFileSync(
    "git",
    ["-C", source, "rev-parse", `${baseline.checkpoint}:${file.path}`],
    { encoding: "utf8" },
  ).trim();
  assert.equal(blob, file.sourceBlob);
  const lines = text.split("\n");
  const allocations = decisions[file.path];
  assert.ok(allocations, file.path);
  function resolveDecision(a) {
    const decision =
      allocations[String(a.sourceLines?.[0])] ?? allocations[a.context] ?? allocations.file;
    assert.ok(decision, `${file.path}:${a.sourceLines}: missing final decision`);
    assert.ok(
      decision.runtime?.length || decision.blueprint,
      `${file.path}:${a.sourceLines}: unowned`,
    );
    const runtime = (decision.runtime ?? []).map(({ path, test, check }) => {
      const destination = readFileSync(path, "utf8");
      if (test) {
        const match = tests(path).find((t) => t.name === test);
        assert.ok(match, `${path}: missing exact test ${test}`);
        return {
          path,
          test,
          lines: match.lines,
          sha256: sha(
            destination
              .split("\n")
              .slice(match.lines[0] - 1, match.lines[1])
              .join("\n"),
          ),
        };
      }
      assert.ok(check && destination.includes(check), `${path}: missing proof check ${check}`);
      const start = destination.slice(0, destination.indexOf(check)).split("\n").length;
      return { path, check, line: start, fileSha256: sha(destination) };
    });
    return {
      owner: runtime.length ? "Quick-Release/gq-content" : "Quick-Release/gq-site#77",
      runtime,
      ...(decision.blueprint ? { blueprintObligation: decision.blueprint } : {}),
      behavior: decision.behavior,
    };
  }
  return {
    path: file.path,
    sourceBlob: blob,
    sourceSha256: sha(text),
    assertions: file.assertions.map((a) => ({
      sourceLines: a.sourceLines,
      context: a.context,
      ...(a.destinationLines ? { preservedDestinationLines: a.destinationLines } : {}),
      source: lines.slice(a.sourceLines[0] - 1, a.sourceLines[1]).join("\n"),
      ...resolveDecision(a),
    })),
    ...(file.assertions.length ? {} : { allocation: resolveDecision({}) }),
  };
});
assert.equal(files.length, 26);
assert.equal(
  files.reduce((n, f) => n + f.assertions.length, 0),
  1011,
);
assert.equal(
  files.filter((f) => f.path.includes("/lib/")).reduce((n, f) => n + f.assertions.length, 0),
  139,
);
writeFileSync(
  "docs/evidence/issue-11/assertion-inventory.json",
  JSON.stringify(
    {
      checkpoint: baseline.checkpoint,
      historicalOverlays: overlays,
      note: "Final per-assertion allocation. Exact source spans/blobs verified; destinations are exact runnable test names or named proof checks. Runtime projections assert public DTO/protocol outcomes; accompanying Blueprint obligations explicitly retain rendered-document/provisioning assertions. Historical overlays #3–#9 are inputs, not proof completion claims.",
      files,
    },
    null,
    2,
  ) + "\n",
);
execFileSync("vp", ["fmt", "docs/evidence/issue-11/assertion-inventory.json"], {
  stdio: "inherit",
});
console.log(
  "Final allocation: 26 files, 1,011 source assertions, 139 retained six-library assertions; every runtime destination resolves.",
);
