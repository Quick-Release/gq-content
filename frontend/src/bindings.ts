export interface SqlStatement {
  bind(...values: unknown[]): SqlStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}

export interface SqlDatabase {
  prepare(query: string): SqlStatement;
  /** Runs the statements in order as one transaction: all of them apply, or none. */
  batch<T = Record<string, unknown>>(statements: SqlStatement[]): Promise<Array<{ results: T[] }>>;
}

export interface ContentBindings {
  /** The publication store (D1). */
  PUBLICATION_DB?: SqlDatabase;
  /** The trusted refresh's bearer token (a Worker secret). */
  FRONTEND_REFRESH_TOKEN?: string;
  /** The key the CMS signs its publication events with (a Worker secret). */
  PUBLICATION_EVENT_SECRET?: string;
  /** Read-only CMS edge identity; never the automation service or public env. */
  GQ_AUTH_GRAPHQL_CLIENT_ID?: string;
  GQ_AUTH_GRAPHQL_CLIENT_SECRET?: string;
}
