import { load, hash } from "./release/candidate.mjs";
import { createHash } from "node:crypto";
import { copyFileSync, mkdirSync, readFileSync, writeFileSync } from "node:fs";
import { basename, join, resolve } from "node:path";

// Retain the actual bytes consumed, including proofs whose temporary consumer is removed.
export function recordArtifact(path, proof) {
  const directory = resolve(import.meta.dirname, "../.proofs/artifacts");
  mkdirSync(directory, { recursive: true });
  const bytes = readFileSync(path);
  const identity = {
    proof,
    filename: basename(path),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    integrity: "sha512-" + createHash("sha512").update(bytes).digest("base64"),
  };
  if (process.env.GQ_RELEASE_BUNDLE) {
    const candidate = load(process.env.GQ_RELEASE_BUNDLE);
    if (identity.sha256 !== candidate.manifest.npm.sha256)
      throw Error("proof consumed different retained npm bytes");
    identity.sourceCommit = candidate.manifest.sourceCommit;
    identity.manifestSha256 = hash(candidate.assets["release-manifest.json"]);
  }
  copyFileSync(path, join(directory, `${proof}-${identity.filename}`));
  writeFileSync(join(directory, `${proof}.json`), JSON.stringify(identity, null, 2) + "\n");
  console.log("Installed candidate artifact: " + JSON.stringify(identity));
}
