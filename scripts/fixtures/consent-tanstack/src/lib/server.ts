// The record endpoint on the storefront's server, its consent database a
// local SQLite D1 stand-in with the package's consent migrations.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { consentMigrationsDirectory } from "@getquick/content/consent/migrations";
import { createConsentServer, type ConsentDatabase } from "@getquick/content/consent/server";

const sqlite = new DatabaseSync(`${process.env.CONSENT_FIXTURE_DATA ?? "."}/consent.sqlite`);
if (!sqlite.prepare("SELECT 1 FROM sqlite_master WHERE name = 'consent_records'").get()) {
  for (const file of readdirSync(consentMigrationsDirectory).sort())
    sqlite.exec(readFileSync(join(consentMigrationsDirectory, file), "utf8"));
}
const db: ConsentDatabase = {
  prepare(query) {
    let values: unknown[] = [];
    const statement = {
      bind(...bound: unknown[]) {
        values = bound;
        return statement;
      },
      first: async <T>() => (sqlite.prepare(query).get(...(values as never[])) as T) ?? null,
      all: async <T>() => ({ results: sqlite.prepare(query).all(...(values as never[])) as T[] }),
      run: async () => ({
        meta: { changes: Number(sqlite.prepare(query).run(...(values as never[])).changes) },
      }),
    };
    return statement;
  },
};
export const consent = createConsentServer({
  siteId: "shop",
  bindings: () => ({
    CONSENT_DB: db,
    CONSENT_READ_TOKEN: "tanstack-consent-read-token-0123456789abcdef",
  }),
});
