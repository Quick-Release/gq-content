import { defineConfig } from "astro/config";
import cloudflare from "@astrojs/cloudflare";

// A minimal content Site on Cloudflare Workers for headless Gravity Forms
// acceptance (ADR 0009): server rendered, importing only the forms exports of
// the packed package. Astro's own cross-site form check stays on, as on Sites.
export default defineConfig({
  output: "server",
  adapter: cloudflare(),
  server: { host: "127.0.0.1" },
});
