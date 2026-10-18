import assert from "node:assert/strict";
import { mkdtempSync, readFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { hash, run, load } from "./candidate.mjs";
import { verifyRecord } from "./validate.mjs";

const repository = "Quick-Release/gq-content";
const registry = "Quick-Release/getquick-registry";
const api = "https://api.github.com";
// Tokens are scoped to a single service/origin; errors never include bodies/headers.
async function request(url, token, options = {}, absent = false) {
  const response = await fetch(url, {
    ...options,
    cache: "no-store",
    redirect: "error",
    headers: {
      "Cache-Control": "no-cache",
      ...options.headers,
      ...(token ? { Authorization: `Bearer ${token}` } : {}),
    },
  });
  if (absent && response.status === 404) return null;
  if (!response.ok) throw Error(`release service HTTP ${response.status} (${new URL(url).origin})`);
  return response;
}
export function services(candidate, ciRun) {
  const { manifest: m, directory } = candidate;
  const ghToken = process.env.GH_TOKEN || process.env.GITHUB_TOKEN;
  const registryToken = process.env.GQ_REGISTRY_TOKEN;
  const composerUser = process.env.GQ_COMPOSER_USERNAME;
  const composerPassword = process.env.GQ_COMPOSER_PASSWORD;
  const composerHeaders = {
    Authorization: "Basic " + Buffer.from(`${composerUser}:${composerPassword}`).toString("base64"),
  };
  const composerRequest = (path, absent = false) =>
    request(
      "https://proxy.composer.getquick.io" + path,
      null,
      { headers: composerHeaders },
      absent,
    );
  const github = async (path, options = {}, absent = false, token = ghToken) => {
    const response = await request(
      `${api}/repos/${path}`,
      token,
      {
        ...options,
        headers: {
          Accept: "application/vnd.github+json",
          "X-GitHub-Api-Version": "2022-11-28",
          ...options.headers,
        },
      },
      absent,
    );
    return response ? (response.status === 204 ? {} : response.json()) : null;
  };
  const release = () => github(`${repository}/releases/tags/${m.tag}`, {}, true);
  async function tag() {
    let ref = (await github(`${repository}/git/ref/tags/${m.tag}`, {}, true))?.object;
    for (let i = 0; ref?.type === "tag" && i < 5; i++)
      ref = (await github(`${repository}/git/tags/${ref.sha}`)).object;
    if (!ref) return null;
    assert.equal(ref.type, "commit", "tag must resolve to commit");
    return ref.sha;
  }
  return {
    async gate() {
      assert(
        ghToken && registryToken && composerUser && composerPassword,
        "missing GitHub/registry dispatch/Composer credentials",
      );
      assert.match(String(ciRun), /^\d+$/, "successful candidate CI run is required");
      verifyRecord(candidate);
      const ci = await github(`${repository}/actions/runs/${ciRun}`);
      assert.equal(ci.head_sha, m.sourceCommit, "CI revision mismatch");
      assert.equal(
        ci.path,
        ".github/workflows/paired-release-validation.yml",
        "wrong CI proof workflow",
      );
      assert.equal(ci.event, "workflow_dispatch");
      assert.equal(ci.status, "completed");
      assert.equal(ci.conclusion, "success", "all P1–P7 CI checks required");
      // Compare the actual Actions-retained proof bundle, not a caller's boolean/JSON.
      const temp = mkdtempSync(join(tmpdir(), "gq-release-ci-"));
      try {
        run("gh", [
          "run",
          "download",
          String(ciRun),
          "--repo",
          repository,
          "--name",
          "paired-release-candidate",
          "--dir",
          temp,
        ]);
        const trusted = load(temp, false);
        assert.deepEqual(trusted.assets, candidate.assets, "CI candidate artifact mismatch");
        verifyRecord(trusted);
        assert.deepEqual(
          readFileSync(join(temp, "validation.json")),
          readFileSync(join(directory, "validation.json")),
          "CI validation record mismatch",
        );
      } finally {
        rmSync(temp, { recursive: true, force: true });
      }
      const config = await github(
        `${registry}/contents/release-packages.json`,
        {},
        false,
        registryToken,
      );
      const entries = JSON.parse(Buffer.from(config.content, "base64").toString());
      assert(
        entries.some(
          (e) =>
            e.name === "getquick/gq-content" &&
            e.repository === repository &&
            e.assetPrefix === "gq-content-",
        ),
        "registry enrollment missing; owner handoff required",
      );
      const registryRepo = await github(registry, {}, false, registryToken);
      assert(registryRepo.permissions?.push, "registry dispatch access missing");
      // Authenticate the publishing account without logging its identity or token.
      try {
        run("vp", ["pm", "whoami", "--", "--registry=https://registry.npmjs.org"], {
          stdio: "pipe",
        });
      } catch {
        throw Error("npm publishing credential missing/invalid; no publication attempted");
      }
      // Authenticate the private Composer service before any publication.
      await composerRequest("/packages.json");
    },
    tag,
    async createTag() {
      await github(`${repository}/git/refs`, {
        method: "POST",
        body: JSON.stringify({ ref: `refs/tags/${m.tag}`, sha: m.sourceCommit }),
      });
    },
    async asset(name) {
      const r = await release();
      if (!r) return null;
      assert.equal(r.tag_name, m.tag);
      assert.equal(r.draft, false, "existing release must be visible to registry");
      assert.equal(r.prerelease, false, "existing prerelease mismatch");
      assert.equal(await tag(), m.sourceCommit, "tag mismatch");
      const found = r.assets.filter((a) => a.name === name);
      assert(found.length <= 1, "duplicate release assets");
      if (!found.length) return null;
      // GitHub asset API redirects to signed object storage. Drop auth on redirect.
      assert.equal(new URL(found[0].url).origin, api, "untrusted GitHub asset API origin");
      const response = await fetch(found[0].url, {
        redirect: "manual",
        cache: "no-store",
        headers: { Accept: "application/octet-stream", Authorization: `Bearer ${ghToken}` },
      });
      const bytes =
        response.status === 302 ? await request(response.headers.get("location"), null) : response;
      assert(bytes.ok, "GitHub asset download failed");
      return Buffer.from(await bytes.arrayBuffer());
    },
    async upload(name, bytes) {
      let r = await release();
      if (!r)
        r = await github(`${repository}/releases`, {
          method: "POST",
          body: JSON.stringify({
            tag_name: m.tag,
            target_commitish: m.sourceCommit,
            name: m.tag,
            draft: false,
            prerelease: false,
            body: "Paired release staging. Availability is pending live npm and Composer verification.",
          }),
        });
      const url = r.upload_url.replace(/\{.*$/, "") + "?name=" + encodeURIComponent(name);
      assert.equal(new URL(url).origin, "https://uploads.github.com");
      await request(url, ghToken, {
        method: "POST",
        headers: { "Content-Type": "application/octet-stream" },
        body: bytes,
      });
    },
    async npm() {
      const response = await request(
        `https://registry.npmjs.org/@getquick%2fcontent/${m.version}`,
        null,
        {},
        true,
      );
      if (!response) return null;
      const meta = await response.json();
      assert.equal(meta.name, "@getquick/content");
      assert.equal(meta.version, m.version);
      assert.equal(new URL(meta.dist.tarball).origin, "https://registry.npmjs.org");
      const bytes = Buffer.from(await (await request(meta.dist.tarball, null)).arrayBuffer());
      assert.equal(
        meta.dist.integrity,
        "sha512-" + hash(bytes, "sha512", "base64"),
        "published npm integrity mismatch",
      );
      return meta.dist.integrity + ":" + hash(bytes);
    },
    async publish() {
      // vp/pnpm takes the exact retained tgz. No lifecycle script can repack it.
      try {
        run(
          "vp",
          [
            "pm",
            "publish",
            join(directory, m.npm.filename),
            "--access",
            "public",
            "--",
            "--ignore-scripts",
            "--registry",
            "https://registry.npmjs.org",
          ],
          { stdio: "pipe" },
        );
      } catch {
        throw Error(
          "npm publication failed; credentials/output suppressed; inspect live identity before retry",
        );
      }
    },
    async composer() {
      const response = await composerRequest("/p2/getquick/gq-content.json", true);
      if (!response) return null;
      const versions = (await response.json()).packages?.["getquick/gq-content"];
      assert(Array.isArray(versions), "invalid Composer metadata");
      const meta = versions.find((p) => p.version.replace(/^v/, "") === m.version);
      if (!meta) return null;
      assert.equal(meta.name, "getquick/gq-content");
      assert.equal(meta.type, "wordpress-muplugin");
      assert.equal(meta.source.reference, m.tag, "Composer source tag mismatch");
      assert.equal(meta.source.url, `https://github.com/${repository}.git`);
      const url = new URL(meta.dist.url);
      assert(!url.username && !url.password, "Composer dist URL credentials forbidden");
      assert(
        ["https://composer.getquick.io", "https://proxy.composer.getquick.io"].includes(url.origin),
        "untrusted Composer archive origin",
      );
      assert.equal(meta.dist.type, "zip");
      const bytes = Buffer.from(
        await (await composerRequest(url.pathname + url.search)).arrayBuffer(),
      );
      if (meta.dist.shasum)
        assert.equal(hash(bytes, "sha1"), meta.dist.shasum, "Composer metadata shasum mismatch");
      return hash(bytes);
    },
    async dispatch() {
      await github(
        `${registry}/dispatches`,
        {
          method: "POST",
          body: JSON.stringify({
            event_type: "plugin_updated",
            client_payload: { repository, tag: m.tag, sourceCommit: m.sourceCommit },
          }),
        },
        false,
        registryToken,
      );
    },
  };
}
