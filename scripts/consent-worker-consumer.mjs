// The commerce packaging proof (#28) and the consent endpoints in workerd
// against local D1 (#22, #26): installs the packed (or retained release) npm
// artifact into a Worker that imports only the consent exports, typechecks it
// against the installed declarations, and runs it through the pinned Alchemy
// local D1/Worker lifecycle. No remote resources or credentials.
import { retained } from "./release/candidate.mjs";
import { recordArtifact } from "./proof-artifact.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, readFileSync, rmSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
mkdirSync(join(repo, ".proofs/consent"), { recursive: true });
const consumer = mkdtempSync(join(repo, ".proofs/consent-worker-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/token|secret|auth|npm_config|pnpm_|cloudflare_|alchemy_/i.test(key),
  ),
);
writeFileSync(join(consumer, "user.npmrc"), "registry=https://registry.npmjs.org/\n");
writeFileSync(join(consumer, "global.npmrc"), "");
env.NPM_CONFIG_USERCONFIG = join(consumer, "user.npmrc");
env.NPM_CONFIG_GLOBALCONFIG = join(consumer, "global.npmrc");
const run = (command, args, cwd = consumer) =>
  execFileSync(command, args, { cwd, env, stdio: "inherit", timeout: 600000 });
try {
  // The same pinned Alchemy/workerd toolchain as the P1 proof; only the Worker differs.
  for (const file of ["package.json", "pnpm-lock.yaml", "pnpm-workspace.yaml"])
    cpSync(join(repo, "scripts/fixtures/alchemy-p1", file), join(consumer, file));
  cpSync(join(repo, "scripts/fixtures/consent-worker"), consumer, { recursive: true });
  const selected = retained("npm");
  if (selected) cpSync(selected, join(consumer, "getquick-content-0.4.1.tgz"));
  else run("vp", ["pm", "pack", "--pack-destination", consumer], join(repo, "frontend"));
  recordArtifact(join(consumer, "getquick-content-0.4.1.tgz"), "consent-worker");
  const integrity =
    "sha512-" +
    createHash("sha512")
      .update(readFileSync(join(consumer, "getquick-content-0.4.1.tgz")))
      .digest("base64");
  const lockfile = join(consumer, "pnpm-lock.yaml");
  writeFileSync(lockfile, readFileSync(lockfile, "utf8").replace("TARBALL_INTEGRITY", integrity));
  run("vp", ["install", "--frozen-lockfile", "--ignore-scripts"]);
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "ESNext",
        moduleResolution: "Bundler",
        strict: true,
        noEmit: true,
        lib: ["ES2022", "DOM"],
        types: [],
      },
      include: ["worker.ts"],
    }),
  );
  run(join(repo, "node_modules/.bin/tsc"), ["--project", join(consumer, "tsconfig.json")]);
  env.CONSENT_EVIDENCE = join(repo, ".proofs/consent/worker.json");
  run(process.execPath, ["proof.mjs"]);
  console.log(
    "#28: the installed consent exports typecheck and run in a Worker without the content runtime.",
  );
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
