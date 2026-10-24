import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync, writeFileSync, mkdirSync, readdirSync } from "node:fs";
import { resolve, join, basename } from "node:path";

export const root = resolve(import.meta.dirname, "../..");
export const run = (cmd, args, options = {}) =>
  execFileSync(cmd, args, { cwd: root, encoding: "utf8", ...options });
export const hash = (bytes, algorithm = "sha256", encoding = "hex") =>
  createHash(algorithm).update(bytes).digest(encoding);
export const head = () => run("git", ["rev-parse", "HEAD"]).trim();
export function revision(manifest) {
  assert.equal(manifest.sourceCommit, head(), "candidate source commit differs from checkout");
  assert.equal(
    run("git", ["status", "--porcelain", "--untracked-files=normal"]).trim(),
    "",
    "candidate requires a clean checkout",
  );
}
export function load(directory, checkRevision = true) {
  directory = resolve(directory);
  const bytes = readFileSync(join(directory, "release-manifest.json"));
  const manifest = JSON.parse(bytes);
  assert.equal(manifest.schemaVersion, 1);
  assert.equal(manifest.version, "0.3.2");
  assert.equal(manifest.tag, `v${manifest.version}`);
  assert.match(manifest.sourceCommit, /^[a-f0-9]{40}$/);
  if (checkRevision) revision(manifest);
  const assets = { "release-manifest.json": bytes };
  for (const [kind, expected] of Object.entries({
    npm: "getquick-content-0.3.2.tgz",
    cms: "gq-content-0.3.2.zip",
  })) {
    const item = manifest[kind];
    assert.equal(item.filename, expected);
    const content = readFileSync(join(directory, item.filename));
    assert.equal(hash(content), item.sha256, `${kind} retained artifact replaced`);
    if (kind === "npm") assert.equal("sha512-" + hash(content, "sha512", "base64"), item.integrity);
    assets[item.filename] = content;
  }
  run("node", [
    "scripts/inspect-artifacts.mjs",
    join(directory, manifest.npm.filename),
    join(directory, manifest.cms.filename),
  ]);
  const npm = JSON.parse(
    run("tar", ["-xOzf", join(directory, manifest.npm.filename), "package/package.json"]),
  );
  const composer = JSON.parse(
    run("unzip", ["-p", join(directory, manifest.cms.filename), "composer.json"]),
  );
  const php = run("unzip", ["-p", join(directory, manifest.cms.filename), "gq-content.php"]);
  assert.equal(npm.name, "@getquick/content");
  assert.equal(composer.name, "getquick/gq-content");
  for (const item of [npm, composer]) assert.equal(item.version, manifest.version);
  assert.match(php, /Version: 0\.3\.2/);
  assert.match(php, /const VERSION = '0\.3\.2';/);
  return {
    directory,
    manifest,
    assets,
    npmIdentity: manifest.npm.integrity + ":" + manifest.npm.sha256,
    composerIdentity: manifest.cms.sha256,
  };
}
export function build(directory) {
  assert(!process.env.GQ_RELEASE_BUNDLE, "build cannot use retained proof input");
  const sourceCommit = head();
  revision({ sourceCommit });
  directory = resolve(directory);
  mkdirSync(directory, { recursive: true });
  assert.equal(
    readdirSync(directory).length,
    0,
    "candidate directory must be empty; never rebuild a candidate",
  );
  run("vp", ["pack"], { stdio: "inherit" });
  run("vp", ["pm", "pack", "--pack-destination", directory], {
    cwd: join(root, "frontend"),
    stdio: "inherit",
  });
  const zip = run("python3", ["scripts/cms-package.py"]).trim();
  writeFileSync(join(directory, basename(zip)), readFileSync(zip), { flag: "wx" });
  const identity = (filename) => ({
    filename,
    sha256: hash(readFileSync(join(directory, filename))),
  });
  const npm = identity("getquick-content-0.3.2.tgz");
  npm.integrity = "sha512-" + hash(readFileSync(join(directory, npm.filename)), "sha512", "base64");
  const manifest = {
    schemaVersion: 1,
    version: "0.3.2",
    tag: "v0.3.2",
    sourceCommit,
    npm,
    cms: identity("gq-content-0.3.2.zip"),
  };
  writeFileSync(
    join(directory, "release-manifest.json"),
    JSON.stringify(manifest, null, 2) + "\n",
    { flag: "wx", mode: 0o444 },
  );
  return load(directory);
}
// Called by consumers before installing; no fallback/repack when a candidate was selected.
export function retained(kind) {
  if (!process.env.GQ_RELEASE_BUNDLE) return null;
  const candidate = load(process.env.GQ_RELEASE_BUNDLE);
  return join(candidate.directory, candidate.manifest[kind].filename);
}
if (process.argv[1] === import.meta.filename) console.log(retained(process.argv[2]));
