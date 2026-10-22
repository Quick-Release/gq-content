import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createContentRuntime } from "@getquick/content/server";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";
import {
  data,
  httpError,
  queries,
  routes,
  stubWordPress,
  type Handler,
} from "./support/wordpress-stub";
let db: TestD1;
const token = "refresh-test-token-012345678901234567890123456789";
const api = () =>
  createContentRuntime({
    site: "Acme",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings: () => ({ PUBLICATION_DB: db, FRONTEND_REFRESH_TOKEN: token }),
  });
const refresh = async (body: unknown = {}) => {
  const response = await api().handleRefresh(
    new Request("https://site.test/gq/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    { siteOrigin: "https://site.test" },
  );
  return { status: response.status, report: await response.json() };
};
const presets = { colors: [{ slug: "brand", color: "#c00" }], spacingSizes: [] };
const home = (content = "<h1>Welcome</h1>") =>
  data({
    generalSettings: { title: "Acme", description: "Things" },
    nodeByUri: { __typename: "Page", isFrontPage: true, title: "Home", content },
    designTokens: presets,
  });
const entry = (uri = "/about/", content = "<p>Version 1</p>", id = "page-1") =>
  data({
    pageBy: {
      id,
      uri,
      title: "About",
      content,
      status: "publish",
      isRestricted: false,
      featuredImage: null,
    },
    postBy: null,
    designTokens: presets,
  });
const wordpress = (overrides: Parameters<typeof stubWordPress>[0] = {}) =>
  stubWordPress({
    home: () => home(),
    entry: () => entry(),
    routes: () => routes("/", "/about/"),
    design: () => data({ designTokens: presets }),
    ...overrides,
  });
beforeEach(() => {
  db = openTestD1();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});
test("whole-Site refresh prepares all shared rows and listed entries, then serves through an outage", async () => {
  const fetch = wordpress();
  const prepared = await refresh();
  expect(prepared).toMatchObject({
    status: 200,
    report: {
      ready: true,
      refreshed: true,
      home: { outcome: "promoted", state: "published" },
      chrome: { outcome: "promoted", state: "published" },
      design: { outcome: "promoted", state: "published" },
      routes: { outcome: "listed", count: 2 },
      entries: { "/about/": { outcome: "promoted", state: "published" } },
      moved: {},
    },
  });
  expect(prepared.report.entries["/"]).toBeUndefined();
  fetch.mockImplementation(async () => {
    throw new Error("offline");
  });
  expect(await api().publishedHome()).toMatchObject({
    kind: "found",
    content: {
      home: { page: { content: "<h1>Welcome</h1>" } },
      chrome: { menuItems: [{ label: "About us" }] },
    },
  });
  expect(await api().publishedEntry("/about/")).toMatchObject({
    kind: "found",
    content: { entry: { content: "<p>Version 1</p>", ...presets } },
  });
});
test.each(["home", "entry", "chrome", "design"] as const)(
  "failed %s refresh retains its last-known-good content and promotes independent reads",
  async (part) => {
    wordpress();
    await refresh();
    wordpress({
      home: () => home("<h1>New home</h1>"),
      entry: () => entry("/about/", "<p>New entry</p>"),
      [part]: () => httpError(503),
    });
    const result = await refresh();
    expect(result.status).toBe(503);
    const homeRead = await api().publishedHome(),
      entryRead = await api().publishedEntry("/about/");
    expect(homeRead).toMatchObject({
      kind: "found",
      content: {
        home: { page: { content: part === "home" ? "<h1>Welcome</h1>" : "<h1>New home</h1>" } },
      },
    });
    expect(entryRead).toMatchObject({
      kind: "found",
      content: { entry: { content: part === "entry" ? "<p>Version 1</p>" : "<p>New entry</p>" } },
    });
  },
);
test("failed published-route listing refreshes stored entries and reports incomplete refresh", async () => {
  wordpress();
  await refresh();
  wordpress({ routes: () => httpError(503), entry: () => entry("/about/", "<p>Changed</p>") });
  const result = await refresh();
  expect(result.status).toBe(503);
  expect(result.report.routes).toMatchObject({ outcome: "failed" });
  expect(await api().publishedEntry("/about/")).toMatchObject({
    kind: "found",
    content: { entry: { content: "<p>Changed</p>" } },
  });
});
test("targeted refresh accepts 100 paths, reads no shared rows or listing, and deduplicates normalized routes", async () => {
  const fetch = wordpress({
    entry: (variables) => entry(String(variables.uri), "Target", String(variables.uri)),
  });
  const uris = Array.from({ length: 100 }, (_, index) => `/entry-${index}/`);
  const result = await refresh({ uris });
  expect(result.status).toBe(200);
  expect(Object.keys(result.report.entries)).toHaveLength(100);
  expect(queries(fetch, "EntryByUri")).toHaveLength(100);
  expect(queries(fetch, "HomePage")).toHaveLength(0);
  expect(queries(fetch, "SiteChrome")).toHaveLength(0);
  expect(queries(fetch, "PublishedRoutes")).toHaveLength(0);
  fetch.mockClear();
  expect((await refresh({ uris: ["/entry-0", "/entry-0/"] })).status).toBe(200);
  expect(queries(fetch, "EntryByUri")).toHaveLength(1);
});
test("refresh follows moves in both directions and replaces confirmed missing routes on later publication", async () => {
  wordpress();
  await refresh();
  wordpress({
    entry: (variables) =>
      String(variables.uri) === "/about/"
        ? data({ pageBy: null, postBy: null, designTokens: presets })
        : entry("/new/"),
    routes: () => routes("/", "/new/"),
  });
  expect((await refresh()).report.moved).toEqual({ "/about/": "/new/" });
  expect(await api().publishedEntry("/about/")).toEqual({ kind: "moved", uri: "/new/" });
  wordpress({ entry: () => entry() });
  await refresh({ uris: ["/about/"] });
  expect(await api().publishedEntry("/new/")).toEqual({ kind: "moved", uri: "/about/" });
  wordpress({ entry: () => data({ pageBy: null, postBy: null, designTokens: presets }) });
  await refresh({ uris: ["/about/"] });
  expect((await api().publishedEntry("/about/")).kind).toBe("missing");
  wordpress();
  await refresh({ uris: ["/about/"] });
  expect((await api().publishedEntry("/about/")).kind).toBe("found");
});
test("a partial block recovery is served only from the previous complete publication until a complete refresh succeeds", async () => {
  wordpress();
  await refresh();
  wordpress({
    entry: (variables) =>
      variables.withBlocks === false ? entry("/about/", "<p>Incomplete</p>") : httpError(502),
  });
  const failed = await refresh({ uris: ["/about/"] });
  expect(failed.status).toBe(503);
  expect(failed.report.entries["/about/"]).toMatchObject({
    outcome: "kept",
    failure: { reason: "partial" },
  });
  expect(await api().publishedEntry("/about/")).toMatchObject({
    kind: "found",
    content: { entry: { content: "<p>Version 1</p>" } },
  });
  wordpress({ entry: () => entry("/about/", "<p>Recovered</p>") });
  expect((await refresh({ uris: ["/about/"] })).status).toBe(200);
  expect(await api().publishedEntry("/about/")).toMatchObject({
    kind: "found",
    content: { entry: { content: "<p>Recovered</p>" } },
  });
});
test.each(["whole", "targeted"] as const)(
  "a later %s refresh wins over an older in-flight read",
  async (mode) => {
    wordpress();
    await refresh();
    let release!: () => void, started!: () => void;
    const gate = new Promise<void>((resolve) => {
      release = resolve;
    });
    const waiting = new Promise<void>((resolve) => {
      started = resolve;
    });
    let read = 0;
    const slow: Handler = async (variables) => {
      if (++read === 1) {
        started();
        await gate;
        return mode === "whole"
          ? home("<p>Older</p>")
          : entry(String(variables.uri), "<p>Older</p>");
      }
      return mode === "whole"
        ? home("<p>Latest</p>")
        : entry(String(variables.uri), "<p>Latest</p>");
    };
    wordpress(mode === "whole" ? { home: slow } : { entry: slow });
    vi.useFakeTimers({ toFake: ["Date"] });
    vi.setSystemTime(Date.now() + 1000);
    const body = mode === "whole" ? {} : { uris: ["/about/"] };
    const older = refresh(body);
    await waiting;
    vi.setSystemTime(Date.now() + 1000);
    const newer = await refresh(body);
    release();
    const late = await older;
    const outcome = (report: typeof newer.report) =>
      mode === "whole" ? report.home : report.entries["/about/"];
    expect(outcome(newer.report)).toMatchObject({ outcome: "promoted" });
    expect(outcome(late.report)).toMatchObject({ outcome: "superseded" });
    const result =
      mode === "whole" ? await api().publishedHome() : await api().publishedEntry("/about/");
    expect(JSON.stringify(result)).toContain("Latest");
    expect(JSON.stringify(result)).not.toContain("Older");
  },
);
test("failed store writes preserve stored content and return an operator failure report", async () => {
  wordpress();
  await refresh();
  wordpress({ home: () => home("<h1>Changed</h1>") });
  db.unavailable = true;
  const result = await refresh();
  db.unavailable = false;
  expect(result).toMatchObject({
    status: 503,
    report: { ready: false, home: { outcome: "kept", failure: { reason: "store" } } },
  });
  expect(await api().publishedHome()).toMatchObject({
    kind: "found",
    content: { home: { page: { content: "<h1>Welcome</h1>" } } },
  });
});

test("first refresh with failed chrome is not ready; confirmed absent front page becomes missing", async () => {
  wordpress({ chrome: () => httpError(503) });
  expect(await refresh()).toMatchObject({
    status: 503,
    report: { ready: false, chrome: { outcome: "kept" } },
  });
  wordpress({
    home: () =>
      data({
        generalSettings: { title: "Acme", description: "" },
        nodeByUri: { __typename: "Page", isFrontPage: false, title: "Blog", content: "" },
        designTokens: presets,
      }),
  });
  expect(await refresh()).toMatchObject({
    status: 200,
    report: { ready: true, home: { outcome: "promoted", state: "missing" } },
  });
  expect((await api().publishedHome()).kind).toBe("missing");
});
test("shared chrome and design refresh reaches every stored entry without republishing", async () => {
  wordpress();
  await refresh();
  const changed = { colors: [{ slug: "brand", color: "#00c" }], spacingSizes: [] };
  wordpress({
    design: () => data({ designTokens: changed }),
    chrome: () =>
      data({
        generalSettings: { siteIcon: null, siteLogo: null },
        menuItems: {
          nodes: [{ id: "new", parentId: null, label: "Contact", url: "/contact/", target: null }],
        },
        header: null,
        footer: null,
      }),
  });
  expect((await refresh()).status).toBe(200);
  expect(await api().publishedHome()).toMatchObject({
    kind: "found",
    content: { home: changed, chrome: { menuItems: [{ label: "Contact" }] } },
  });
  expect(await api().publishedEntry("/about/")).toMatchObject({
    kind: "found",
    content: { entry: changed, chrome: { menuItems: [{ label: "Contact" }] } },
  });
});
test("whole refresh normalizes absolute and percent-encoded CMS routes and carries no operator credentials to CMS", async () => {
  const fetch = wordpress({
    routes: () => routes("/", "https://site.test/caf%C3%A9/"),
    entry: () => entry("https://site.test/caf%C3%A9/"),
  });
  const result = await refresh();
  expect(result).toMatchObject({
    status: 200,
    report: { entries: { "/café/": { outcome: "promoted", state: "published" } }, moved: {} },
  });
  expect((await api().publishedEntry("/caf%c3%a9")).kind).toBe("found");
  for (const [, init] of fetch.mock.calls) {
    const headers = new Headers(init.headers);
    expect(headers.get("Authorization")).toBeNull();
    expect(headers.get("Cookie")).toBeNull();
  }
});
