// Consent records (#22) and their authenticated read, export and purge (#26)
// against the consent migrations on a local SQLite D1 stand-in. The workerd
// D1 proof is scripts/consent-worker-consumer.mjs.
import { afterEach, expect, test, vi } from "vite-plus/test";
import {
  CONSENT_EXPORT_COLUMNS,
  createConsentServer,
  type ConsentBindings,
} from "@getquick/content/consent/server";
import { consentConfiguration, consentRecordRequest, decide } from "@getquick/content/consent";
import { openConsentD1, type TestConsentD1 } from "./support/consent-d1";

const ORIGIN = "https://www.acme.test";
const TOKEN = "consent-read-token-0123456789abcdef0123";
const configuration = consentConfiguration({ services: ["youtube"] });
let db: TestConsentD1;
let clock = Date.parse("2026-10-22T10:00:00.000Z");

afterEach(() => db?.close());

function server(bindings: Partial<ConsentBindings> = {}, retentionDays?: number) {
  db = openConsentD1();
  return createConsentServer({
    siteId: "acme",
    bindings: () => ({ CONSENT_DB: db, CONSENT_READ_TOKEN: TOKEN, ...bindings }),
    now: () => clock,
    ...(retentionDays ? { retentionDays } : {}),
  });
}

function body(
  choice: Parameters<typeof decide>[2] = { kind: "reject_all" },
  previous = null as never,
) {
  const { state, action } = decide(configuration, previous, choice, clock);
  return {
    state,
    json: consentRecordRequest(state, action, {
      language: "pt-PT",
      uiVersion: "gq-content@0.1.0",
      legalRevisions: { cookie_policy: "2026-10-01T10:00:00" },
    }),
  };
}

function post(value: unknown, headers: Record<string, string> = {}) {
  return new Request(`${ORIGIN}/gq/consent`, {
    method: "POST",
    headers: {
      "Content-Type": "application/json",
      Origin: ORIGIN,
      "Sec-Fetch-Site": "same-origin",
      "CF-Connecting-IP": "203.0.113.7",
      "User-Agent": "Mozilla/5.0 test",
      ...headers,
    },
    body: typeof value === "string" ? value : JSON.stringify(value),
  });
}

const get = (path: string, token: string | null = TOKEN) =>
  new Request(`${ORIGIN}${path}`, { headers: token ? { Authorization: `Bearer ${token}` } : {} });

test("a decision is appended with exactly the CN-R7 fields; no IP, user agent or account", async () => {
  const consent = server();
  const { json } = body();
  const response = await consent.handle(post(json));
  expect(response?.status).toBe(201);
  expect(response?.headers.get("Cache-Control")).toBe("no-store");
  const columns = (
    db.sqlite.prepare("PRAGMA table_info(consent_records)").all() as Array<{ name: string }>
  ).map((column) => column.name);
  expect(columns.filter((name) => /ip|agent|user|account|email/i.test(name))).toEqual([]);
  const stored = JSON.stringify(db.sqlite.prepare("SELECT * FROM consent_records").all());
  expect(stored).not.toContain("203.0.113.7");
  expect(stored).not.toContain("Mozilla");
  const read = await consent.handle(get(`/gq/consent/records/${json.consentId}`));
  expect(read?.status).toBe(200);
  expect(await read!.json()).toEqual({
    consentId: json.consentId,
    records: [
      {
        consentId: json.consentId,
        siteId: "acme",
        recordedAt: "2026-10-22T10:00:00.000Z",
        configVersion: configuration.version,
        legalRevisions: { cookie_policy: "2026-10-01T10:00:00" },
        decisions: {
          preferences: false,
          analytics: false,
          marketing: false,
          external_media: false,
        },
        action: "reject_all",
        language: "pt-PT",
        uiVersion: "gq-content@0.1.0",
      },
    ],
  });
});

test("records are append-only: a retry adds nothing, a later decision adds a row, updates abort", async () => {
  const consent = server();
  const first = body({ kind: "accept_all" });
  expect((await consent.handle(post(first.json)))?.status).toBe(201);
  const retried = await consent.handle(post(first.json));
  expect(retried?.status).toBe(200);
  expect(await retried!.json()).toEqual({ recorded: true, duplicate: true });
  clock += 60_000;
  const later = decide(configuration, first.state, { kind: "reject_all" }, clock);
  const laterJson = consentRecordRequest(later.state, later.action, {
    language: "en",
    uiVersion: "x",
  });
  expect((await consent.handle(post(laterJson)))?.status).toBe(201);
  const read = (await (await consent.handle(
    get(`/gq/consent/records/${first.json.consentId}`),
  ))!.json()) as {
    records: Array<{ action: string }>;
  };
  expect(read.records.map((record) => record.action)).toEqual(["accept_all", "withdraw"]);
  expect(() => db.sqlite.exec("UPDATE consent_records SET analytics = 1")).toThrow(/append-only/);
});

test("cross-origin, invalid, oversize and wrongly typed records are rejected (CN-R9)", async () => {
  const consent = server();
  const { json } = body();
  expect((await consent.handle(post(json, { Origin: "https://evil.example" })))?.status).toBe(403);
  expect((await consent.handle(post(json, { "Sec-Fetch-Site": "cross-site" })))?.status).toBe(403);
  const noOrigin = post(json);
  noOrigin.headers.delete("Origin");
  expect((await consent.handle(noOrigin))?.status).toBe(403);
  expect((await consent.handle(post(json, { "Content-Type": "text/plain" })))?.status).toBe(415);
  expect((await consent.handle(post({ ...json, ip: "1.2.3.4" })))?.status).toBe(400);
  expect((await consent.handle(post({ ...json, action: "maybe" })))?.status).toBe(400);
  expect((await consent.handle(post({ ...json, decisions: { analytics: true } })))?.status).toBe(
    400,
  );
  expect((await consent.handle(post("not json")))?.status).toBe(400);
  const huge = { ...json, uiVersion: "x".repeat(4000) };
  expect((await consent.handle(post(huge)))?.status).toBe(413);
  expect((await consent.handle(new Request(`${ORIGIN}/gq/consent`)))?.status).toBe(405);
  expect(db.sqlite.prepare("SELECT COUNT(*) AS n FROM consent_records").get()).toEqual({ n: 0 });
});

test("the rate limit is keyed on the request's IP and never stored", async () => {
  const keys: string[] = [];
  let allowed = 1;
  const consent = server({
    CONSENT_RATE_LIMITER: {
      async limit({ key }) {
        keys.push(key);
        return { success: allowed-- > 0 };
      },
    },
  });
  expect((await consent.handle(post(body().json)))?.status).toBe(201);
  expect((await consent.handle(post(body().json)))?.status).toBe(429);
  expect(keys).toEqual(["203.0.113.7", "203.0.113.7"]);
  expect(JSON.stringify(db.sqlite.prepare("SELECT * FROM consent_records").all())).not.toContain(
    "203.0.113",
  );
  expect(await consent.check()).toEqual({
    records: true,
    reads: true,
    rateLimit: true,
    retentionDays: 1826,
  });
});

test("a failed write is a 503 the browser retries; nothing is stored as a grant", async () => {
  const consent = server();
  db.unavailable = true;
  const error = vi.spyOn(console, "error").mockImplementation(() => {});
  expect((await consent.handle(post(body().json)))?.status).toBe(503);
  error.mockRestore();
  db.unavailable = false;
  const noDb = createConsentServer({ siteId: "acme", bindings: () => ({}) });
  expect((await noDb.handle(post(body().json)))?.status).toBe(503);
});

test("reads require the bearer secret (CN-R11)", async () => {
  const consent = server();
  const id = body().json.consentId;
  expect((await consent.handle(get(`/gq/consent/records/${id}`, null)))?.status).toBe(401);
  expect(
    (await consent.handle(get(`/gq/consent/records/${id}`, "wrong-token-wrong-token-wrong-token")))
      ?.status,
  ).toBe(401);
  expect((await consent.handle(get(`/gq/consent/records/${id}`)))?.status).toBe(404);
  expect((await consent.handle(get(`/gq/consent/records/not-an-id`)))?.status).toBe(400);
  const short = createConsentServer({
    siteId: "a",
    bindings: () => ({ CONSENT_DB: db, CONSENT_READ_TOKEN: "short" }),
  });
  expect((await short.handle(get(`/gq/consent/records/${id}`, "short")))?.status).toBe(503);
  expect(await consent.handle(get("/other"))).toBeNull();
});

async function seedDays(consent: ReturnType<typeof server>) {
  const days = [
    "2026-10-01T00:00:00.000Z",
    "2026-10-01T23:59:59.999Z",
    "2026-10-02T12:00:00.000Z",
    "2026-10-03T00:00:00.000Z",
  ];
  const choices = [
    { kind: "accept_all" },
    { kind: "reject_all" },
    { kind: "custom", decisions: { external_media: true } },
    { kind: "reject_all" },
  ] as const;
  for (const [index, at] of days.entries()) {
    clock = Date.parse(at);
    expect((await consent.handle(post(body(choices[index]).json)))?.status).toBe(201);
  }
}

test("export covers exactly the requested UTC days in the documented CSV format", async () => {
  const consent = server();
  await seedDays(consent);
  const response = await consent.handle(get("/gq/consent/export?from=2026-10-01&to=2026-10-02"));
  expect(response?.status).toBe(200);
  expect(response?.headers.get("Content-Type")).toBe("text/csv; charset=utf-8");
  const lines = (await response!.text()).trimEnd().split("\r\n");
  expect(lines[0]).toBe(CONSENT_EXPORT_COLUMNS.join(","));
  expect(lines.slice(1).map((line) => line.split(",")[0])).toEqual([
    "2026-10-01T00:00:00.000Z",
    "2026-10-01T23:59:59.999Z",
    "2026-10-02T12:00:00.000Z",
  ]);
  expect(lines[1]).toMatch(
    /,accept_all,[0-9a-f]{16},pt-PT,gq-content@0\.1\.0,false,false,false,true,"\{""cookie_policy"":""2026-10-01T10:00:00""\}"$/,
  );
  for (const bad of [
    "from=2026-10-02&to=2026-10-01",
    "from=2026-1-1&to=2026-10-01",
    "from=2025-01-01&to=2026-10-01",
    "to=2026-10-01",
  ]) {
    expect((await consent.handle(get(`/gq/consent/export?${bad}`)))?.status).toBe(400);
  }
});

test("counts by action and category match the stored decisions", async () => {
  const consent = server();
  await seedDays(consent);
  const response = await consent.handle(get("/gq/consent/stats?from=2026-10-01&to=2026-10-03"));
  expect(await response!.json()).toEqual({
    from: "2026-10-01",
    to: "2026-10-03",
    total: 4,
    byAction: { accept_all: 1, reject_all: 2, custom: 1, withdraw: 0, renew: 0 },
    byCategory: {
      preferences: { granted: 0, denied: 4 },
      analytics: { granted: 0, denied: 4 },
      marketing: { granted: 0, denied: 4 },
      external_media: { granted: 2, denied: 2 },
    },
  });
});

test("purge removes records 5 years after they stop being in force, or a shorter period (CN-R10)", async () => {
  const consent = server();
  const DAY = 86_400_000;
  clock = Date.parse("2020-01-01T00:00:00.000Z");
  const old = body({ kind: "accept_all" });
  await consent.handle(post(old.json)); // expires 2020-07-01, purged after 2025-07-01
  clock = Date.parse("2020-03-01T00:00:00.000Z");
  const superseding = decide(configuration, old.state, { kind: "reject_all" }, clock);
  await consent.handle(
    post(
      consentRecordRequest(superseding.state, superseding.action, {
        language: "en",
        uiVersion: "x",
      }),
    ),
  );
  clock = Date.parse("2025-03-02T00:00:00.000Z");
  const current = body({ kind: "reject_all" });
  await consent.handle(post(current.json));
  // 5 years after 2020-03-01 (the first is superseded then): only it goes.
  expect(await consent.purge()).toEqual({ deleted: 1 });
  const left = db.sqlite.prepare("SELECT action FROM consent_records ORDER BY id").all();
  expect(left).toEqual([{ action: "withdraw" }, { action: "reject_all" }]);
  clock = Date.parse("2025-09-01T00:00:00.000Z");
  expect(await consent.purge()).toEqual({ deleted: 1 }); // the withdrawal expired 2020-08-31
  expect((await consent.handle(get(`/gq/consent/records/${current.json.consentId}`)))?.status).toBe(
    200,
  );

  const shorter = server({}, 30);
  clock = Date.parse("2026-01-01T00:00:00.000Z");
  await shorter.handle(post(body().json));
  clock += (183 + 29) * DAY;
  expect(await shorter.purge()).toEqual({ deleted: 0 });
  clock += 2 * DAY;
  expect(await shorter.purge()).toEqual({ deleted: 1 });
  expect(() =>
    createConsentServer({ siteId: "a", bindings: () => ({}), retentionDays: 3000 }),
  ).toThrow();
});
