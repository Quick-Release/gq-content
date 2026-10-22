import { tanstackStart } from "@tanstack/react-start/plugin/vite";
import react from "@vitejs/plugin-react";
import { defineConfig } from "vite";

// A minimal TanStack Start commerce consumer of the packed consent exports
// (#28): no Composer plugin, CMS bindings, content runtime or Design package.
export default defineConfig({
  server: { host: "127.0.0.1" },
  preview: { host: "127.0.0.1" },
  plugins: [tanstackStart(), react()],
});
