import { fileURLToPath } from "node:url";
/** Infrastructure only: SQL shipped alongside the installed package. */
export const migrationsDirectory: string = fileURLToPath(
  new URL("../migrations/", import.meta.url),
);
