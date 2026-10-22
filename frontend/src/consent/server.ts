// @getquick/content/consent/server: the consent endpoints on a Site's own
// Frontend Worker (CN-R7–R11). Framework-neutral: standard Request/Response,
// structural D1 and rate-limit bindings, no content runtime.
import { OPTIONAL_CATEGORIES } from "./catalog";
import { CONSENT_PATH } from "./paths";
import {
  MAX_RECORD_BYTES,
  parseConsentRecordRequest,
  type ConsentRecord,
  type ConsentRecordRequest,
} from "./records";
import { CONSENT_ACTIONS, DECISION_VALIDITY_MS, isConsentId, type ConsentAction } from "./state";

/** D1's surface the consent endpoints use (structural, as the publication store's). */
export interface ConsentStatement {
  bind(...values: unknown[]): ConsentStatement;
  first<T = Record<string, unknown>>(): Promise<T | null>;
  all<T = Record<string, unknown>>(): Promise<{ results: T[] }>;
  run(): Promise<{ meta: { changes: number } }>;
}
export interface ConsentDatabase {
  prepare(query: string): ConsentStatement;
}

/** A Workers Rate Limiting binding. */
export interface ConsentRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

export interface ConsentBindings {
  /** The Site's consent database (D1, jurisdiction "eu"), never the publication store. */
  CONSENT_DB?: ConsentDatabase;
  /** The CMS-held bearer secret for the read endpoints (a Worker secret, ≥ 32 characters). */
  CONSENT_READ_TOKEN?: string;
  /** A Workers Rate Limiting binding for record writes, keyed per client IP per request. */
  CONSENT_RATE_LIMITER?: ConsentRateLimiter;
}

export interface ConsentServerConfig {
  /** The Site's identity, recorded with each decision. */
  siteId: string;
  bindings: () => ConsentBindings | Promise<ConsentBindings>;
  /**
   * The Site's public origin(s), when the Worker sees another (a proxy). The
   * request's own origin is always accepted.
   */
  siteOrigins?: readonly string[];
  /** Retention after a decision stops being in force; at most (and by default) 5 years (CN-R10). */
  retentionDays?: number;
  now?: () => number;
}

export const MAX_RETENTION_DAYS = 1826;
const DAY_MS = 24 * 60 * 60 * 1000;
const MAX_RANGE_DAYS = 366;

/** The CSV export's columns, in order (documented; stable within the schema version). */
export const CONSENT_EXPORT_COLUMNS = [
  "recorded_at",
  "consent_id",
  "site_id",
  "action",
  "config_version",
  "language",
  "ui_version",
  "preferences",
  "analytics",
  "marketing",
  "external_media",
  "legal_revisions",
] as const;

interface Row {
  consent_id: string;
  site_id: string;
  recorded_at: string;
  config_version: string;
  legal_revisions: string;
  preferences: number;
  analytics: number;
  marketing: number;
  external_media: number;
  action: string;
  language: string;
  ui_version: string;
}

function recordOf(row: Row): ConsentRecord {
  let legalRevisions: Record<string, string> = {};
  try {
    legalRevisions = JSON.parse(row.legal_revisions) as Record<string, string>;
  } catch {
    // Written by this module as JSON; an unreadable value reads as none.
  }
  return {
    consentId: row.consent_id,
    siteId: row.site_id,
    recordedAt: row.recorded_at,
    configVersion: row.config_version,
    legalRevisions,
    decisions: {
      preferences: row.preferences === 1,
      analytics: row.analytics === 1,
      marketing: row.marketing === 1,
      external_media: row.external_media === 1,
    },
    action: row.action as ConsentAction,
    language: row.language,
    uiVersion: row.ui_version,
  };
}

const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
  Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

/** Comparison whose time doesn't depend on where two strings differ. */
function same(a: string, b: string): boolean {
  const left = new TextEncoder().encode(a);
  const right = new TextEncoder().encode(b);
  let difference = left.length ^ right.length;
  for (let i = 0; i < left.length; i++) difference |= left[i]! ^ (right[i] ?? 0);
  return difference === 0;
}

/** A UTC day (YYYY-MM-DD) as its first instant, or null. */
function day(value: string | null): number | null {
  if (!value || !/^\d{4}-\d{2}-\d{2}$/.test(value)) return null;
  const time = Date.parse(`${value}T00:00:00.000Z`);
  return Number.isNaN(time) || new Date(time).toISOString().slice(0, 10) !== value ? null : time;
}

function csvField(value: string): string {
  return /[",\r\n]/.test(value) ? `"${value.replaceAll('"', '""')}"` : value;
}

/**
 * The consent endpoints. `handle` routes `/gq/consent` (record writes) and
 * `/gq/consent/records/<id>`, `/gq/consent/export`, `/gq/consent/stats`
 * (authenticated reads), and answers null for any other path. `purge` is the
 * scheduled retention job.
 */
export function createConsentServer(config: ConsentServerConfig) {
  const siteId = config.siteId.trim();
  if (!siteId) throw new Error("A nonempty Site identity is required");
  const retentionDays = config.retentionDays ?? MAX_RETENTION_DAYS;
  if (!Number.isInteger(retentionDays) || retentionDays < 1 || retentionDays > MAX_RETENTION_DAYS)
    throw new Error(`retentionDays must be a whole number of days from 1 to ${MAX_RETENTION_DAYS}`);
  const now = config.now ?? Date.now;
  const origins = new Set((config.siteOrigins ?? []).map((origin) => new URL(origin).origin));

  /** CN-R9: same-origin only. A browser's cross-site post carries its Origin. */
  function sameOrigin(request: Request): boolean {
    const origin = request.headers.get("Origin");
    const site = request.headers.get("Sec-Fetch-Site");
    if (site && site !== "same-origin") return false;
    if (!origin) return false;
    if (origin === new URL(request.url).origin || origins.has(origin)) return true;
    // Behind an adapter or proxy the request URL may name another host
    // (Astro's Node adapter uses localhost): the browser's Host header is the
    // origin it posted to.
    try {
      return new URL(origin).host === request.headers.get("Host");
    } catch {
      return false;
    }
  }

  async function readBody(request: Request): Promise<string | null> {
    const declared = Number(request.headers.get("Content-Length") ?? "0");
    if (declared > MAX_RECORD_BYTES) return null;
    if (!request.body) return "";
    const reader = request.body.getReader();
    const chunks: Uint8Array[] = [];
    let size = 0;
    for (;;) {
      const { done, value } = await reader.read();
      if (done) break;
      size += value.byteLength;
      if (size > MAX_RECORD_BYTES) {
        await reader.cancel();
        return null;
      }
      chunks.push(value);
    }
    const bytes = new Uint8Array(size);
    let offset = 0;
    for (const chunk of chunks) {
      bytes.set(chunk, offset);
      offset += chunk.byteLength;
    }
    return new TextDecoder().decode(bytes);
  }

  async function insert(db: ConsentDatabase, request: ConsentRecordRequest) {
    const recordedAt = now();
    const result = await db
      .prepare(
        `INSERT OR IGNORE INTO consent_records (consent_id, site_id, recorded_at, decided_at, expires_at,
          config_version, legal_revisions, preferences, analytics, marketing, external_media, action,
          language, ui_version) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?, ?)`,
      )
      .bind(
        request.consentId,
        siteId,
        new Date(recordedAt).toISOString(),
        request.decidedAt,
        new Date(recordedAt + DECISION_VALIDITY_MS).toISOString(),
        request.configVersion,
        JSON.stringify(request.legalRevisions),
        ...OPTIONAL_CATEGORIES.map((category) => (request.decisions[category] ? 1 : 0)),
        request.action,
        request.language,
        request.uiVersion,
      )
      .run();
    return result.meta.changes > 0;
  }

  /** `POST /gq/consent`: appends one decision (CN-R7–R9). */
  async function handleRecord(request: Request): Promise<Response> {
    if (request.method !== "POST")
      return json(405, { error: "Record decisions with POST." }, { Allow: "POST" });
    if (!sameOrigin(request))
      return json(403, { error: "Consent records are accepted from this Site only." });
    if (!/^application\/json\b/i.test(request.headers.get("Content-Type") ?? ""))
      return json(415, { error: "Send the record as application/json." });
    const bindings = await config.bindings();
    const limiter = bindings.CONSENT_RATE_LIMITER;
    if (limiter) {
      // The client IP keys the limit for this request only; it is never stored.
      const key = request.headers.get("CF-Connecting-IP") ?? "unknown";
      const { success } = await limiter.limit({ key });
      if (!success) return json(429, { error: "Too many consent records; try again later." });
    }
    const text = await readBody(request);
    if (text === null) return json(413, { error: "The record is too large." });
    let value: unknown;
    try {
      value = JSON.parse(text);
    } catch {
      return json(400, { error: "The record is not JSON." });
    }
    const parsed = parseConsentRecordRequest(value);
    if (!parsed.ok) return json(400, { error: `Invalid record: ${parsed.error}.` });
    const db = bindings.CONSENT_DB;
    if (!db) return json(503, { error: "Consent records are not configured (CONSENT_DB)." });
    try {
      const appended = await insert(db, parsed.request);
      return json(appended ? 201 : 200, { recorded: true, duplicate: !appended });
    } catch (error) {
      console.error(`Consent: a record couldn't be written: ${(error as Error).message}`);
      return json(503, { error: "The consent record couldn't be stored; try again." });
    }
  }

  async function authorizedDb(
    request: Request,
  ): Promise<{ db: ConsentDatabase } | { response: Response }> {
    const bindings = await config.bindings();
    const token = bindings.CONSENT_READ_TOKEN?.trim() ?? "";
    if (token.length < 32 || !bindings.CONSENT_DB)
      return {
        response: json(503, {
          error: "Consent reads are not configured (CONSENT_DB, CONSENT_READ_TOKEN).",
        }),
      };
    const header = request.headers.get("Authorization") ?? "";
    const presented = header.startsWith("Bearer ") ? header.slice(7).trim() : "";
    if (!presented || !same(presented, token))
      return {
        response: json(
          401,
          { error: "A valid bearer token is required." },
          { "WWW-Authenticate": "Bearer" },
        ),
      };
    return { db: bindings.CONSENT_DB };
  }

  function range(url: URL): { from: string; to: string; start: string; end: string } | null {
    const from = day(url.searchParams.get("from"));
    const to = day(url.searchParams.get("to"));
    if (from === null || to === null || to < from || (to - from) / DAY_MS >= MAX_RANGE_DAYS)
      return null;
    return {
      from: url.searchParams.get("from")!,
      to: url.searchParams.get("to")!,
      start: new Date(from).toISOString(),
      end: new Date(to + DAY_MS).toISOString(),
    };
  }

  const columns = `consent_id, site_id, recorded_at, config_version, legal_revisions, preferences,
    analytics, marketing, external_media, action, language, ui_version`;

  /** Authenticated reads (CN-R11). */
  async function handleRead(request: Request): Promise<Response> {
    if (request.method !== "GET")
      return json(405, { error: "Read consent records with GET." }, { Allow: "GET" });
    const authorized = await authorizedDb(request);
    if ("response" in authorized) return authorized.response;
    const { db } = authorized;
    const url = new URL(request.url);
    const path = url.pathname.replace(/\/+$/, "");
    try {
      if (path.startsWith(`${CONSENT_PATH}/records/`)) {
        const consentId = decodeURIComponent(path.slice(`${CONSENT_PATH}/records/`.length));
        if (!isConsentId(consentId)) return json(400, { error: "Not a consent ID." });
        const { results } = await db
          .prepare(`SELECT ${columns} FROM consent_records WHERE consent_id = ? ORDER BY id`)
          .bind(consentId)
          .all<Row>();
        if (!results.length) return json(404, { error: "No records for this consent ID." });
        return json(200, { consentId, records: results.map(recordOf) });
      }
      if (path === `${CONSENT_PATH}/export` || path === `${CONSENT_PATH}/stats`) {
        const window = range(url);
        if (!window)
          return json(400, {
            error: `from and to must be UTC days (YYYY-MM-DD), from ≤ to, at most ${MAX_RANGE_DAYS} days.`,
          });
        if (path.endsWith("/export")) {
          const { results } = await db
            .prepare(
              `SELECT ${columns} FROM consent_records WHERE recorded_at >= ? AND recorded_at < ? ORDER BY recorded_at, id`,
            )
            .bind(window.start, window.end)
            .all<Row>();
          const lines = [CONSENT_EXPORT_COLUMNS.join(",")];
          for (const row of results) {
            const record = recordOf(row);
            lines.push(
              [
                record.recordedAt,
                record.consentId,
                record.siteId,
                record.action,
                record.configVersion,
                record.language,
                record.uiVersion,
                ...OPTIONAL_CATEGORIES.map((category) => String(record.decisions[category])),
                JSON.stringify(record.legalRevisions),
              ]
                .map(csvField)
                .join(","),
            );
          }
          return new Response(lines.join("\r\n") + "\r\n", {
            headers: {
              "Content-Type": "text/csv; charset=utf-8",
              "Content-Disposition": `attachment; filename="consent-${window.from}-${window.to}.csv"`,
              "Cache-Control": "no-store",
            },
          });
        }
        const counts = await db
          .prepare(
            `SELECT action, COUNT(*) AS total, SUM(preferences) AS preferences, SUM(analytics) AS analytics,
              SUM(marketing) AS marketing, SUM(external_media) AS external_media
              FROM consent_records WHERE recorded_at >= ? AND recorded_at < ? GROUP BY action`,
          )
          .bind(window.start, window.end)
          .all<Record<string, number | string | null>>();
        const byAction = Object.fromEntries(CONSENT_ACTIONS.map((action) => [action, 0])) as Record<
          ConsentAction,
          number
        >;
        const byCategory = Object.fromEntries(
          OPTIONAL_CATEGORIES.map((category) => [category, { granted: 0, denied: 0 }]),
        ) as Record<(typeof OPTIONAL_CATEGORIES)[number], { granted: number; denied: number }>;
        let total = 0;
        for (const row of counts.results) {
          const count = Number(row.total ?? 0);
          total += count;
          byAction[row.action as ConsentAction] = count;
          for (const category of OPTIONAL_CATEGORIES) {
            const granted = Number(row[category] ?? 0);
            byCategory[category].granted += granted;
            byCategory[category].denied += count - granted;
          }
        }
        return json(200, { from: window.from, to: window.to, total, byAction, byCategory });
      }
      return json(404, { error: "Not a consent endpoint." });
    } catch (error) {
      console.error(`Consent: a read failed: ${(error as Error).message}`);
      return json(503, { error: "Consent records couldn't be read; try again." });
    }
  }

  /**
   * CN-R10: deletes records whose decision stopped being in force (superseded
   * by a later one, or expired) more than the retention period ago.
   */
  async function purge(): Promise<{ deleted: number }> {
    const db = (await config.bindings()).CONSENT_DB;
    if (!db) throw new Error("Consent records are not configured (CONSENT_DB)");
    const cutoff = new Date(now() - retentionDays * DAY_MS).toISOString();
    const result = await db
      .prepare(
        `DELETE FROM consent_records WHERE id IN (
          SELECT r.id FROM consent_records r WHERE MIN(
            r.expires_at,
            COALESCE((SELECT MIN(n.recorded_at) FROM consent_records n
              WHERE n.consent_id = r.consent_id AND n.id > r.id), r.expires_at)
          ) < ?)`,
      )
      .bind(cutoff)
      .run();
    return { deleted: result.meta.changes };
  }

  /** What is configured, for readiness: never values. */
  async function check() {
    const bindings = await config.bindings();
    return {
      records: Boolean(bindings.CONSENT_DB),
      reads:
        Boolean(bindings.CONSENT_DB) && (bindings.CONSENT_READ_TOKEN?.trim().length ?? 0) >= 32,
      rateLimit: Boolean(bindings.CONSENT_RATE_LIMITER),
      retentionDays,
    };
  }

  /** Routes a consent request; null when the path isn't a consent endpoint. */
  async function handle(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (path === CONSENT_PATH) return handleRecord(request);
    if (path.startsWith(`${CONSENT_PATH}/`)) return handleRead(request);
    return null;
  }

  return { handle, handleRecord, handleRead, purge, check };
}

export type ConsentServer = ReturnType<typeof createConsentServer>;
export { CONSENT_PATH };
export type { ConsentRecord, ConsentRecordRequest } from "./records";
