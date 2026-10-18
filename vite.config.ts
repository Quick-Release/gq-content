import { defineConfig } from "vite-plus";
export default defineConfig({
  pack: {
    entry: { index: "frontend/src/index.ts", server: "frontend/src/server.ts" },
    platform: "neutral",
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
      "frontend/dist/",
      "node_modules/",
      ".vite-hooks/_/",
      "pnpm-lock.yaml",
      "docs/specs/issue-1-content-runtime-extraction.md",
    ],
  },
  run: {
    tasks: {
      compile: { command: "vp pack", cache: false },
      unit: { command: "vp test", dependsOn: ["compile"], cache: false },
      quality: { command: "vp check", dependsOn: ["compile"], cache: false },
      installed: { command: "node scripts/consumer.mjs", dependsOn: ["compile"], cache: false },
      verification: {
        command: "vp exec tsc --noEmit",
        dependsOn: ["unit", "quality", "installed"],
        cache: false,
      },
    },
  },
  test: { include: ["frontend/tests/**/*.test.ts"] },
  lint: { options: { typeAware: true, typeCheck: true } },
});
