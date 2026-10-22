import { createContentRuntime } from "@getquick/content/server";
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";
import { data, gmt, listing, queries, stubWordPress, type Handler } from "./support/wordpress-stub";
const secret = "reconcile-event-key-01234567890123456789012345";
let db: TestD1;
let api: ReturnType<typeof createContentRuntime>;
let entries: Map<string, { id: string; content: string; modified: number }>;
let heading: string;
const handlers = {
  home: () =>
    data({
      generalSettings: { title: "Acme", description: "Things" },
      nodeByUri: {
        __typename: "Page",
        id: "front",
        isFrontPage: true,
        title: "Home",
        content: heading,
      },
      designTokens: { colors: [], spacingSizes: [] },
    }),
  entry: ({ uri }) => {
    const entry = entries.get(String(uri));
    return data({
      pageBy: entry
        ? {
            id: entry.id,
            title: "Entry",
            content: entry.content,
            uri,
            modifiedGmt: gmt(entry.modified),
            status: "publish",
            isRestricted: false,
            featuredImage: null,
            language: { slug: "pt" },
            translations: [],
          }
        : null,
      postBy: null,
      designTokens: { colors: [], spacingSizes: [] },
    });
  },
  routes: () =>
    listing(...[...entries].map(([uri, e]) => ({ uri, id: e.id, modifiedGmt: gmt(e.modified) }))),
} satisfies Record<string, Handler>;
function wordpress(
  overrides: Partial<Record<keyof typeof handlers | "chrome" | "design", Handler>> = {},
) {
  return stubWordPress({ ...handlers, ...overrides });
}
function runtime(database = db) {
  return createContentRuntime({
    site: "Acme",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings: () => ({ PUBLICATION_DB: database, PUBLICATION_EVENT_SECRET: secret }),
  });
}
async function event(action: string, extra: Record<string, unknown> = {}) {
  const body = JSON.stringify({
    site: "Acme",
    id: randomUUID(),
    occurredAt: Date.now(),
    action,
    ...extra,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await api.handleEvent(
    new Request("https://site.test/gq/events", {
      method: "POST",
      body,
      headers: {
        "GQ-Event-Timestamp": timestamp,
        "GQ-Event-Signature":
          "v1=" +
          createHmac("sha256", secret)
            .update(timestamp + "." + body)
            .digest("hex"),
      },
    }),
  );
  return { status: response.status, body: await response.json() };
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-02T09:00:00Z"));
  db = openTestD1();
  api = runtime();
  heading = "<h1>Welcome</h1>";
  entries = new Map([
    ["/about/", { id: "page-1", content: "<p>Original</p>", modified: Date.now() - 60000 }],
  ]);
  wordpress();
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
const tick = () => vi.setSystemTime(Date.now() + 60000);
async function content(uri = "/about/") {
  const page = await api.publishedEntry(uri);
  expect(page.kind).toBe("found");
  if (page.kind !== "found") throw new Error("entry unavailable");
  return page.content.entry.content;
}
test("signed reconciliation repairs a missed publication and exposes persisted readiness evidence", async () => {
  const run = await event("reconcile");
  expect(run.status).toBe(200);
  expect(run.body).toMatchObject({
    status: "reconciled",
    checked: 1,
    pending: 0,
    failed: 0,
    entries: { "/about/": { change: "new", outcome: "refreshed" } },
  });
  expect(await content()).toBe("<p>Original</p>");
  expect((await event("check")).body).toMatchObject({
    status: "checked",
    site: "Acme",
    reconciliation: { outcome: "reconciled", checked: 1, running: false },
    store: {
      home: "published",
      chrome: "published",
      design: "published",
      entries: { published: 1 },
      withdrawals: 0,
      failedEvents: 0,
    },
  });
});
test("missed changes, moves and confirmed removals use canonical published routes", async () => {
  await event("reconcile");
  tick();
  const old = entries.get("/about/")!;
  entries.delete("/about/");
  entries.set("/new/", { ...old, content: "<p>Moved</p>", modified: Date.now() });
  // GraphQL may return absolute permalinks; they describe the same local routes.
  wordpress({
    routes: () =>
      listing({ id: old.id, uri: "https://site.test/new/", modifiedGmt: gmt(Date.now()) }),
  });
  expect((await event("reconcile")).body).toMatchObject({
    status: "reconciled",
    entries: { "/new/": { change: "moved", outcome: "refreshed" } },
  });
  expect(await api.publishedEntry("/about/")).toEqual({ kind: "moved", uri: "/new/" });
  expect(await content("/new/")).toBe("<p>Moved</p>");
  tick();
  entries.clear();
  wordpress();
  expect((await event("reconcile")).body).toMatchObject({
    entries: { "/new/": { change: "removed", outcome: "refreshed" } },
  });
  expect((await api.publishedEntry("/new/")).kind).toBe("missing");
});
test("canonical shared comparisons report unchanged and rotating rereads detect changes without modified time", async () => {
  for (let n = 0; n < 7; n++)
    entries.set(`/entry-${n}/`, {
      id: `node-${n}`,
      content: "<p>Before</p>",
      modified: Date.now() - 60000,
    });
  await event("reconcile");
  tick();
  const fetch = wordpress({
    routes: () =>
      listing(
        ...[...entries].map(([uri, e]) => ({
          uri: "https://site.test" + uri,
          id: e.id,
          modifiedGmt: gmt(e.modified),
        })),
      ),
  });
  const unchanged = await event("reconcile");
  expect(unchanged.body).toMatchObject({
    changed: 0,
    shared: {
      home: { outcome: "unchanged" },
      chrome: { outcome: "unchanged" },
      design: { outcome: "unchanged" },
    },
  });
  expect(fetch.mock.calls.length).toBeLessThanOrEqual(6);
  entries.get("/entry-6/")!.content = "<p>Changed without timestamp</p>";
  let visible = false;
  for (let n = 0; n < 5; n++) {
    tick();
    await event("reconcile");
    if ((await content("/entry-6/")) === "<p>Changed without timestamp</p>") {
      visible = true;
      break;
    }
  }
  expect(visible).toBe(true);
});
test("incomplete paginated lists cannot remove stored content and failed entry reads recover", async () => {
  await event("reconcile");
  tick();
  entries.get("/about/")!.content = "<p>Later</p>";
  entries.get("/about/")!.modified = Date.now();
  wordpress({
    routes: () =>
      data({ contentNodes: { nodes: [], pageInfo: { hasNextPage: true, endCursor: null } } }),
  });
  expect((await event("reconcile")).status).toBe(503);
  expect(await content()).toBe("<p>Original</p>");
  tick();
  wordpress({ entry: () => ({ ok: false, status: 502 }) });
  expect((await event("reconcile")).body).toMatchObject({
    status: "failed",
    entries: { "/about/": { outcome: "kept", failure: { reason: "http" } } },
  });
  expect((await event("check")).body.store.failedEvents).toBe(1);
  expect(await content()).toBe("<p>Original</p>");
  tick();
  wordpress();
  expect((await event("reconcile")).body.status).toBe("reconciled");
  expect(await content()).toBe("<p>Later</p>");
  expect((await event("check")).body.store.failedEvents).toBe(0);
});
test("outages preserve public content and complete failed evidence before recovery", async () => {
  await event("reconcile");
  const before = (await event("check")).body.reconciliation;
  tick();
  const fail = () => {
    throw new TypeError("CMS offline");
  };
  wordpress({ home: fail, chrome: fail, design: fail, routes: fail, entry: fail });
  expect((await event("reconcile")).status).toBe(503);
  api = runtime();
  const recorded = (await event("check")).body.reconciliation;
  expect(recorded).toMatchObject({
    outcome: "failed",
    running: false,
    failed: 4,
    reconciledAt: before.reconciledAt,
    reason: "network",
  });
  expect(recorded.finishedAt).toBe(Date.now());
  expect(await content()).toBe("<p>Original</p>");
  expect((await api.publishedEntry("/unknown/")).kind).toBe("unavailable");
  tick();
  wordpress();
  expect((await event("reconcile")).body.status).toBe("reconciled");
});
test("withdrawals survive older scans and only later modifications permit republication", async () => {
  await event("reconcile");
  tick();
  await event("withdraw", { entry: { id: "page-1", uri: "/about/" } });
  tick();
  const old = await event("reconcile");
  expect(old.body.entries).not.toHaveProperty("/about/");
  expect((await api.publishedEntry("/about/")).kind).toBe("missing");
  entries.get("/about/")!.modified = Date.now();
  entries.get("/about/")!.content = "<p>Republished</p>";
  tick();
  expect((await event("reconcile")).body.entries["/about/"]).toEqual({
    change: "republished",
    outcome: "refreshed",
  });
  expect(await content()).toBe("<p>Republished</p>");
});
test("a withdrawal accepted during reconciliation prevents in-flight promotion", async () => {
  await event("reconcile");
  tick();
  entries.get("/about/")!.modified = Date.now();
  const answer = handlers.entry({ uri: "/about/" });
  let release!: () => void;
  let entered!: () => void;
  const started = new Promise<void>((r) => {
    entered = r;
  });
  const barrier = new Promise<void>((r) => {
    release = r;
  });
  wordpress({
    entry: async () => {
      entered();
      await barrier;
      return answer;
    },
  });
  const pending = event("reconcile");
  await started;
  tick();
  await event("withdraw", { entry: { id: "page-1", uri: "/about/" } });
  release();
  await pending;
  expect((await api.publishedEntry("/about/")).kind).toBe("missing");
});
test("D1 lease excludes overlapping runs and unfinished work resumes when the interrupted lease expires", async () => {
  // Real SQLite rejects finishing a run; its acquired lease survives a new runtime.
  db.exec(
    "CREATE TRIGGER interrupt_finish BEFORE UPDATE ON reconciliation WHEN NEW.lease_until = 0 BEGIN SELECT RAISE(FAIL, 'interrupted'); END",
  );
  await event("reconcile");
  api = runtime();
  const fetch = wordpress();
  expect((await event("reconcile")).body).toMatchObject({ status: "busy" });
  expect(fetch).not.toHaveBeenCalled();
  expect((await event("check")).body.reconciliation.running).toBe(true);
  db.exec("DROP TRIGGER interrupt_finish");
  vi.setSystemTime(Date.now() + 120000);
  expect((await event("reconcile")).body.status).toBe("reconciled");
  expect((await event("check")).body.reconciliation.running).toBe(false);
});
test("budgeted partial runs persist pending evidence and continue oldest attempted work", async () => {
  for (let n = 0; n < 45; n++)
    entries.set(`/story-${String(n).padStart(2, "0")}/`, {
      id: `story-${n}`,
      content: `<p>Story ${n}</p>`,
      modified: Date.now() - 1000,
    });
  const statuses = [];
  for (let n = 0; n < 3; n++) {
    const fetch = wordpress();
    const run = await event("reconcile");
    statuses.push(run.body.status);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(40);
    const check = (await event("check")).body;
    expect(check.reconciliation).toMatchObject({
      outcome: run.body.status,
      pending: run.body.pending,
      failed: 0,
    });
    if (n === 0) {
      expect(run.body.pending).toBeGreaterThan(0);
      api = runtime();
      expect((await event("check")).body.reconciliation).toEqual(check.reconciliation);
    }
    tick();
  }
  expect(statuses).toEqual(["behind", "behind", "reconciled"]);
  expect(await content("/story-44/")).toBe("<p>Story 44</p>");
});

test.each([
  { languages: [], count: 18, firstPending: 1, firstRequests: 39, pages: 1 },
  {
    languages: [{ locale: "en_US", slug: "en" }],
    count: 17,
    firstPending: 1,
    firstRequests: 40,
    pages: 1,
  },
  {
    languages: [
      { locale: "en_US", slug: "en" },
      { locale: "custom_locale_variant", slug: "custom-slug" },
    ],
    count: 16,
    firstPending: 2,
    firstRequests: 39,
    pages: 1,
  },
  {
    languages: [{ locale: "en_US", slug: "en" }],
    count: 16,
    firstPending: 1,
    firstRequests: 39,
    pages: 2,
  },
])(
  "home and entry block recovery stay within 40 requests with $languages.length additional languages and $pages list pages",
  async ({ languages, count, firstPending, firstRequests, pages }) => {
    const options = {
      site: "Acme",
      graphqlEndpoint: "https://cms.test/graphql",
      cmsOrigin: "https://cms.test",
      wordpress: { locale: "pt_PT", languages },
      isServer: () => true,
      bindings: () => ({ PUBLICATION_DB: db, PUBLICATION_EVENT_SECRET: secret }),
    };
    api = createContentRuntime(options);
    entries.clear();
    for (let n = 0; n < count; n++)
      entries.set(`/story-${String(n).padStart(2, "0")}/`, {
        id: `story-${n}`,
        content: `<p>Story ${n}</p>`,
        modified: Date.now() - 1000,
      });
    expect(api.languages).toHaveLength(languages.length + 1);
    const routes: Handler = (variables) =>
      variables.after || pages === 1
        ? handlers.routes()
        : data({
            contentNodes: {
              nodes: [],
              pageInfo: { hasNextPage: true, endCursor: "next" },
            },
          });
    const fetch = wordpress({
      routes,
      home: (variables) => {
        if (variables.withBlocks !== false) return { ok: false, status: 502 };
        return data({
          [variables.language ? "language" : "generalSettings"]: {
            title: typeof variables.language === "string" ? variables.language : "PT",
            description: "Things",
          },
          nodeByUri: {
            __typename: "Page",
            id: typeof variables.uri === "string" ? variables.uri : "/",
            isFrontPage: true,
            title: "Home",
            content: heading,
          },
          designTokens: { colors: [], spacingSizes: [] },
        });
      },
      entry: (variables) =>
        variables.withBlocks === false ? handlers.entry(variables) : { ok: false, status: 502 },
    });
    const first = await event("reconcile");
    // Count actual transport calls, including failed attempts and blockless retries.
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(40);
    expect(fetch.mock.calls.length).toBe(firstRequests);
    expect(first.body).toMatchObject({
      status: "failed",
      pending: firstPending,
      failed: count - firstPending + languages.length + 1,
    });
    expect(Object.keys(first.body.entries)).toHaveLength(count - firstPending);
    api = createContentRuntime(options);
    expect((await event("check")).body.reconciliation).toMatchObject({
      outcome: "failed",
      pending: firstPending,
      failed: count - firstPending + languages.length + 1,
      running: false,
    });
    // Blockless recovery remains partial: retain its failed records and recover
    // through ordinary complete reads on subsequent scheduler runs.
    const healthyHome: Handler = (variables) =>
      data({
        [variables.language ? "language" : "generalSettings"]: {
          title: "Home",
          description: "Things",
        },
        nodeByUri: {
          __typename: "Page",
          id: "front",
          isFrontPage: true,
          title: "Home",
          content: heading,
        },
        designTokens: { colors: [], spacingSizes: [] },
      });
    for (let n = 0; n < 2; n++) {
      tick();
      const transport = wordpress({ home: healthyHome, routes });
      const next = await event("reconcile");
      expect(transport.mock.calls.length).toBeLessThanOrEqual(40);
      if (n === 0) expect(next.body.pending).toBe(firstPending);
      else expect(next.body).toMatchObject({ status: "reconciled", pending: 0, failed: 0 });
    }
    for (const [uri, entry] of entries) expect(await content(uri)).toBe(entry.content);
    expect((await event("check")).body.reconciliation).toMatchObject({
      outcome: "reconciled",
      pending: 0,
      failed: 0,
    });
  },
);

test("signed check distinguishes an unprepared store from unavailable store evidence without CMS reads", async () => {
  const fetch = wordpress();
  expect((await event("check")).body).toEqual({
    status: "checked",
    site: "Acme",
    reconciliation: null,
    store: { home: null, chrome: null, design: null, entries: {}, withdrawals: 0, failedEvents: 0 },
  });
  db.unavailable = true;
  expect((await event("check")).body).toEqual({
    status: "checked",
    site: "Acme",
    reconciliation: null,
    store: null,
  });
  expect(fetch).not.toHaveBeenCalled();
});
test.each(["check", "reconcile"])(
  "%s preserves strict envelope validation before any CMS read",
  async (action) => {
    const fetch = wordpress();
    for (const extra of [
      { unexpected: true },
      { entry: { id: "node", uri: "/about/" } },
      { occurredAt: Date.now() + 10000 },
    ])
      expect((await event(action, extra)).status).toBe(400);
    expect(fetch).not.toHaveBeenCalled();
  },
);

/** The settled check's clock margin (reconciliation.ts's SETTLED_CLOCK_MARGIN_MS), and a little more. */
const pastMargin = () => vi.setSystemTime(Date.now() + 6 * 60000);
const readUris = (fetch: ReturnType<typeof wordpress>) =>
  queries(fetch, "EntryByUri").map(([, init]) => JSON.parse(init.body as string).variables.uri);

test("listed routes stored missing and unmodified since settle instead of filling every run", async () => {
  entries.clear();
  // WordPress lists more entries than one run reads, and reads each as missing
  // (as when a Page shares its URI with an archive).
  const missing = new Map(
    Array.from({ length: 20 }, (_, n) => [
      `/clash-${String(n).padStart(2, "0")}/`,
      { id: `clash-${n}`, modified: Date.now() - 60 * 60000 },
    ]),
  );
  const routes: Handler = () =>
    listing(...[...missing].map(([uri, e]) => ({ uri, id: e.id, modifiedGmt: gmt(e.modified) })));
  const statuses = [];
  for (let n = 0; n < 2; n++) {
    wordpress({ routes });
    statuses.push((await event("reconcile")).body.status);
    tick();
  }
  expect(statuses).toEqual(["behind", "reconciled"]);
  expect((await event("check")).body).toMatchObject({
    reconciliation: { outcome: "reconciled", pending: 0 },
    store: { entries: { missing: 20 } },
  });

  // Settled: they aren't pending, and only a few are re-read in turn, oldest first.
  let fetch = wordpress({ routes });
  let run = await event("reconcile");
  expect(run.body).toMatchObject({ status: "reconciled", pending: 0, changed: 0 });
  expect(Object.values(run.body.entries)).toEqual([
    { change: "verified", outcome: "refreshed" },
    { change: "verified", outcome: "refreshed" },
  ]);
  expect(readUris(fetch)).toHaveLength(2);

  // A modification WordPress makes after the last read is read again, as a change.
  tick();
  missing.get("/clash-07/")!.modified = Date.now();
  tick();
  fetch = wordpress({ routes });
  run = await event("reconcile");
  expect(run.body).toMatchObject({ status: "reconciled", pending: 0 });
  expect(run.body.entries["/clash-07/"]).toMatchObject({ change: "changed" });
  expect(
    Object.entries(run.body.entries)
      .filter(([route]) => route !== "/clash-07/")
      .map(([, outcome]) => (outcome as { change: string }).change),
  ).toEqual(["verified", "verified"]);
  expect(readUris(fetch)).toContain("/clash-07/");
});

test("a missing route modified since is read again until a read succeeds", async () => {
  entries.clear();
  const routes: Handler = () =>
    listing({ uri: "/clash/", id: "clash", modifiedGmt: gmt(Date.now() - 60 * 60000) });
  wordpress({ routes });
  expect((await event("reconcile")).body.status).toBe("reconciled");

  // WordPress modifies it, and the read after that fails.
  pastMargin();
  const modifiedAgain = Date.now();
  const later: Handler = () =>
    listing({ uri: "/clash/", id: "clash", modifiedGmt: gmt(modifiedAgain) });
  pastMargin();
  wordpress({ routes: later, entry: () => ({ ok: false, status: 502 }) });
  expect((await event("reconcile")).body).toMatchObject({
    status: "failed",
    entries: { "/clash/": { outcome: "kept" } },
  });
  // Long after the failed attempt (which a check by attempt time would take as
  // settled), the read that stored it still started before the modification.
  pastMargin();
  const fetch = wordpress({ routes: later });
  expect((await event("reconcile")).body).toMatchObject({
    status: "reconciled",
    entries: { "/clash/": { change: "changed", outcome: "refreshed" } },
  });
  expect(readUris(fetch)).toContain("/clash/");
});

test("a missing route whose entry WordPress lists without a modification time stays a change", async () => {
  entries.clear();
  const routes: Handler = () => listing({ uri: "/clash/", id: "clash", modifiedGmt: null });
  wordpress({ routes });
  expect((await event("reconcile")).body.entries).toMatchObject({ "/clash/": { change: "new" } });
  for (let n = 0; n < 2; n++) {
    pastMargin();
    const fetch = wordpress({ routes });
    expect((await event("reconcile")).body.entries).toMatchObject({
      "/clash/": { change: "changed" },
    });
    expect(readUris(fetch)).toEqual(["/clash/"]);
  }
});

test("a missing route whose entry is stored published at another route stays a move", async () => {
  entries.clear();
  entries.set("/old/", {
    id: "moving",
    content: "<p>Moving</p>",
    modified: Date.now() - 60 * 60000,
  });
  wordpress();
  expect((await event("reconcile")).body.entries).toMatchObject({ "/old/": { change: "new" } });

  // WordPress lists it at /new/, which reads as missing; /old/ still reads it.
  const routes: Handler = () =>
    listing({ uri: "/new/", id: "moving", modifiedGmt: gmt(entries.get("/old/")!.modified) });
  for (let n = 0; n < 2; n++) {
    pastMargin();
    const fetch = wordpress({ routes });
    const run = await event("reconcile");
    expect(run.body.entries).toMatchObject({ "/new/": { change: "moved" } });
    expect(readUris(fetch)).toEqual(expect.arrayContaining(["/new/", "/old/"]));
  }
  expect((await event("check")).body).toMatchObject({
    store: { entries: { missing: 1 } },
  });
});

test("an unmodified route settled missing is found once its address is freed", async () => {
  entries.clear();
  const old = Date.now() - 60 * 60000;
  for (let n = 0; n < 5; n++) {
    entries.set(`/page-${n}/`, { id: `page-${n}`, content: "<p>Page</p>", modified: old });
  }
  const routes: Handler = () =>
    listing(
      ...[...entries, ["/biblioteca/", { id: "biblioteca", modified: old }] as const].map(
        ([uri, e]) => ({ uri, id: e.id, modifiedGmt: gmt(e.modified) }),
      ),
    );
  // An archive claims /biblioteca/: its Page reads as missing.
  wordpress({ routes });
  await event("reconcile");
  expect((await api.publishedEntry("/biblioteca/")).kind).toBe("missing");
  pastMargin();
  wordpress({ routes });
  expect((await event("reconcile")).body).toMatchObject({ status: "reconciled", pending: 0 });

  // The archive gives up its address without the Page being modified.
  const page = { id: "biblioteca", content: "<p>Library</p>", modified: old };
  const freed: Handler = (variables) =>
    variables.uri === "/biblioteca/"
      ? data({
          pageBy: {
            id: page.id,
            title: "Library",
            content: page.content,
            uri: "/biblioteca/",
            modifiedGmt: gmt(page.modified),
            status: "publish",
            isRestricted: false,
            featuredImage: null,
            language: { slug: "pt" },
            translations: [],
          },
          postBy: null,
          designTokens: { colors: [], spacingSizes: [] },
        })
      : handlers.entry(variables);
  // Six stored entries, two re-read per run: every one is re-read within three runs.
  const changes: string[] = [];
  for (let n = 0; n < 4 && (await api.publishedEntry("/biblioteca/")).kind !== "found"; n++) {
    tick();
    wordpress({ routes, entry: freed });
    const run = await event("reconcile");
    expect(run.body).toMatchObject({ status: "reconciled", pending: 0 });
    if (run.body.entries["/biblioteca/"]) changes.push(run.body.entries["/biblioteca/"].change);
  }
  expect(changes).toEqual(["verified"]);
  expect(await content("/biblioteca/")).toContain("Library");
});

test("a missing route modified within the clock margin of its read isn't settled", async () => {
  entries.clear();
  // The read starts at 09:00:00.400 on the Frontend's clock.
  vi.setSystemTime(new Date("2026-10-02T09:00:00.400Z"));
  let modified = Date.now() - 60 * 60000;
  const routes: Handler = () =>
    listing({ uri: "/clash/", id: "clash", modifiedGmt: gmt(modified) });
  wordpress({ routes });
  await event("reconcile");

  // WordPress modifies it at .900, which it lists to the second (09:00:00).
  modified = new Date("2026-10-02T09:00:00.900Z").getTime();
  tick();
  let fetch = wordpress({ routes });
  expect((await event("reconcile")).body.entries).toMatchObject({
    "/clash/": { change: "changed" },
  });
  expect(readUris(fetch)).toEqual(["/clash/"]);

  // A read that started more than the margin after the modification settles it.
  pastMargin();
  wordpress({ routes });
  await event("reconcile");
  tick();
  fetch = wordpress({ routes });
  const run = await event("reconcile");
  expect(run.body.entries["/clash/"]?.change ?? "settled").not.toBe("changed");
});
