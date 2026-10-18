// Source withdrawals.test.ts projected onto package handlers and public delivery DTOs.
// SQL introspection and Site presentation stay outside this seam.
import { createContentRuntime } from "@getquick/content/server";
import { responseStatus } from "@getquick/content";
import type { ContentBindings } from "@getquick/content/server";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";
import {
  data,
  queries,
  routes,
  stubWordPress,
  type Answer,
  type Handler,
} from "./support/wordpress-stub";

const runtime: { env: ContentBindings } = { env: {} };
const api = () =>
  createContentRuntime({
    site: SITE,
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings: () => runtime.env,
  });

const SITE = "Acme / publicação";
const TOKEN = "acme-refresh-token-0123456789abcdef0123456789";
const SECRET = "acme-event-signing-key-0123456789abcdef0123456";
const FRONT_PAGE = "page-2";

interface Entry {
  id: string;
  title: string;
  content: string;
}

// What WordPress returns, by URI, to an anonymous reader. Tests keep an entry
// here after withdrawing it to stand for a CMS (or a cache in front of it)
// that still returns it.
let published: Map<string, Entry>;
let heading: string;
// Where WordPress's permalinks point. A GETQUICK CMS points them at the
// Frontend, and WPGraphQL then gives every entry's uri as an absolute URL.
let permalinkOrigin: string | null;

/** An entry's uri as WordPress gives it. */
const cmsUri = (path: string) => (permalinkOrigin ? new URL(path, permalinkOrigin).href : path);

const unreachable = () => Promise.reject(new TypeError("fetch failed"));
const presets = { colors: [], spacingSizes: [] };

function entryAnswer({ uri }: Record<string, unknown>) {
  const path = decodeURI(String(uri));
  const entry = published.get(path);
  return data({
    postBy: null,
    pageBy: entry
      ? {
          id: entry.id,
          title: entry.title,
          content: entry.content,
          uri: cmsUri(path),
          status: "publish",
          isRestricted: false,
          featuredImage: null,
        }
      : null,
    designTokens: presets,
  });
}

function homeAnswer() {
  return data({
    generalSettings: { title: "Acme", description: "Things" },
    nodeByUri: {
      __typename: "Page",
      id: FRONT_PAGE,
      isFrontPage: true,
      title: "Home",
      content: `<h1>${heading}</h1>`,
    },
    designTokens: presets,
  });
}

function wordpress(handlers: { entry?: Handler; home?: Handler } = {}) {
  return stubWordPress({
    home: homeAnswer,
    entry: entryAnswer,
    routes: () => routes("/", ...[...published.keys()].map(cmsUri)),
    ...handlers,
  });
}

function cmsDown() {
  return stubWordPress({
    home: unreachable,
    entry: unreachable,
    chrome: unreachable,
    routes: unreachable,
  });
}

/** A CMS read held until the test lets it answer, with what it read when it was asked. */
function heldReads(read: Handler) {
  let release!: () => void;
  const released = new Promise<void>((resolve) => {
    release = resolve;
  });
  const handler: Handler = async (variables) => {
    const answer: Answer = await read(variables);
    await released;
    return answer;
  };
  return { handler, release };
}

/** Lets the clock move on, so what follows happens strictly later. */
const later = () => new Promise((resolve) => setTimeout(resolve, 5));

let directory: string;
let db: TestD1;

function bind(database: TestD1, env: Record<string, unknown> = {}) {
  db = database;
  runtime.env = {
    PUBLICATION_DB: database,
    FRONTEND_REFRESH_TOKEN: TOKEN,
    PUBLICATION_EVENT_SECRET: SECRET,
    ...env,
  };
}

function restart() {
  db.close();
  bind(openTestD1(join(directory, "publications.sqlite")));
}

beforeEach(() => {
  published = new Map([
    ["/about/", { id: "page-64", title: "About", content: "<p>Version 1.</p>" }],
    ["/contact/", { id: "page-70", title: "Contact", content: "<p>Write to us.</p>" }],
  ]);
  heading = "Welcome";
  permalinkOrigin = null;
  directory = mkdtempSync(join(tmpdir(), "acme-withdrawals-"));
  bind(openTestD1(join(directory, "publications.sqlite")));
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});

afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

async function visit(path: string) {
  const result = path === "/" ? await api().publishedHome() : await api().publishedEntry(path);
  return {
    kind: result.kind,
    status: result.kind === "moved" ? undefined : responseStatus(result),
    location: result.kind === "moved" ? result.uri : null,
    content:
      result.kind === "found"
        ? "entry" in result.content
          ? result.content.entry.content
          : result.content.home.page.content
        : "",
  };
}

async function endpoint(path: string, init: RequestInit) {
  const response = await (path === "/gq/events" ? api().handleEvent : api().handleRefresh)(
    new Request(`https://acme.example${path}`, init),
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return { status: response.status, body: await response.json() };
}

function refresh(body: unknown = {}) {
  return endpoint("/gq/refresh", {
    method: "POST",
    headers: { Authorization: `Bearer ${TOKEN}` },
    body: JSON.stringify(body),
  });
}

/** A publication event, as the Site's CMS sends it. */
function publication(uri: string, overrides: Record<string, unknown> = {}) {
  return {
    site: SITE,
    id: randomUUID(),
    action: "publish",
    occurredAt: Date.now(),
    entry: { id: published.get(uri)?.id ?? (uri === "/" ? FRONT_PAGE : "page-99"), uri },
    ...overrides,
  };
}

/** A withdraw event: the entry at uri was unpublished, trashed or deleted. */
function withdrawal(uri: string, overrides: Record<string, unknown> = {}) {
  return {
    site: SITE,
    id: randomUUID(),
    action: "withdraw",
    occurredAt: Date.now(),
    entry: { id: published.get(uri)?.id ?? (uri === "/" ? FRONT_PAGE : "page-99"), uri },
    ...overrides,
  };
}

function signature(body: string, timestamp: number, secret = SECRET) {
  return `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`;
}

/** Delivers an event the way the CMS does: its body signed with the Site's event secret. */
async function deliver(
  event: unknown,
  { secret = SECRET, headers }: { secret?: string; headers?: Record<string, string> } = {},
) {
  const body = typeof event === "string" ? event : JSON.stringify(event);
  const timestamp = Math.floor(Date.now() / 1000);
  return endpoint("/gq/events", {
    method: "POST",
    headers: headers ?? {
      "Content-Type": "application/json",
      "GQ-Event-Timestamp": String(timestamp),
      "GQ-Event-Signature": signature(body, timestamp, secret),
    },
    body,
  });
}

async function prepare() {
  wordpress();
  const { status } = await refresh();
  expect(status).toBe(200);
  await later();
}

test("a withdrawn entry is a 404 at once, without a CMS read, and through an outage", async () => {
  await prepare();
  // WordPress, or a cache in front of it, still returns the entry.
  const fetchMock = wordpress();

  const event = withdrawal("/about/");
  const { status, body } = await deliver(event);
  const visited = await visit("/about/");
  cmsDown();
  const duringOutage = await visit("/about/");

  expect(status).toBe(200);
  expect(body).toEqual({ event: event.id, status: "withdrawn", withdrawn: ["/about/"] });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(visited.status).toBe(404);
  expect(visited.content).not.toContain("Version 1.");
  expect(duringOutage.status).toBe(404);
  expect(duringOutage.content).not.toContain("Version 1.");
  // Nothing of the withdrawn entry stays in public state or the logs.
  const logged = JSON.stringify([
    ...vi.mocked(console.info).mock.calls,
    ...vi.mocked(console.error).mock.calls,
  ]);
  expect(logged).toContain(event.id);
  expect(logged).not.toContain("Version 1.");
  expect(logged).not.toContain(SECRET);
});

test("the other entries and the homepage are still served after a withdrawal", async () => {
  await prepare();
  wordpress();

  await deliver(withdrawal("/about/"));
  cmsDown();

  const contact = await visit("/contact/");
  const home = await visit("/");
  expect(contact.status).toBe(200);
  expect(contact.content).toContain("Write to us.");
  expect(home.status).toBe(200);
  expect(home.content).toContain("Welcome");
});

test("a withdrawal survives a database reopen, and no fallback, refresh or cold lookup brings it back", async () => {
  await prepare();
  wordpress();
  await deliver(withdrawal("/about/"));

  restart();
  const fetchMock = wordpress();
  const afterRestart = await visit("/about/");
  const whole = await refresh();
  const targeted = await refresh({ uris: ["/about/"] });
  const visited = await visit("/about/");

  expect(afterRestart.status).toBe(404);
  expect(whole.status).toBe(200);
  expect(whole.body.entries["/about/"]).toEqual({ outcome: "withdrawn" });
  expect(whole.body.entries["/contact/"]).toMatchObject({ outcome: "promoted" });
  expect(targeted.body.entries["/about/"]).toEqual({ outcome: "withdrawn" });
  expect(visited.status).toBe(404);
  expect(visited.content).not.toContain("Version 1.");
  // Only the two refreshes read it; a visit to a withdrawn route never does.
  const aboutReads = queries(fetchMock, "EntryByUri").filter(([, init]) =>
    (init.body as string).includes('"uri":"/about/"'),
  );
  expect(aboutReads).toHaveLength(2);
});

test("an entry withdrawn before the store held it can't come back through a cold lookup", async () => {
  await prepare();
  wordpress();
  const event = withdrawal("/news/", { entry: { id: "page-80", uri: "/news/" } });
  const { body } = await deliver(event);
  published.set("/news/", { id: "page-80", title: "News", content: "<p>Unpublished.</p>" });
  const fetchMock = wordpress();

  const visited = await visit("/news/");

  expect(body).toEqual({ event: event.id, status: "withdrawn", withdrawn: ["/news/"] });
  expect(visited.status).toBe(404);
  expect(queries(fetchMock, "EntryByUri")).toHaveLength(0);
});

test("a delayed publication older than the withdrawal is superseded, never processed", async () => {
  await prepare();
  const delayed = publication("/about/", { occurredAt: Date.now() - 60_000 });
  wordpress();
  const event = withdrawal("/about/");
  await deliver(event);
  const fetchMock = wordpress();

  const { status, body } = await deliver(delayed);
  const visited = await visit("/about/");

  expect(status).toBe(200);
  expect(body).toEqual({ event: delayed.id, status: "superseded", by: event.id });
  expect(fetchMock).not.toHaveBeenCalled();
  expect(visited.status).toBe(404);
});

test("a duplicate withdrawal is recognised, also after a restart", async () => {
  await prepare();
  wordpress();
  const event = withdrawal("/about/");
  await deliver(event);
  restart();
  const fetchMock = wordpress();

  const { status, body } = await deliver(event);

  expect(status).toBe(200);
  expect(body).toEqual({ event: event.id, status: "refreshed", duplicate: true });
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await visit("/about/")).status).toBe(404);
});

test.each<[string, () => Promise<{ status: number; body: Record<string, unknown> }>]>([
  [
    "a publication event's refresh",
    () => deliver(publication("/about/", { occurredAt: Date.now() - 1000 })),
  ],
  ["an operator's whole-Site refresh", () => refresh()],
  ["an operator's targeted refresh", () => refresh({ uris: ["/about/"] })],
])("%s that read the entry before its withdrawal can't restore it", async (_case, start) => {
  await prepare();
  published.get("/about/")!.content = "<p>Version 2.</p>";
  const held = heldReads(entryAnswer);
  const fetchMock = wordpress({ entry: held.handler });

  const inFlight = start();
  await vi.waitFor(() => expect(queries(fetchMock, "EntryByUri").length).toBeGreaterThan(0));
  await deliver(withdrawal("/about/"));
  held.release();
  const { body } = await inFlight;
  const visited = await visit("/about/");

  expect((body.entries as Record<string, unknown>)["/about/"]).toEqual({ outcome: "withdrawn" });
  expect(visited.status).toBe(404);
  expect(visited.content).not.toContain("Version");
});

test("a cold lookup in flight when the entry is withdrawn serves a 404, and stores nothing", async () => {
  await prepare();
  published.set("/news/", { id: "page-80", title: "News", content: "<p>We launched.</p>" });
  const held = heldReads(entryAnswer);
  const fetchMock = wordpress({ entry: held.handler });

  const lookup = visit("/news/");
  await vi.waitFor(() => expect(queries(fetchMock, "EntryByUri")).toHaveLength(1));
  await deliver(withdrawal("/news/"));
  held.release();
  const visited = await lookup;
  const again = await visit("/news/");

  expect(visited.status).toBe(404);
  expect(visited.content).not.toContain("We launched.");
  expect(again.status).toBe(404);
});

test("a republication after the withdrawal makes the entry public again, through a later outage", async () => {
  await prepare();
  wordpress();
  await deliver(withdrawal("/about/"));
  await later();
  published.get("/about/")!.content = "<p>Republished.</p>";
  wordpress();

  const event = publication("/about/");
  const { status, body } = await deliver(event);
  cmsDown();
  const visited = await visit("/about/");

  expect(status).toBe(200);
  expect(body).toMatchObject({
    status: "refreshed",
    entries: { "/about/": { outcome: "promoted", state: "published" } },
  });
  expect(visited.status).toBe(200);
  expect(visited.content).toContain("Republished.");
});

test("a republication whose refresh fails lifts the withdrawal, and its retry restores the entry", async () => {
  await prepare();
  wordpress();
  await deliver(withdrawal("/about/"));
  await later();
  published.get("/about/")!.content = "<p>Republished.</p>";
  cmsDown();
  const event = publication("/about/");

  const failed = await deliver(event);
  const meanwhile = await visit("/about/");
  wordpress();
  const retried = await deliver(event);
  const visited = await visit("/about/");

  expect(failed.status).toBe(503);
  expect(meanwhile.status).toBe(404);
  expect(retried.status).toBe(200);
  expect(visited.status).toBe(200);
  expect(visited.content).toContain("Republished.");
});

test("a delayed withdrawal older than an accepted republication changes nothing", async () => {
  await prepare();
  const delayed = withdrawal("/about/", { occurredAt: Date.now() - 60_000 });
  published.get("/about/")!.content = "<p>Version 2.</p>";
  wordpress();
  const republished = publication("/about/");
  await deliver(republished);

  const { status, body } = await deliver(delayed);
  cmsDown();
  const visited = await visit("/about/");

  expect(status).toBe(200);
  expect(body).toEqual({
    event: delayed.id,
    status: "superseded",
    withdrawn: [],
    by: republished.id,
  });
  expect(visited.status).toBe(200);
  expect(visited.content).toContain("Version 2.");
});

test("a delayed withdrawal older than a republication whose refresh failed changes nothing", async () => {
  await prepare();
  const delayed = withdrawal("/about/", { occurredAt: Date.now() - 60_000 });
  cmsDown();
  await deliver(publication("/about/"));

  const { body } = await deliver(delayed);

  expect(body.status).toBe("superseded");
  expect((await visit("/about/")).status).toBe(200);
});

test("publication, withdrawal and republication delivered in any order end as the latest says", async () => {
  await prepare();
  const now = Date.now();
  const first = publication("/about/", { occurredAt: now - 3000 });
  const withdrawn = withdrawal("/about/", { occurredAt: now - 2000 });
  const republished = publication("/about/", { occurredAt: now - 1000 });
  published.get("/about/")!.content = "<p>Version 3.</p>";
  wordpress();

  // The republication arrives first, the withdrawal it follows last.
  await deliver(republished);
  await later();
  const older = await deliver(first);
  const stale = await deliver(withdrawn);
  cmsDown();
  const visited = await visit("/about/");

  expect(older.body.status).toBe("superseded");
  expect(stale.body.status).toBe("superseded");
  expect(visited.status).toBe(200);
  expect(visited.content).toContain("Version 3.");
});

test("withdrawing again after a republication withdraws it again", async () => {
  await prepare();
  const now = Date.now();
  wordpress();
  await deliver(withdrawal("/about/", { occurredAt: now - 2000 }));
  await later();
  await deliver(publication("/about/", { occurredAt: now - 1000 }));
  await later();
  expect((await visit("/about/")).status).toBe(200);

  const { body } = await deliver(withdrawal("/about/", { occurredAt: now }));
  wordpress();
  const visited = await visit("/about/");

  expect(body.status).toBe("withdrawn");
  expect(visited.status).toBe(404);
});

test("a moved entry is withdrawn at its old route too, which stops redirecting to it", async () => {
  await prepare();
  const about = published.get("/about/")!;
  published.delete("/about/");
  published.set("/about-us/", { ...about, content: "<p>Moved.</p>" });
  wordpress();
  await deliver(
    publication("/about-us/", {
      entry: { id: about.id, uri: "/about-us/", previousUri: "/about/" },
    }),
  );
  expect((await visit("/about/")).kind).toBe("moved");
  await later();

  const { body } = await deliver(withdrawal("/about-us/"));
  cmsDown();
  const oldRoute = await visit("/about/");
  const newRoute = await visit("/about-us/");
  const contact = await visit("/contact/");

  expect(body.withdrawn).toEqual(["/about-us/", "/about/"]);
  expect(oldRoute.status).toBe(404);
  expect(oldRoute.location).toBeNull();
  expect(newRoute.status).toBe(404);
  expect(newRoute.content).not.toContain("Moved.");
  expect(contact.status).toBe(200);
});

test("on a CMS that gives absolute URIs, a moved entry is withdrawn at both paths and republished at its own", async () => {
  permalinkOrigin = "https://acme-fe.example";
  await prepare();
  const about = published.get("/about/")!;
  published.delete("/about/");
  published.set("/about-us/", { ...about, content: "<p>Moved.</p>" });
  wordpress();
  await deliver(
    publication("/about-us/", {
      entry: { id: about.id, uri: "/about-us/", previousUri: "/about/" },
    }),
  );
  expect((await visit("/about/")).location).toBe("/about-us/");
  await later();

  const { body: withdrawn } = await deliver(withdrawal("/about-us/"));
  const afterWithdrawal = await visit("/about-us/");
  await later();
  const { body: republished } = await deliver(publication("/about-us/"));
  cmsDown();
  const newRoute = await visit("/about-us/");

  expect(withdrawn.withdrawn).toEqual(["/about-us/", "/about/"]);
  expect(afterWithdrawal.status).toBe(404);
  expect(republished).toMatchObject({
    status: "refreshed",
    entries: { "/about-us/": { outcome: "promoted", state: "published" } },
    moved: {},
  });
  expect(newRoute.status).toBe(200);
  expect(newRoute.content).toContain("Moved.");
});

test("an entry whose move never reached the store is withdrawn where it is stored", async () => {
  await prepare();
  wordpress();

  // WordPress renamed /about/ to /about-us/ and then withdrew it; the Frontend
  // only ever stored /about/.
  const { body } = await deliver(
    withdrawal("/about-us/", { entry: { id: "page-64", uri: "/about-us/" } }),
  );
  cmsDown();

  expect(body.withdrawn).toEqual(["/about-us/", "/about/"]);
  expect((await visit("/about/")).status).toBe(404);
  expect((await visit("/about-us/")).status).toBe(404);
});

test("a withdrawal for a URI another entry holds now leaves that entry alone", async () => {
  await prepare();
  wordpress();

  // An older page that had /about/ before page-64 took it.
  const { body } = await deliver(
    withdrawal("/about/", { entry: { id: "page-12", uri: "/about/" } }),
  );
  cmsDown();
  const visited = await visit("/about/");

  expect(body.withdrawn).toEqual([]);
  expect(visited.status).toBe(200);
  expect(visited.content).toContain("Version 1.");
});

test("a withdrawn front page is a 404 until a later republication", async () => {
  await prepare();
  wordpress();

  const { body } = await deliver(withdrawal("/"));
  const withdrawn = await visit("/");
  const refreshed = await refresh();
  const afterRefresh = await visit("/");
  await later();
  heading = "Back again";
  wordpress();
  await deliver(publication("/"));
  cmsDown();
  const republished = await visit("/");

  expect(body).toMatchObject({ status: "withdrawn", withdrawn: ["/"] });
  expect(withdrawn.status).toBe(404);
  expect(withdrawn.content).not.toContain("Welcome");
  expect(refreshed.body.home).toEqual({ outcome: "withdrawn" });
  expect(afterRefresh.status).toBe(404);
  expect(republished.status).toBe(200);
  expect(republished.content).toContain("Back again");
});

test("a settings event for the site's identity doesn't restore a withdrawn front page", async () => {
  await prepare();
  wordpress();
  await deliver(withdrawal("/"));
  await later();
  heading = "Still cached";
  wordpress();

  const { status, body } = await deliver({
    site: SITE,
    id: randomUUID(),
    action: "settings",
    occurredAt: Date.now(),
    setting: "identity",
  });
  const home = await visit("/");
  const entry = await visit("/about/");

  expect(status).toBe(200);
  expect(body.home).toEqual({ outcome: "withdrawn" });
  expect(home.status).toBe(404);
  expect(home.content).not.toContain("Still cached");
  expect(entry.status).toBe(200);
});

const now = () => Math.floor(Date.now() / 1000);

test.each<[string, () => Promise<{ status: number; body: Record<string, unknown> }>, number]>([
  [
    "without a signature",
    () => deliver(withdrawal("/about/"), { headers: { "Content-Type": "application/json" } }),
    401,
  ],
  [
    "signed with another key",
    () => deliver(withdrawal("/about/"), { secret: "x".repeat(40) }),
    401,
  ],
  [
    "with the refresh token as a bearer token",
    () =>
      deliver(withdrawal("/about/"), {
        headers: { "Content-Type": "application/json", Authorization: `Bearer ${TOKEN}` },
      }),
    401,
  ],
  [
    "replayed after five minutes",
    () => {
      const body = JSON.stringify(withdrawal("/about/"));
      const timestamp = now() - 6 * 60;
      return deliver(body, {
        headers: {
          "GQ-Event-Timestamp": String(timestamp),
          "GQ-Event-Signature": signature(body, timestamp),
        },
      });
    },
    401,
  ],
  ["for another Site", () => deliver({ ...withdrawal("/about/"), site: "other-site" }), 403],
  ["without its entry", () => deliver({ ...withdrawal("/about/"), entry: undefined }), 400],
  [
    "with a URL for a URI",
    () =>
      deliver(withdrawal("/about/", { entry: { id: "page-64", uri: "https://evil.example/" } })),
    400,
  ],
  [
    "with content in it",
    () => deliver({ ...withdrawal("/about/"), content: "<p>Injected.</p>" }),
    400,
  ],
])("a withdrawal %s is refused and changes nothing", async (_case, send, expected) => {
  await prepare();
  const fetchMock = wordpress();

  const { status, body } = await send();

  expect(status).toBe(expected);
  expect(JSON.stringify(body)).not.toContain(SECRET);
  expect(fetchMock).not.toHaveBeenCalled();
  expect((await visit("/about/")).status).toBe(200);
});

test("one Site's withdrawal doesn't reach another Site", async () => {
  await prepare();
  const ours = db;
  bind(openTestD1(join(directory, "other-site.sqlite")), {
    PUBLICATION_EVENT_SECRET: "other-site-event-signing-key-0123456789abcdef",
  });
  const refused = await deliver(withdrawal("/about/"));
  db.close();
  bind(ours);

  expect(refused.status).toBe(401);
  wordpress();
  expect((await visit("/about/")).status).toBe(200);
});

test("a withdrawal the store can't record is a 503, and its redelivery withdraws the entry", async () => {
  await prepare();
  wordpress();
  const event = withdrawal("/about/");
  db.unavailable = true;

  const failed = await deliver(event);
  db.unavailable = false;
  const meanwhile = await visit("/about/");
  const redelivered = await deliver(event);

  expect(failed.status).toBe(503);
  expect(meanwhile.status).toBe(200);
  expect(redelivered.status).toBe(200);
  expect(redelivered.body.status).toBe("withdrawn");
  expect((await visit("/about/")).status).toBe(404);
});
