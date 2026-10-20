import { retained } from "./release/candidate.mjs";
import { recordArtifact } from "./proof-artifact.mjs";
import { npmFilename, version } from "./version.mjs";
import { createHash } from "node:crypto";
import { execFileSync } from "node:child_process";
import { cpSync, mkdirSync, mkdtempSync, rmSync, readFileSync, writeFileSync } from "node:fs";
import { join, resolve } from "node:path";

const repo = resolve(import.meta.dirname, "..");
mkdirSync(join(repo, ".proofs"), { recursive: true });
const consumer = mkdtempSync(join(repo, ".proofs/alchemy-p1-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(
    ([key]) => !/token|secret|auth|npm_config|pnpm_|cloudflare_|alchemy_/i.test(key),
  ),
);
writeFileSync(join(consumer, "user.npmrc"), "registry=https://registry.npmjs.org/\n");
writeFileSync(join(consumer, "global.npmrc"), "");
env.NPM_CONFIG_USERCONFIG = join(consumer, "user.npmrc");
env.NPM_CONFIG_GLOBALCONFIG = join(consumer, "global.npmrc");
function run(command, args, cwd = consumer) {
  execFileSync(command, args, { cwd, env, stdio: "inherit", timeout: 600000 });
}
try {
  cpSync(join(repo, "scripts/fixtures/alchemy-p1"), consumer, { recursive: true });
  const selected = retained("npm");
  // The fixture installs it as getquick-content.tgz, whatever the version.
  if (selected) cpSync(selected, join(consumer, "getquick-content.tgz"));
  else {
    run("vp", ["pm", "pack", "--pack-destination", consumer], join(repo, "frontend"));
    cpSync(join(consumer, npmFilename), join(consumer, "getquick-content.tgz"));
    rmSync(join(consumer, npmFilename));
  }
  recordArtifact(
    join(consumer, "getquick-content.tgz"),
    process.argv.includes("--reconciliation") ? "reconciliation" : "alchemy",
  );
  const integrity =
    "sha512-" +
    createHash("sha512")
      .update(readFileSync(join(consumer, "getquick-content.tgz")))
      .digest("base64");
  const lockfile = join(consumer, "pnpm-lock.yaml");
  writeFileSync(
    lockfile,
    readFileSync(lockfile, "utf8")
      .replace("TARBALL_INTEGRITY", integrity)
      .replace("TARBALL_VERSION", version),
  );
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
      include: ["worker.ts", "reconciliation-worker.ts"],
    }),
  );
  run(join(repo, "node_modules/.bin/tsc"), ["--project", join(consumer, "tsconfig.json")]);
  if (process.argv.includes("--reconciliation")) {
    mkdirSync(join(repo, ".proofs/reconciliation"), { recursive: true });
    env.RECONCILIATION_REPO = repo;
    run(process.execPath, ["reconciliation.mjs"]);
  } else run(process.execPath, ["proof.mjs"]);
} finally {
  rmSync(consumer, { recursive: true, force: true });
}
