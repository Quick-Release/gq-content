import { test } from "vite-plus/test";
import assert from "node:assert/strict";
import { load } from "./candidate.mjs";
import { services } from "./services.mjs";

test.skipIf(!process.env.GQ_RELEASE_BUNDLE)(
  "live service verification rejects npm integrity and Composer archive substitution",
  async () => {
    const candidate = load(process.env.GQ_RELEASE_BUNDLE);
    const original = globalThis.fetch;
    let mismatch = false;
    const zip = candidate.assets[candidate.manifest.cms.filename];
    const tar = candidate.assets[candidate.manifest.npm.filename];
    globalThis.fetch = async (url) => {
      const path = new URL(url).pathname;
      if (path.endsWith("content/0.3.0"))
        return Response.json({
          name: "@getquick/content",
          version: "0.3.0",
          dist: {
            integrity: mismatch ? "sha512-wrong" : candidate.manifest.npm.integrity,
            tarball: "https://registry.npmjs.org/content.tgz",
          },
        });
      if (path === "/content.tgz") return new Response(tar);
      if (path.endsWith(".json"))
        return Response.json({
          packages: {
            "getquick/gq-content": [
              {
                name: "getquick/gq-content",
                version: "0.3.0",
                type: "wordpress-muplugin",
                source: {
                  reference: "v0.3.0",
                  url: "https://github.com/Quick-Release/gq-content.git",
                },
                dist: { type: "zip", url: "https://composer.getquick.io/dist/content.zip" },
              },
            ],
          },
        });
      if (path === "/dist/content.zip")
        return new Response(mismatch ? Buffer.from("substituted ZIP") : zip);
      throw Error("unexpected external service request");
    };
    try {
      const service = services(candidate, "123");
      assert.equal(await service.npm(), candidate.npmIdentity);
      assert.equal(await service.composer(), candidate.composerIdentity);
      mismatch = true;
      await assert.rejects(service.npm(), /published npm integrity mismatch/);
      assert.notEqual(await service.composer(), candidate.composerIdentity);
    } finally {
      globalThis.fetch = original;
    }
  },
);
