import { retained } from "./release/candidate.mjs";
import { recordArtifact } from "./proof-artifact.mjs";
import { execFileSync } from "node:child_process";
import {
  mkdtempSync,
  mkdirSync,
  writeFileSync,
  readFileSync,
  readdirSync,
  cpSync,
  rmSync,
} from "node:fs";
import { join, resolve } from "node:path";
import assert from "node:assert/strict";

const repo = resolve(import.meta.dirname, "..");
mkdirSync(join(repo, ".proofs"), { recursive: true });
const temporary = mkdtempSync(join(repo, ".proofs/consumer-"));
const env = Object.fromEntries(
  Object.entries(process.env).filter(([key]) => !/token|secret|auth|npm_config|pnpm_/i.test(key)),
);
const userConfig = join(temporary, "user.npmrc");
const globalConfig = join(temporary, "global.npmrc");
writeFileSync(userConfig, "registry=https://registry.npmjs.org/\n");
writeFileSync(globalConfig, "");
env.NPM_CONFIG_USERCONFIG = userConfig;
env.NPM_CONFIG_GLOBALCONFIG = globalConfig;
function run(command, args, cwd) {
  execFileSync(command, args, { cwd, env, stdio: "inherit" });
}
try {
  const artifacts = join(temporary, "artifacts");
  mkdirSync(artifacts);
  const selected = retained("npm");
  if (!selected) run("vp", ["pm", "pack", "--pack-destination", artifacts], join(repo, "frontend"));
  const tarball = selected ?? join(artifacts, "getquick-content-0.1.0.tgz");
  recordArtifact(tarball, "consumer");
  const listing = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
  for (const file of listing) {
    assert.match(
      file,
      /^package\/((?:package\.json|README\.md)|dist\/[\w-]+\.(js|d\.ts)|migrations\/000[1-5]_[a-z_]+\.sql)$/,
    );
  }
  if (process.argv.includes("--design-fixtures")) {
    run(
      process.execPath,
      [
        "scripts/inspect-artifacts.mjs",
        tarball,
        retained("cms") ?? join(repo, ".artifacts/gq-content-0.1.0.zip"),
      ],
      repo,
    );
  }
  const consumer = join(temporary, "consumer");
  mkdirSync(consumer);
  writeFileSync(
    join(consumer, "package.json"),
    JSON.stringify({
      private: true,
      type: "module",
      packageManager: "pnpm@12.11.2",
      dependencies: { "@getquick/content": `file:${tarball}` },
      devDependencies: { "vite-plus": "1.1.0", typescript: "6.0.3" },
    }),
  );
  writeFileSync(join(consumer, ".npmrc"), "registry=https://registry.npmjs.org/\n");
  run("vp", ["install", "--ignore-scripts"], consumer);
  const installed = join(consumer, "node_modules/@getquick/content");
  const manifest = JSON.parse(readFileSync(join(installed, "package.json"), "utf8"));
  assert.deepEqual(manifest.dependencies, { zod: "3.25.76" });
  assert.deepEqual(Object.keys(manifest.exports), [
    ".",
    "./server",
    "./migrations",
    "./metadata",
    "./metadata/testing",
    "./metadata/content",
  ]);
  for (const file of readdirSync(join(installed, "dist"))) {
    const text = readFileSync(join(installed, "dist", file), "utf8");
    if (!file.startsWith("migrations."))
      assert.doesNotMatch(
        text,
        /astro|cloudflare:|gq\.ops|import\.meta\.env|\{\{project\}\}|@quick-release|["']node:|migrationsDirectory/,
      );
    if (file.endsWith(".d.ts")) assert.doesNotMatch(text, /from ["']zod|z\.infer|ZodType/);
  }
  // The neutral entrypoint is a standalone artifact: no parser, framework, CMS or Node imports.
  assert.doesNotMatch(
    readFileSync(join(installed, "dist/metadata.js"), "utf8"),
    /\b(?:import|require)\s*(?:\(|[\s{*])/,
  );
  cpSync(join(repo, "frontend/tests"), join(consumer, "tests"), { recursive: true });
  writeFileSync(
    join(consumer, "vite.config.ts"),
    'import { defineConfig } from "vite-plus"; export default defineConfig({ test: { include: ["tests/**/*.test.ts"] } });\n',
  );
  cpSync(join(repo, "frontend/tests/consumer-types.ts"), join(consumer, "consumer.ts"));
  cpSync(
    join(repo, "frontend/tests/metadata-consumer-types.ts"),
    join(consumer, "metadata-consumer.ts"),
  );
  writeFileSync(
    join(consumer, "tsconfig.json"),
    JSON.stringify({
      compilerOptions: {
        target: "ES2022",
        module: "NodeNext",
        moduleResolution: "NodeNext",
        strict: true,
        noEmit: true,
        lib: ["ES2022", "DOM"],
        types: [],
      },
      include: ["consumer.ts", "metadata-consumer.ts"],
    }),
  );
  run("vp", ["exec", "tsc", "--noEmit"], consumer);
  run(process.execPath, ["tests/consumer-runtime.mjs"], consumer);
  run("vp", ["test"], consumer);
  if (process.argv.includes("--design-fixtures")) {
    writeFileSync(join(consumer, "design-content.mjs"), 'export * from "@getquick/content";\n');
    env.DESIGN_CONSUMER_MODULE = join(consumer, "design-content.mjs");
    run("vp", ["test", "--config", "compatibility/vite.config.ts"], repo);
  }
  console.log(
    `P3/P4 issues #3/#4: inspected ${listing.length} packed files; public declarations and all package-boundary suites passed in a clean installed consumer.`,
  );
} finally {
  rmSync(temporary, { recursive: true, force: true });
}
