import { defineConfig } from "vite-plus";
export default defineConfig({
  test: { include: ["compatibility/**/*.test.ts"] },
});
