import { defineConfig } from "astro/config";
import node from "@astrojs/node";

// A minimal content Site for CONSENT-1/LEGAL-1 acceptance (seam 1): server
// rendered, with client-side navigation, consuming the packed package.
export default defineConfig({
  output: "server",
  adapter: node({ mode: "standalone" }),
  server: { host: "127.0.0.1" },
  security: { checkOrigin: false },
});
