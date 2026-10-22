import { fileURLToPath } from "node:url";

/**
 * The consent database's migrations, for infrastructure (Alchemy/Wrangler):
 * a directory separate from the publication store's. Node-only; keep this
 * entry out of browser and Worker imports.
 */
export const consentMigrationsDirectory = fileURLToPath(
  new URL("../consent-migrations/", import.meta.url),
);
