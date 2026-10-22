// The Worker's D1 bindings, as Node's SQLite: the publication store with the
// package's migrations, and the separate consent database with its own.
import { readdirSync, readFileSync } from "node:fs";
import { join } from "node:path";
import { DatabaseSync } from "node:sqlite";

export function d1(path: string, migrations: string, marker: string) {
  const sqlite = new DatabaseSync(path);
  const applied = sqlite
    .prepare("SELECT name FROM sqlite_master WHERE type = 'table' AND name = ?")
    .get(marker);
  if (!applied) {
    for (const file of readdirSync(migrations)
      .filter((name) => name.endsWith(".sql"))
      .sort()) {
      sqlite.exec(readFileSync(join(migrations, file), "utf8"));
    }
  }
  const prepare = (query: string) => {
    let values: unknown[] = [];
    const statement = {
      bind(...bound: unknown[]) {
        values = bound;
        return statement;
      },
      async first<T>() {
        return (sqlite.prepare(query).get(...(values as never[])) as T) ?? null;
      },
      async all<T>() {
        return { results: sqlite.prepare(query).all(...(values as never[])) as T[] };
      },
      async run() {
        const result = sqlite.prepare(query).run(...(values as never[]));
        return { meta: { changes: Number(result.changes) } };
      },
    };
    return statement;
  };
  return {
    sqlite,
    prepare,
    async batch(statements: Array<{ run(): Promise<unknown> }>) {
      sqlite.exec("BEGIN");
      try {
        const results = [];
        for (const statement of statements) results.push(await statement.run());
        sqlite.exec("COMMIT");
        return results as never;
      } catch (error) {
        sqlite.exec("ROLLBACK");
        throw error;
      }
    },
  };
}
