import { publicBundleComments } from "./scripts/release/public-bundle";
import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: {
    entry: {
      index: "frontend/src/index.ts",
      "design-client": "frontend/src/design-client.ts",
      server: "frontend/src/server.ts",
      migrations: "frontend/src/migrations.ts",
      consent: "frontend/src/consent/index.ts",
      "consent-client": "frontend/src/consent/client.ts",
      "consent-server": "frontend/src/consent/server.ts",
      "consent-migrations": "frontend/src/consent/migrations.ts",
      "consent-astro": "frontend/src/consent/astro.ts",
      "consent-testing": "frontend/src/consent/testing.ts",
      metadata: "frontend/src/metadata.ts",
      "metadata-testing": "frontend/src/metadata-testing.ts",
      "metadata-content": "frontend/src/metadata-content.ts",
      forms: "frontend/src/forms/index.ts",
      "forms-astro": "frontend/src/forms/astro.ts",
      "forms-server": "frontend/src/forms/server.ts",
      "forms-testing": "frontend/src/forms/testing.ts",
    },
    platform: "neutral",
    deps: { neverBundle: ["node:url"], alwaysBundle: [/^@quick-release\//, "parse5"] },
    // Keep legal notices while omitting generated private source-path markers.
    plugins: [
      {
        name: "public-bundle-comments",
        renderChunk: (code) => ({ code: publicBundleComments(code), map: null }),
      },
    ],
    target: "es2022",
    format: ["esm"],
    outDir: "frontend/dist",
    dts: true,
    clean: true,
  },
  staged: { "*": "vp fmt" },
  fmt: {
    ignorePatterns: [
      ".agents/",
      // Immutable upstream saved/public fixture bytes, retained with provenance.
      "frontend/tests/fixtures/presentation/",
      "frontend/tests/fixtures/query-composition/",
      "frontend/tests/fixtures/image-source/public.json",
      "frontend/tests/fixtures/navigation/neutral.json",
      "frontend/tests/fixtures/navigation/producer/",
      "frontend/tests/fixtures/navigation/language/",
      "frontend/tests/fixtures/navigation/language-flags/",
      "frontend/tests/fixtures/navigation/language-a11y/",
      "frontend/tests/fixtures/typography/",
      "frontend/dist/",
      "node_modules/",
      ".vite-hooks/_/",
      "pnpm-lock.yaml",
      "docs/specs/issue-1-content-runtime-extraction.md",
      // Retained release bytes and live registry responses, kept exactly as received.
      "docs/evidence/issue-13/release-candidate/",
      "docs/evidence/issue-13/live/composer-p2-gq-content.json",
    ],
  },
  run: {
    tasks: {
      "cms-package": { command: "python3 scripts/cms-package.py", cache: false },
      cms: { command: "python3 scripts/cms-proof.py", cache: false },
      pair: {
        command: "python3 scripts/pair-proof.py",
        dependsOn: ["cms", "compile"],
        cache: false,
      },
      retry: {
        command: "python3 scripts/pair-proof.py --retries",
        dependsOn: ["pair"],
        cache: false,
      },
      multilingual: {
        command: "python3 scripts/multilingual-proof.py",
        dependsOn: ["retry"],
        cache: false,
      },
      compile: { command: "vp pack", cache: false },
      unit: { command: "vp test", dependsOn: ["compile"], cache: false },
      quality: { command: "vp check", dependsOn: ["compile"], cache: false },
      installed: { command: "node scripts/consumer.mjs", dependsOn: ["compile"], cache: false },
      "design-fixtures": {
        command: "node scripts/consumer.mjs --design-fixtures",
        dependsOn: ["compile", "cms-package"],
        cache: false,
      },
      alchemy: {
        command: "node scripts/alchemy-consumer.mjs",
        dependsOn: ["compile"],
        cache: false,
      },
      consent: {
        command: "node scripts/consent-acceptance.mjs",
        dependsOn: ["compile"],
        cache: false,
      },
      "consent-worker": {
        command: "node scripts/consent-worker-consumer.mjs",
        dependsOn: ["compile"],
        cache: false,
      },
      "consent-tanstack": {
        command: "node scripts/consent-tanstack-consumer.mjs",
        dependsOn: ["compile"],
        cache: false,
      },
      forms: {
        command: "node scripts/forms-acceptance.mjs",
        dependsOn: ["compile"],
        cache: false,
      },
      reconciliation: {
        command: "node scripts/alchemy-consumer.mjs --reconciliation",
        dependsOn: ["multilingual"],
        cache: false,
      },
      verification: {
        command: "vp exec tsc --noEmit",
        dependsOn: [
          "unit",
          "quality",
          "installed",
          "alchemy",
          "reconciliation",
          "consent",
          "consent-worker",
          "consent-tanstack",
          "forms",
        ],
        cache: false,
      },
    },
  },
  test: { include: ["frontend/tests/**/*.test.ts", "scripts/release/*.test.mjs"] },
  lint: {
    ignorePatterns: [
      "scripts/fixtures/alchemy-p1/worker.ts",
      "scripts/fixtures/alchemy-p1/reconciliation-worker.ts",
      // Typechecked against the installed package inside their own consumers.
      "scripts/fixtures/consent-astro/",
      "scripts/fixtures/consent-tanstack/",
      "scripts/fixtures/consent-worker/",
      "scripts/fixtures/forms-astro/",
    ],
    options: { typeAware: true, typeCheck: true },
  },
});
