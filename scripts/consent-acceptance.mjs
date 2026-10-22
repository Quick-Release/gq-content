// CONSENT-1/LEGAL-1 provider acceptance (#21–#25, #27): installs the packed
// (or retained release) npm artifact into the minimal Astro fixture without
// private registry configuration, builds and serves it, and runs the shared
// acceptance suite and scenarios in a real Chromium. Evidence:
// .proofs/consent/acceptance.json.
import { retained } from "./release/candidate.mjs";
import { recordArtifact } from "./proof-artifact.mjs";
import { execFileSync, spawn } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { createServer } from "node:net";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
mkdirSync(join(repo, ".proofs/consent"), { recursive: true });
const consumer = mkdtempSync(join(repo, ".proofs/consent-astro-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/token|secret|auth|npm_config|pnpm_|cloudflare_|alchemy_/i.test(key),
  ),
);
writeFileSync(join(consumer, "user.npmrc"), "registry=https://registry.npmjs.org/\n");
writeFileSync(join(consumer, "global.npmrc"), "");
env.NPM_CONFIG_USERCONFIG = join(consumer, "user.npmrc");
env.NPM_CONFIG_GLOBALCONFIG = join(consumer, "global.npmrc");
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: consumer,
    env,
    stdio: "inherit",
    timeout: 600000,
    ...options,
  });

const port = await new Promise((done) => {
  const probe = createServer().listen(0, "127.0.0.1", () => {
    const { port } = probe.address();
    probe.close(() => done(port));
  });
});
let server;
try {
  cpSync(join(repo, "scripts/fixtures/consent-astro"), consumer, { recursive: true });
  const selected = retained("npm");
  if (selected) cpSync(selected, join(consumer, "getquick-content-0.1.0.tgz"));
  else run("vp", ["pm", "pack", "--pack-destination", consumer], { cwd: join(repo, "frontend") });
  recordArtifact(join(consumer, "getquick-content-0.1.0.tgz"), "consent");
  const tarball = join(consumer, "getquick-content-0.1.0.tgz");
  const integrity = "sha512-" + createHash("sha512").update(readFileSync(tarball)).digest("base64");
  const lockfile = join(consumer, "pnpm-lock.yaml");
  writeFileSync(lockfile, readFileSync(lockfile, "utf8").replace("TARBALL_INTEGRITY", integrity));
  run("vp", ["install", "--frozen-lockfile", "--ignore-scripts"]);
  // The browser Playwright pins; a no-op when already installed.
  run("vp", ["exec", "playwright", "install", "chromium"]);
  run("vp", ["exec", "astro", "build"]);
  const data = join(consumer, "data");
  mkdirSync(data);
  server = spawn(process.execPath, ["dist/server/entry.mjs"], {
    cwd: consumer,
    env: { ...env, HOST: "127.0.0.1", PORT: String(port), CONSENT_FIXTURE_DATA: data },
    stdio: ["ignore", "inherit", "inherit"],
  });
  const origin = `http://127.0.0.1:${port}`;
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${origin}/`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (attempt > 100) throw new Error("The Astro fixture didn't start");
    await new Promise((done) => setTimeout(done, 100));
  }
  run(process.execPath, ["acceptance.mjs"], {
    env: {
      ...env,
      CONSENT_ORIGIN: origin,
      CONSENT_FIXTURE_DATA: data,
      CONSENT_EVIDENCE: join(repo, ".proofs/consent/acceptance.json"),
    },
  });
  console.log("CONSENT-1/LEGAL-1 Astro acceptance passed against the installed package.");
} finally {
  server?.kill();
  rmSync(consumer, { recursive: true, force: true });
}
