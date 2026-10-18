// Source retries.test.ts projected onto public handlers/delivery, with real SQLite persistence.
import { createContentRuntime } from "@getquick/content/server";
import { createHmac, randomUUID } from "node:crypto";
import { mkdtempSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";
import { chrome, data, routes, stubWordPress } from "./support/wordpress-stub";
const SECRET = "retry-event-key-0123456789abcdef0123456789";
const TOKEN = "retry-refresh-key-0123456789abcdef0123456789";
let db: TestD1;
let directory: string;
let api: ReturnType<typeof createContentRuntime>;
let content: string;
let menu: string;
const configure = () =>
  createContentRuntime({
    site: "Retry",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings: () => ({
      PUBLICATION_DB: db,
      PUBLICATION_EVENT_SECRET: SECRET,
      FRONTEND_REFRESH_TOKEN: TOKEN,
    }),
  });
function wordpress(offline = false) {
  const fail = () => {
    throw new TypeError("CMS unreachable");
  };
  return stubWordPress({
    home: offline
      ? fail
      : () =>
          data({
            generalSettings: { title: "Retry", description: "Proof" },
            nodeByUri: {
              __typename: "Page",
              isFrontPage: true,
              title: "Home",
              content: "<p>Home</p>",
            },
            designTokens: { colors: [], spacingSizes: [] },
          }),
    entry: offline
      ? fail
      : () =>
          data({
            pageBy: {
              id: "page-64",
              title: "About",
              content,
              uri: "/about/",
              status: "publish",
              isRestricted: false,
              featuredImage: null,
            },
            postBy: null,
            designTokens: { colors: [], spacingSizes: [] },
          }),
    chrome: offline
      ? fail
      : () =>
          data({
            ...chrome,
            menuItems: {
              nodes: [{ id: "a", parentId: null, label: menu, url: "/about/", target: null }],
            },
          }),
    design: offline ? fail : () => data({ designTokens: { colors: [], spacingSizes: [] } }),
    routes: offline ? fail : () => routes("/", "/about/"),
  });
}
function event(setting?: string) {
  return {
    site: "Retry",
    id: randomUUID(),
    occurredAt: Date.now(),
    ...(setting
      ? { action: "settings", setting }
      : { action: "publish", entry: { id: "page-64", uri: "/about/" } }),
  };
}
function signed(value: unknown) {
  const body = JSON.stringify(value),
    timestamp = String(Math.floor(Date.now() / 1000));
  return new Request("https://site.test/gq/events", {
    method: "POST",
    body,
    headers: {
      "GQ-Event-Timestamp": timestamp,
      "GQ-Event-Signature":
        "v1=" +
        createHmac("sha256", SECRET)
          .update(timestamp + "." + body)
          .digest("hex"),
    },
  });
}
async function deliver(value: unknown) {
  const response = await api.handleEvent(signed(value));
  return { status: response.status, body: await response.json() };
}
const after = (minutes: number) => vi.setSystemTime(Date.now() + minutes * 60000);
async function prepare() {
  wordpress();
  expect(
    (
      await api.handleRefresh(
        new Request("https://site.test/gq/refresh", {
          method: "POST",
          headers: { Authorization: "Bearer " + TOKEN },
          body: "{}",
        }),
      )
    ).status,
  ).toBe(200);
}
async function body() {
  const result = await api.publishedEntry("/about/");
  if (result.kind !== "found") throw new Error("Publication unavailable");
  return result.content.entry.content;
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T09:00:00Z"));
  directory = mkdtempSync(join(tmpdir(), "content-retry-"));
  db = openTestD1(join(directory, "store.sqlite"));
  api = configure();
  content = "<p>Version 1</p>";
  menu = "About us";
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  rmSync(directory, { recursive: true, force: true });
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("publication recovers hours later with same identity and fresh signatures without another publish", async () => {
  await prepare();
  content = "<p>Version 2</p>";
  wordpress(true);
  const value = event();
  expect((await deliver(value)).status).toBe(503);
  for (const minutes of [1, 2, 5, 10, 30, 60, 60, 60]) {
    after(minutes);
    expect((await deliver(value)).status).toBe(503);
  }
  expect(await body()).toBe("<p>Version 1</p>");
  wordpress();
  after(60);
  expect(await deliver(value)).toMatchObject({
    status: 200,
    body: { event: value.id, status: "refreshed" },
  });
  wordpress(true);
  expect(await body()).toBe("<p>Version 2</p>");
  expect((await deliver(value)).body).toMatchObject({ duplicate: true });
});

test("failed shared setting recovers home and entry chrome on retry", async () => {
  await prepare();
  menu = "Contact";
  wordpress(true);
  const value = event("menus");
  expect((await deliver(value)).status).toBe(503);
  expect((await api.pageChrome())?.menuItems[0]?.label).toBe("About us");
  wordpress();
  after(5);
  expect((await deliver(value)).status).toBe(200);
  wordpress(true);
  const home = await api.publishedHome(),
    entry = await api.publishedEntry("/about/");
  expect(home.kind === "found" && home.content.chrome.menuItems[0]?.label).toBe("Contact");
  expect(entry.kind === "found" && entry.content.chrome.menuItems[0]?.label).toBe("Contact");
});

test("failed outcome persistence is completed after reopening store and retrying", async () => {
  await prepare();
  content = "<p>Version 2</p>";
  // Fault at the external database boundary, not a replaced runtime collaborator.
  db.exec(
    "CREATE TRIGGER interrupted_outcome BEFORE UPDATE OF status ON publication_events WHEN NEW.status = 'refreshed' BEGIN SELECT RAISE(FAIL, 'interrupted'); END",
  );
  const value = event();
  expect((await deliver(value)).status).toBe(503);
  db.exec("DROP TRIGGER interrupted_outcome");
  db.close();
  db = openTestD1(join(directory, "store.sqlite"));
  api = configure();
  after(2);
  expect((await deliver(value)).body).toMatchObject({ status: "refreshed" });
  expect(await body()).toBe("<p>Version 2</p>");
});

test("older retry after a newer publication reads nothing and cannot roll it back", async () => {
  await prepare();
  wordpress(true);
  const older = event();
  await deliver(older);
  after(1);
  content = "<p>Version 3</p>";
  wordpress();
  await deliver(event());
  after(1);
  content = "<p>Version 2</p>";
  const fetch = wordpress();
  expect((await deliver(older)).body).toEqual({
    event: older.id,
    status: "superseded",
    duplicate: true,
  });
  expect(fetch).not.toHaveBeenCalled();
  expect(await body()).toBe("<p>Version 3</p>");
});

test("replayed old signature is refused while freshly signed retry succeeds", async () => {
  await prepare();
  wordpress(true);
  const value = event(),
    replay = signed(value);
  await deliver(value);
  wordpress();
  after(10);
  expect((await api.handleEvent(replay)).status).toBe(401);
  expect((await deliver(value)).status).toBe(200);
});
