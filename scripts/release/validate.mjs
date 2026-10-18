import assert from "node:assert/strict";
import { spawnSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { join } from "node:path";
import { load, hash, root, revision } from "./candidate.mjs";

/** @type {Array<[string, string, string[]]>} */
export const checks = [
  ["quality", "vp", ["check"]],
  ["types", "vp", ["exec", "tsc", "--noEmit"]],
  ["P4", "vp", ["test"]],
  ["P1", "node", ["scripts/alchemy-consumer.mjs"]],
  ["P2", "python3", ["scripts/cms-proof.py"]],
  ["P3", "node", ["scripts/consumer.mjs"]],
  ["pair", "python3", ["scripts/pair-proof.py"]],
  ["retry", "python3", ["scripts/pair-proof.py", "--retries"]],
  ["polylang", "python3", ["scripts/multilingual-proof.py"]],
  ["P6", "node", ["scripts/alchemy-consumer.mjs", "--reconciliation"]],
  ["P5-registry", "node", ["compatibility/registry.mjs"]],
  ["P5-types", "vp", ["exec", "tsc", "--noEmit", "-p", "compatibility/tsconfig.json"]],
  ["P5", "node", ["scripts/consumer.mjs", "--design-fixtures"]],
  [
    "P7",
    "node",
    [
      "--test",
      "scripts/release/pipeline.test.mjs",
      "scripts/release/candidate.test.mjs",
      "scripts/release/services.test.mjs",
    ],
  ],
];
export function verifyRecord(candidate) {
  const record = JSON.parse(readFileSync(join(candidate.directory, "validation.json")));
  assert.equal(record.schemaVersion, 1, "release validation proof record missing/invalid");
  assert.equal(record.sourceCommit, candidate.manifest.sourceCommit);
  assert.equal(record.manifestSha256, hash(candidate.assets["release-manifest.json"]));
  assert.deepEqual(
    record.checks.map(({ name, command }) => [name, ...command]),
    checks.map(([name, cmd, args]) => [name, cmd, ...args]),
  );
  for (const item of record.checks) {
    assert.equal(item.exitCode, 0, `failed proof ${item.name}`);
    assert.equal(item.log, `logs/${item.name}.log`);
    assert.equal(
      hash(readFileSync(join(candidate.directory, item.log))),
      item.sha256,
      `proof log replaced ${item.name}`,
    );
  }
  return record;
}
export function validate(directory) {
  const candidate = load(directory);
  const checksRun = [];
  mkdirSync(join(candidate.directory, "logs"), { recursive: true });
  // No record survives an interrupted rerun and no prior result skips a command.
  writeFileSync(join(candidate.directory, "validation.json"), "{}\n");
  for (const [name, command, args] of checks) {
    console.log(`Running ${name}`);
    load(directory);
    const result = spawnSync(command, args, {
      cwd: root,
      env: { ...process.env, GQ_RELEASE_BUNDLE: candidate.directory },
      encoding: "utf8",
      maxBuffer: 64 * 1024 * 1024,
    });
    const bytes = Buffer.from(
      JSON.stringify({
        sourceCommit: candidate.manifest.sourceCommit,
        manifestSha256: hash(candidate.assets["release-manifest.json"]),
        npm: candidate.manifest.npm,
        cms: candidate.manifest.cms,
      }) +
        "\n" +
        (result.stdout ?? "") +
        (result.stderr ?? ""),
    );
    // Registry helper deliberately emits metadata only. No command echoes credentials.
    const log = `logs/${name}.log`;
    writeFileSync(join(candidate.directory, log), bytes);
    assert.equal(result.status, 0, `${name} failed; see ${log}`);
    checksRun.push({
      name,
      command: [command, ...args],
      exitCode: result.status,
      log,
      sha256: hash(bytes),
    });
    console.log(`Passed ${name}`);
  }
  revision(candidate.manifest);
  load(directory);
  writeFileSync(
    join(candidate.directory, "validation.json"),
    JSON.stringify(
      {
        schemaVersion: 1,
        sourceCommit: candidate.manifest.sourceCommit,
        manifestSha256: hash(candidate.assets["release-manifest.json"]),
        checks: checksRun,
      },
      null,
      2,
    ) + "\n",
  );
  verifyRecord(candidate);
}
