/// <reference types="node" />
// The consent database as a test D1: the package's own consent migrations on
// Node's SQLite, separate from the publication store's.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";
import { consentMigrationsDirectory } from "@getquick/content/consent/migrations";
import type { ConsentDatabase, ConsentStatement } from "@getquick/content/consent/server";

export interface TestConsentD1 extends ConsentDatabase {
  unavailable: boolean;
  sqlite: DatabaseSync;
  close(): void;
}

export function openConsentD1(): TestConsentD1 {
  const sqlite = new DatabaseSync(":memory:");
  for (const file of readdirSync(consentMigrationsDirectory).sort()) {
    if (file.endsWith(".sql"))
      sqlite.exec(readFileSync(join(consentMigrationsDirectory, file), "utf8"));
  }
  const d1: TestConsentD1 = {
    unavailable: false,
    sqlite,
    close: () => sqlite.close(),
    prepare(query) {
      let values: unknown[] = [];
      const guard = () => {
        if (d1.unavailable) throw new Error("D1 is unavailable");
      };
      const statement: ConsentStatement = {
        bind(...bound) {
          values = bound;
          return statement;
        },
        async first<T>() {
          guard();
          return (sqlite.prepare(query).get(...(values as never[])) as T) ?? null;
        },
        async all<T>() {
          guard();
          return { results: sqlite.prepare(query).all(...(values as never[])) as T[] };
        },
        async run() {
          guard();
          const result = sqlite.prepare(query).run(...(values as never[]));
          return { meta: { changes: Number(result.changes) } };
        },
      };
      return statement;
    },
  };
  return d1;
}
