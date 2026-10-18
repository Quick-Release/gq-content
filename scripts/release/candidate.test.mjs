import { test } from "node:test";
import assert from "node:assert/strict";
import { chmodSync, mkdtempSync, cpSync, readFileSync, writeFileSync, rmSync } from "node:fs";
import { join } from "node:path";
import { tmpdir } from "node:os";
import { load, hash } from "./candidate.mjs";
import { verifyRecord } from "./validate.mjs";

// A real retained pair is supplied by the validation runner, never synthetic tar/ZIP bytes.
await test(
  "retained inputs reject substituted archives and source-mismatched validation",
  { skip: !process.env.GQ_RELEASE_BUNDLE },
  () => {
    const temp = mkdtempSync(join(tmpdir(), "gq-candidate-test-"));
    try {
      cpSync(process.env.GQ_RELEASE_BUNDLE, temp, { recursive: true });
      const original = load(temp, false);
      for (const kind of ["npm", "cms"]) {
        const path = join(temp, original.manifest[kind].filename);
        const bytes = readFileSync(path);
        writeFileSync(path, "replaced");
        assert.throws(() => load(temp, false), /retained artifact replaced/);
        writeFileSync(path, bytes);
      }
      const manifestPath = join(temp, "release-manifest.json");
      chmodSync(manifestPath, 0o644);
      writeFileSync(
        manifestPath,
        JSON.stringify({ ...original.manifest, sourceCommit: "0".repeat(40) }),
      );
      assert.throws(() => load(temp), /source commit/);
      writeFileSync(manifestPath, original.assets["release-manifest.json"]);
      writeFileSync(
        join(temp, "validation.json"),
        JSON.stringify({ schemaVersion: 1, sourceCommit: "0".repeat(40) }),
      );
      assert.throws(() => verifyRecord(original));
      writeFileSync(
        join(temp, "validation.json"),
        JSON.stringify({
          schemaVersion: 1,
          sourceCommit: original.manifest.sourceCommit,
          manifestSha256: hash(original.assets["release-manifest.json"]),
          checks: [],
        }),
      );
      assert.throws(() => verifyRecord(original));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);

await test(
  "release CLI refuses replaced retained bytes and missing publication credentials",
  { skip: !process.env.GQ_RELEASE_BUNDLE },
  async () => {
    const { spawnSync } = await import("node:child_process");
    const candidate = load(process.env.GQ_RELEASE_BUNDLE);
    const env = Object.fromEntries(
      Object.entries(process.env).filter(([key]) => !/TOKEN|PASSWORD|USERNAME/.test(key)),
    );
    const result = spawnSync(
      process.execPath,
      ["scripts/release.mjs", "publish", candidate.directory, "123"],
      { encoding: "utf8", env },
    );
    assert.equal(result.status, 1);
    assert.match(result.stderr, /missing GitHub\/registry dispatch\/Composer credentials/);
    assert.match(result.stderr, /"handoff":false/);
  },
);
