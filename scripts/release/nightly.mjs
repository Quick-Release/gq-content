// Development releases follow Design's immutable artifact protocol. Stable
// releases continue to use candidate.mjs, validate.mjs and pipeline.mjs.
import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import {
  appendFileSync,
  copyFileSync,
  mkdirSync,
  readFileSync,
  readdirSync,
  writeFileSync,
} from "node:fs";
import { basename, join, resolve } from "node:path";
import { pathToFileURL } from "node:url";

const repositoryRoot = resolve(import.meta.dirname, "../..");
const json = (path) => JSON.parse(readFileSync(path, "utf8"));
const save = (path, value) => writeFileSync(path, JSON.stringify(value, null, 2) + "\n");
const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
const run = (root, command, args) =>
  execFileSync(command, args, { cwd: root, encoding: "utf8", maxBuffer: 64 * 1024 * 1024 });

export function nightlyIdentity(base, { sourceSha, date, sequence, attempt }) {
  assert.match(base, /^\d+\.\d+\.\d+$/, "Nightlies require a stable source version");
  assert.match(sourceSha ?? "", /^[a-f0-9]{40}$/, "A full source SHA is required");
  assert.match(date ?? "", /^\d{8}$/, "UTC YYYYMMDD date required");
  for (const value of [sequence, attempt])
    assert(Number.isSafeInteger(value) && value > 0, "Run identity must be positive integers");
  const parts = base.split(".").map(Number);
  parts[2] += 1;
  const version = `${parts.join(".")}-nightly.${date}.${sequence}.${attempt}`;
  return { channel: "nightly", version, tag: `v${version}`, sourceSha, sequence, attempt };
}
export function composerNightlyVersion(version) {
  const match = /^\d+\.\d+\.\d+-nightly\.(\d{8}\.\d+\.\d+)$/.exec(version);
  assert(match, "Expected nightly SemVer");
  return `dev-nightly-${match[1]}`;
}

/** Stage only distributable version metadata in a disposable checkout. */
export function prepareNightly(root, identity) {
  const frontend = json(join(root, "frontend/package.json"));
  const composer = json(join(root, "cms/composer.json"));
  assert.equal(frontend.name, "@getquick/content");
  assert.equal(composer.name, "getquick/gq-content");
  assert.equal(frontend.version, composer.version, "Source package versions must agree");
  assert.match(frontend.version, /^\d+\.\d+\.\d+$/);
  const phpPath = join(root, "cms/gq-content.php");
  let php = readFileSync(phpPath, "utf8");
  for (const [before, after] of [
    [` * Version: ${frontend.version}\n`, ` * Version: ${identity.version}\n`],
    [`const VERSION = '${frontend.version}';`, `const VERSION = '${identity.version}';`],
  ]) {
    assert.equal(php.split(before).length, 2, "Plugin source version must agree");
    php = php.replace(before, after);
  }
  frontend.version = identity.version;
  composer.version = composerNightlyVersion(identity.version);
  save(join(root, "frontend/package.json"), frontend);
  save(join(root, "cms/composer.json"), composer);
  writeFileSync(phpPath, php);
}

/** Pack the already-built frontend and the existing CMS allowlist exactly once. */
export function packNightly(root, directory, identity) {
  mkdirSync(directory, { recursive: true });
  assert.equal(readdirSync(directory).length, 0, "Never overwrite nightly artifacts");
  const metadata = json(join(root, "frontend/package.json"));
  const composer = json(join(root, "cms/composer.json"));
  assert.equal(metadata.version, identity.version);
  assert.equal(composer.version, composerNightlyVersion(identity.version));
  run(join(root, "frontend"), "vp", ["pm", "pack", "--pack-destination", resolve(directory)]);
  const zip = run(root, "python3", ["scripts/cms-package.py"]).trim();
  const pluginAsset = `content-nightly-${identity.version}.zip`;
  copyFileSync(zip, join(directory, pluginAsset));
  const npmAsset = `getquick-content-${identity.version}.tgz`;
  const npmBytes = readFileSync(join(directory, npmAsset));
  const policy = json(join(root, "nightly-release-policy.json"));
  assert.equal(typeof policy.destructiveMigrations, "boolean", "Classify migrations explicitly");
  const manifest = {
    schemaVersion: 1,
    ...identity,
    migrations: { destructive: policy.destructiveMigrations },
    plugin: { name: composer.name, asset: pluginAsset, sha256: hash(readFileSync(zip)), composer },
    packages: [
      {
        name: metadata.name,
        version: identity.version,
        asset: npmAsset,
        sha256: hash(npmBytes),
        integrity: "sha512-" + hash(npmBytes, "sha512", "base64"),
      },
    ],
  };
  writeFileSync(join(directory, "content-release.json"), JSON.stringify(manifest, null, 2) + "\n", {
    flag: "wx",
  });
  verifyNightly(root, directory);
  return manifest;
}

/** Packaging assertions, not behavioral suites; no registry credentials in artifacts. */
export function verifyNightly(root, directory) {
  const manifest = json(join(directory, "content-release.json"));
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.channel, "nightly");
  assert.equal(manifest.tag, `v${manifest.version}`);
  assert.match(manifest.sourceSha, /^[a-f0-9]{40}$/);
  assert.equal(manifest.plugin.name, "getquick/gq-content");
  assert.equal(manifest.plugin.composer.version, composerNightlyVersion(manifest.version));
  assert.equal(manifest.packages.length, 1);
  const npm = manifest.packages[0];
  assert.equal(npm.name, "@getquick/content");
  assert.equal(npm.version, manifest.version);
  for (const artifact of [manifest.plugin, npm]) {
    assert.equal(basename(artifact.asset), artifact.asset);
    const bytes = readFileSync(join(directory, artifact.asset));
    assert.equal(hash(bytes), artifact.sha256, "Artifact changed after packaging");
    if (artifact === npm)
      assert.equal("sha512-" + hash(bytes, "sha512", "base64"), artifact.integrity);
  }
  const npmMetadata = JSON.parse(
    run(root, "tar", ["-xOzf", join(directory, npm.asset), "package/package.json"]),
  );
  const composer = JSON.parse(
    run(root, "unzip", ["-p", join(directory, manifest.plugin.asset), "composer.json"]),
  );
  const php = run(root, "unzip", ["-p", join(directory, manifest.plugin.asset), "gq-content.php"]);
  assert.equal(npmMetadata.name, npm.name);
  assert.equal(npmMetadata.version, manifest.version);
  assert.deepEqual(composer, manifest.plugin.composer);
  assert(php.includes(` * Version: ${manifest.version}\n`));
  assert(php.includes(`const VERSION = '${manifest.version}';`));
  run(root, "node", [
    "scripts/inspect-artifacts.mjs",
    join(directory, npm.asset),
    join(directory, manifest.plugin.asset),
  ]);
  return manifest;
}

if (process.argv[1] && import.meta.url === pathToFileURL(process.argv[1]).href) {
  const [command, output = ".artifacts/nightly"] = process.argv.slice(2);
  const directory = resolve(output);
  const state = join(directory, "identity.json");
  const assets = join(directory, "assets");
  if (command === "prepare") {
    assert(!process.env.GQ_RELEASE_BUNDLE, "Nightlies cannot use stable retained inputs");
    assert.equal(
      run(repositoryRoot, "git", ["status", "--porcelain"]).trim(),
      "",
      "Start with clean source",
    );
    assert.equal(
      run(repositoryRoot, "git", ["rev-parse", "HEAD"]).trim(),
      process.env.GITHUB_SHA,
      "Build the triggering SHA",
    );
    const identity = nightlyIdentity(json(join(repositoryRoot, "frontend/package.json")).version, {
      sourceSha: process.env.GITHUB_SHA,
      sequence: Number(process.env.GITHUB_RUN_NUMBER),
      attempt: Number(process.env.GITHUB_RUN_ATTEMPT),
      date: new Date().toISOString().slice(0, 10).replaceAll("-", ""),
    });
    mkdirSync(directory, { recursive: true });
    writeFileSync(state, JSON.stringify(identity) + "\n", { flag: "wx" });
    prepareNightly(repositoryRoot, identity);
    if (process.env.GITHUB_OUTPUT)
      appendFileSync(
        process.env.GITHUB_OUTPUT,
        `version=${identity.version}\ntag=${identity.tag}\n`,
      );
    console.log(`Staged ${identity.tag} from ${identity.sourceSha}`);
  } else if (command === "pack") {
    packNightly(repositoryRoot, assets, json(state));
  } else if (command === "verify") {
    verifyNightly(repositoryRoot, assets);
  } else throw new Error("Use nightly.mjs prepare|pack|verify [directory]");
}
