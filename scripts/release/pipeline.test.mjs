import { load } from "./candidate.mjs";
import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { resume } from "./pipeline.mjs";

test("interrupted publication resumes verified stages and blocks partial availability", async () => {
  const remote = { tag: null, assets: {}, npm: null, composer: null };
  const writes = [];
  const candidate = process.env.GQ_RELEASE_BUNDLE
    ? load(process.env.GQ_RELEASE_BUNDLE)
    : {
        manifest: { sourceCommit: "a".repeat(40), tag: "v0.2.0", version: "0.2.0" },
        assets: { "release-manifest.json": Buffer.from("manifest") },
        npmIdentity: "npm",
        composerIdentity: "zip",
      };
  const manifest = candidate.manifest;
  const service = {
    gate: async () => {},
    tag: async () => remote.tag,
    createTag: async () => {
      remote.tag = manifest.sourceCommit;
      writes.push("tag");
    },
    asset: async (name) => remote.assets[name],
    upload: async (name, bytes) => {
      remote.assets[name] = bytes;
      writes.push(name);
    },
    npm: async () => remote.npm,
    publish: async () => {
      remote.npm = candidate.npmIdentity;
      writes.push("npm");
      throw Error("interrupted");
    },
    composer: async () => remote.composer,
    dispatch: async () => {
      writes.push("dispatch");
    },
  };
  await assert.rejects(resume(candidate, service), /interrupted/);
  assert.equal((await resume(candidate, service)).status, "partial");
  assert.deepEqual(
    writes,
    process.env.GQ_RELEASE_BUNDLE
      ? [
          "tag",
          "release-manifest.json",
          "getquick-content-0.2.0.tgz",
          "gq-content-0.2.0.zip",
          "npm",
          "dispatch",
        ]
      : ["tag", "release-manifest.json", "npm", "dispatch"],
  );
  remote.composer = candidate.composerIdentity;
  assert.equal((await resume(candidate, service)).status, "complete");
  remote.tag = "b".repeat(40);
  await assert.rejects(resume(candidate, service), /tag mismatch/);
});

/** @type {Array<[string, Buffer | string, RegExp]>} */
const mismatches = [
  ["assets", Buffer.from("substituted"), /asset mismatch/],
  ["npm", "wrong-integrity", /npm integrity/],
  ["composer", "repacked-zip", /Composer artifact/],
];
for (const [stage, value, error] of mismatches) {
  test(`refuses mismatched published ${stage} without overwriting`, async () => {
    const writes = [];
    const service = {
      gate: async () => {},
      tag: async () => "a".repeat(40),
      asset: async () => (stage === "assets" ? value : Buffer.from("manifest")),
      npm: async () => (stage === "npm" ? value : "npm"),
      composer: async () => (stage === "composer" ? value : "zip"),
      upload: async () => writes.push("overwrite"),
      publish: async () => writes.push("overwrite"),
      dispatch: async () => writes.push("dispatch"),
    };
    await assert.rejects(
      resume(
        {
          manifest: { sourceCommit: "a".repeat(40) },
          assets: { manifest: Buffer.from("manifest") },
          npmIdentity: "npm",
          composerIdentity: "zip",
        },
        service,
      ),
      error,
    );
    assert.deepEqual(writes, []);
  });
}
test("missing proofs/enrollment/access refuse before creating any remote state", async () => {
  await assert.rejects(
    resume(
      {},
      {
        gate: async () => {
          throw Error("missing proof/enrollment/access");
        },
      },
    ),
    /missing proof/,
  );
});
