// Headless Gravity Forms acceptance (ADR 0009): installs the packed (or
// retained release) npm artifact into a minimal Astro Site built for
// Cloudflare Workers without private registry configuration, typechecks the
// forms exports against its declarations, builds and serves it in workerd and
// runs the fixture's scenarios in Chromium, without JavaScript and with
// Turnstile's test keys. Evidence: .proofs/forms/acceptance.json.
import { retained } from "./release/candidate.mjs";
import { recordArtifact } from "./proof-artifact.mjs";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
mkdirSync(join(repo, ".proofs/forms"), { recursive: true });
const consumer = mkdtempSync(join(repo, ".proofs/forms-astro-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/token|secret|auth|npm_config|pnpm_|cloudflare_|alchemy_|wrangler_/i.test(key),
  ),
);
writeFileSync(join(consumer, "user.npmrc"), "registry=https://registry.npmjs.org/\n");
writeFileSync(join(consumer, "global.npmrc"), "");
env.NPM_CONFIG_USERCONFIG = join(consumer, "user.npmrc");
env.NPM_CONFIG_GLOBALCONFIG = join(consumer, "global.npmrc");
// Local workerd only: no Cloudflare account, telemetry or remote bindings.
env.WRANGLER_SEND_METRICS = "false";
env.ASTRO_TELEMETRY_DISABLED = "1";
const run = (command, args, options = {}) =>
  execFileSync(command, args, {
    cwd: consumer,
    env,
    stdio: "inherit",
    timeout: 600000,
    ...options,
  });

try {
  cpSync(join(repo, "scripts/fixtures/forms-astro"), consumer, { recursive: true });
  const tarball = join(consumer, "getquick-content-0.4.1.tgz");
  const selected = retained("npm");
  if (selected) cpSync(selected, tarball);
  else run("vp", ["pm", "pack", "--pack-destination", consumer], { cwd: join(repo, "frontend") });
  recordArtifact(tarball, "forms");
  const integrity = "sha512-" + createHash("sha512").update(readFileSync(tarball)).digest("base64");
  const lockfile = join(consumer, "pnpm-lock.yaml");
  writeFileSync(lockfile, readFileSync(lockfile, "utf8").replace("TARBALL_INTEGRITY", integrity));
  run("vp", ["install", "--frozen-lockfile", "--ignore-scripts"]);
  // The forms exports typecheck against the installed declarations alone.
  writeFileSync(
    join(consumer, "tsconfig.typecheck.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        skipLibCheck: false,
        lib: ["ES2022", "DOM"],
        types: [],
      },
      include: ["typecheck.ts"],
    }),
  );
  run(join(repo, "node_modules/.bin/tsc"), [
    "--project",
    join(consumer, "tsconfig.typecheck.json"),
  ]);
  // The browser Playwright pins; a no-op when already installed.
  run("vp", ["exec", "playwright", "install", "chromium"]);
  run(process.execPath, ["acceptance.mjs"], {
    env: { ...env, FORMS_EVIDENCE: join(repo, ".proofs/forms/acceptance.json") },
  });
  console.log("Headless Gravity Forms acceptance passed against the installed package.");
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
