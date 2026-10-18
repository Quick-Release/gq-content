import type { SqlDatabase } from "./bindings";
export const PUBLICATION_FORMAT = 1;

export type StoredPublication<T> =
  | { state: "published"; content: T; promotedAt: number }
  | { state: "missing"; promotedAt: number }
  | { state: "moved"; uri: string; promotedAt: number }
  | { state: "withdrawn"; promotedAt: number };

/**
 * What a refresh promotes. `nodeId` is the WordPress post or page a row holds
 * (WPGraphQL's global id): published at another URI later, its old rows are
 * superseded. `modifiedAt` is when WordPress last modified it, as the read saw
 * it, which reconciliation compares with WordPress's list.
 */
export type Promotion<T> =
  | { state: "published"; content: T; nodeId?: string; modifiedAt?: number | null }
  | { state: "missing" }
  | { state: "moved"; uri: string; nodeId?: string };

/** Why a stored row can't be served: written in a format, or a shape, this Worker doesn't know. */
export interface Unusable {
  state: "unusable";
  message: string;
}

export interface RefreshAttempt {
  outcome: "promoted" | "superseded" | "kept";
  reason?: string;
  message?: string;
}

/** The store couldn't be read or written. Says nothing about the content. */
export class StoreFailure extends Error {}

interface PublicationRow {
  state: string;
  format: number;
  body: string | null;
  promoted_at: number;
}

export interface PublicationStore {
  /** The row at key, null if nothing was ever promoted there. */
  read<T>(
    key: string,
    parse: (body: unknown) => T | undefined,
  ): Promise<StoredPublication<T> | Unusable | null>;
  /**
   * Replaces the row at key unless a read that started later was already
   * promoted there ("superseded"), or the entry it holds is withdrawn
   * ("withdrawn"); nothing changes then.
   */
  promote<T>(
    key: string,
    publication: Promotion<T>,
    readStartedAt: number,
  ): Promise<"promoted" | "superseded" | "withdrawn">;
  /**
   * Marks every other row holding nodeId as moved to uri, unless its read
   * started at readBefore or later. Resolves to the keys it marked.
   */
  supersede(nodeId: string, uri: string, keep: string, readBefore: number): Promise<string[]>;
  /** The keys stored under prefix, whatever their state. */
  keys(prefix: string): Promise<string[]>;
  /**
   * The state of each of these keys' rows ("unusable" in a format this Worker
   * doesn't serve), in one read; a key nothing was ever promoted at is left out.
   */
  states(keys: string[]): Promise<Map<string, string>>;
  recordAttempt(key: string, attempt: RefreshAttempt): Promise<void>;
}
async function guard<T>(action: string, work: () => Promise<T>): Promise<T> {
  try {
    return await work();
  } catch (error) {
    throw new StoreFailure(`The publication store couldn't ${action}`, {
      cause: error,
    });
  }
}

export function publicationStore(db: SqlDatabase): PublicationStore {
  return {
    async read(key, parse) {
      const row = await guard("be read", () =>
        db
          .prepare("SELECT state, format, body, promoted_at FROM publications WHERE key = ?")
          .bind(key)
          .first<PublicationRow>(),
      );
      if (!row) return null;
      if (row.format !== PUBLICATION_FORMAT) {
        return {
          state: "unusable",
          message: `${key} is stored in format ${row.format}; this Frontend serves format ${PUBLICATION_FORMAT}`,
        };
      }
      if (row.state === "missing") return { state: "missing", promotedAt: row.promoted_at };
      if (row.state === "withdrawn") return { state: "withdrawn", promotedAt: row.promoted_at };
      if (row.state === "moved") {
        const uri = movedTo(row.body);
        if (uri) return { state: "moved", uri, promotedAt: row.promoted_at };
        return { state: "unusable", message: `${key} is stored as moved without a readable URI` };
      }

      let content: ReturnType<typeof parse>;
      try {
        content = row.state === "published" && row.body ? parse(JSON.parse(row.body)) : undefined;
      } catch {
        content = undefined;
      }
      if (content === undefined) {
        return {
          state: "unusable",
          message: `${key} is stored with a body this Frontend can't read`,
        };
      }
      return { state: "published", content, promotedAt: row.promoted_at };
    },

    async promote(key, publication, readStartedAt) {
      const body =
        publication.state === "published"
          ? JSON.stringify(publication.content)
          : publication.state === "moved"
            ? JSON.stringify({ uri: publication.uri })
            : null;
      const nodeId = publication.state === "missing" ? null : (publication.nodeId ?? null);
      const modifiedAt =
        publication.state === "published" ? (publication.modifiedAt ?? null) : null;
      // An entry under a withdrawal in force is never promoted, by any read.
      const result = await guard("be written", () =>
        db
          .prepare(
            `INSERT INTO publications
               (key, state, format, body, read_started_at, promoted_at, node_id, modified_at)
             SELECT ?1, ?2, ?3, ?4, ?5, ?6, ?7, ?8
             WHERE ?7 IS NULL OR NOT EXISTS (
               SELECT 1 FROM withdrawals WHERE node_id = ?7 AND republished_at IS NULL)
             ON CONFLICT (key) DO UPDATE SET
               state = excluded.state,
               format = excluded.format,
               body = excluded.body,
               read_started_at = excluded.read_started_at,
               promoted_at = excluded.promoted_at,
               node_id = excluded.node_id,
               modified_at = excluded.modified_at
             WHERE excluded.read_started_at > publications.read_started_at`,
          )
          .bind(
            key,
            publication.state,
            PUBLICATION_FORMAT,
            body,
            readStartedAt,
            Date.now(),
            nodeId,
            modifiedAt,
          )
          .run(),
      );
      if (result.meta.changes > 0) return "promoted";
      if (nodeId === null) return "superseded";
      const withdrawn = await guard("be read", () =>
        db
          .prepare(
            "SELECT 1 AS found FROM withdrawals WHERE node_id = ? AND republished_at IS NULL",
          )
          .bind(nodeId)
          .first(),
      );
      return withdrawn ? "withdrawn" : "superseded";
    },

    async supersede(nodeId, uri, keep, readBefore) {
      const body = JSON.stringify({ uri });
      const { results } = await guard("be written", () =>
        db
          .prepare(
            `UPDATE publications SET
               state = 'moved', format = ?1, body = ?2, read_started_at = ?3, promoted_at = ?4
             WHERE node_id = ?5 AND key <> ?6 AND read_started_at < ?3
               AND (state = 'published' OR (state = 'moved' AND body <> ?2))
             RETURNING key`,
          )
          .bind(PUBLICATION_FORMAT, body, readBefore, Date.now(), nodeId, keep)
          .all<{ key: string }>(),
      );
      return results.map((row) => row.key).sort();
    },

    async keys(prefix) {
      const { results } = await guard("be read", () =>
        db
          .prepare("SELECT key FROM publications WHERE substr(key, 1, length(?1)) = ?1")
          .bind(prefix)
          .all<{ key: string }>(),
      );
      return results.map((row) => row.key).sort();
    },

    async states(keys) {
      if (keys.length === 0) return new Map();
      const { results } = await guard("be read", () =>
        db
          .prepare(
            `SELECT key, CASE WHEN format = ?1 THEN state ELSE 'unusable' END AS state
             FROM publications WHERE key IN (SELECT value FROM json_each(?2))`,
          )
          .bind(PUBLICATION_FORMAT, JSON.stringify(keys))
          .all<{ key: string; state: string }>(),
      );
      return new Map(results.map((row) => [row.key, row.state]));
    },

    async recordAttempt(key, attempt) {
      await guard("record a refresh", () =>
        db
          .prepare(
            `INSERT INTO refresh_attempts (key, attempted_at, outcome, reason, message)
             VALUES (?1, ?2, ?3, ?4, ?5)
             ON CONFLICT (key) DO UPDATE SET
               attempted_at = excluded.attempted_at,
               outcome = excluded.outcome,
               reason = excluded.reason,
               message = excluded.message`,
          )
          .bind(key, Date.now(), attempt.outcome, attempt.reason ?? null, attempt.message ?? null)
          .run(),
      );
    },
  };
}
function movedTo(body: string | null) {
  try {
    const uri = (JSON.parse(body ?? "null") as { uri?: unknown } | null)?.uri;
    // A path on this site only, never another host's (`//host/`).
    return typeof uri === "string" && /^\/(?!\/)/.test(uri) ? uri : undefined;
  } catch {
    return undefined;
  }
}
