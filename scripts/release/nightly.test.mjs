import assert from "node:assert/strict";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";
import { test } from "vite-plus/test";
import {
  composerNightlyVersion,
  nightlyIdentity,
  packNightly,
  prepareNightly,
  verifyNightly,
} from "./nightly.mjs";

const root = resolve(import.meta.dirname, "../..");
const input = { sourceSha: "a".repeat(40), date: "20261025", sequence: 12, attempt: 1 };

test("nightly attempt identity is immutable and Composer has an installable dev version", () => {
  const identity = nightlyIdentity("0.3.2", input);
  assert.equal(identity.version, "0.3.3-nightly.20261025.12.1");
  assert.equal(composerNightlyVersion(identity.version), "dev-nightly-20261025.12.1");
  assert.notEqual(nightlyIdentity("0.3.2", { ...input, attempt: 2 }).tag, identity.tag);
  for (const bad of [{ sourceSha: "main" }, { sequence: 0 }, { attempt: 1.5 }, { date: "today" }])
    assert.throws(() => nightlyIdentity("0.3.2", { ...input, ...bad }));
});

// Stable retained-input validation must never repack its selected bytes.
test.skipIf(Boolean(process.env.GQ_RELEASE_BUNDLE))(
  "real ZIP and npm packing retain exact source identity and reject replacement bytes",
  () => {
    mkdirSync(join(root, ".proofs"), { recursive: true });
    const temp = mkdtempSync(join(root, ".proofs/content-nightly-"));
    try {
      for (const directory of ["cms", "frontend", "scripts"]) mkdirSync(join(temp, directory));
      for (const path of [
        "cms/composer.json",
        "cms/gq-content.php",
        "cms/README.md",
        "cms/LICENSE",
        "cms/modules",
        "frontend/package.json",
        "frontend/README.md",
        "frontend/dist",
        "frontend/migrations",
        "frontend/consent-migrations",
        "scripts/cms-package.py",
        "scripts/inspect-artifacts.mjs",
        "nightly-release-policy.json",
      ])
        cpSync(join(root, path), join(temp, path), { recursive: true });
      const metadata = JSON.parse(readFileSync(join(temp, "frontend/package.json"), "utf8"));
      const identity = nightlyIdentity(metadata.version, input);
      prepareNightly(temp, identity);
      const manifest = packNightly(temp, join(temp, "output"), identity);
      assert.equal(manifest.sourceSha, input.sourceSha);
      assert.equal(manifest.plugin.composer.type, "wordpress-muplugin");
      assert.equal(manifest.packages[0].name, "@getquick/content");
      assert.equal(manifest.migrations.destructive, false);
      assert.equal(
        JSON.parse(readFileSync(join(root, "frontend/package.json"))).version,
        metadata.version,
      );
      assert.deepEqual(verifyNightly(temp, join(temp, "output")), manifest);
      assert.throws(() => packNightly(temp, join(temp, "output"), identity), /Never overwrite/);
      for (const artifact of [manifest.plugin, manifest.packages[0]]) {
        const path = join(temp, "output", artifact.asset);
        const original = readFileSync(path);
        writeFileSync(path, "substituted");
        assert.throws(() => verifyNightly(temp, join(temp, "output")), /Artifact changed/);
        writeFileSync(path, original);
      }
      // A missing or altered PHP version cannot silently become a mixed pair.
      const php = join(temp, "cms/gq-content.php");
      writeFileSync(php, readFileSync(php, "utf8").replace(identity.version, "wrong-version"));
      assert.throws(() => prepareNightly(temp, nightlyIdentity(metadata.version, input)));
    } finally {
      rmSync(temp, { recursive: true, force: true });
    }
  },
);
