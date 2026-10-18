import { expect, test, vi } from "vite-plus/test";
import { createContentRuntime } from "@getquick/content/server";

test("public delivery refuses browser access before bindings and transport", async () => {
  const bindings = vi.fn(() => ({}));
  const fetch = vi.fn();
  const runtime = createContentRuntime({
    site: "Acme",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => false,
    bindings,
    fetch,
  });
  expect((await runtime.publishedHome()).kind).toBe("unavailable");
  expect((await runtime.publishedEntry("/about/")).kind).toBe("unavailable");
  expect(await runtime.pageChrome()).toBeNull();
  expect(bindings).not.toHaveBeenCalled();
  expect(fetch).not.toHaveBeenCalled();
});

import { openTestD1 } from "./support/sqlite-d1";

test("stored home and chrome survive missing secrets and CMS outages without an age limit", async () => {
  const db = openTestD1();
  try {
    const home = {
      settings: { title: "Acme", description: "Things" },
      page: { title: "Home", content: "<h1>Welcome</h1>", hasVideoHero: false },
      colors: [],
      spacingSizes: [],
    };
    const chrome = { menuItems: [], siteIcon: null, siteLogo: null };
    for (const [key, body] of [
      ["home", home],
      ["chrome", chrome],
    ] as const) {
      await db
        .prepare(
          "INSERT INTO publications (key,state,format,body,read_started_at,promoted_at) VALUES (?, 'published', 1, ?, 1, 1)",
        )
        .bind(key, JSON.stringify(body))
        .run();
    }
    const fetch = vi.fn(() => {
      throw new Error("CMS offline");
    });
    const runtime = createContentRuntime({
      site: "Acme",
      graphqlEndpoint: "https://cms.test/graphql",
      cmsOrigin: "https://cms.test",
      isServer: () => true,
      bindings: () => ({ PUBLICATION_DB: db }),
      fetch,
    });
    expect(await runtime.publishedHome()).toEqual({
      kind: "found",
      content: { home, chrome, alternates: [] },
    });
    expect(await runtime.pageChrome()).toEqual(chrome);
    expect(fetch).not.toHaveBeenCalled();
  } finally {
    db.close();
  }
});

test("binding failures fail safely without transport or secret disclosure", async () => {
  const fetch = vi.fn();
  const runtime = createContentRuntime({
    site: "Acme",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings: () => {
      throw new Error("private-secret");
    },
    fetch,
  });
  expect(await runtime.publishedHome()).toMatchObject({
    kind: "unavailable",
    failure: { reason: "store" },
  });
  expect(await runtime.publishedEntry("/entry/")).toMatchObject({
    kind: "unavailable",
    failure: { reason: "store" },
  });
  expect(await runtime.pageChrome()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});

import { afterEach, beforeEach } from "vite-plus/test";
import type { ContentConfig } from "@getquick/content/server";
import type { TestD1 } from "./support/sqlite-d1";
import { data, stubWordPress, queries, timeout, httpError } from "./support/wordpress-stub";
import { mkdirSync, mkdtempSync, rmSync } from "node:fs";
import { join } from "node:path";

const home = {
  settings: { title: "Acme", description: "Things" },
  page: { title: "Home", content: "<h1>Welcome</h1>", hasVideoHero: false },
  colors: [],
  spacingSizes: [],
};
const chrome = { menuItems: [], siteIcon: null, siteLogo: null };
const entry = {
  id: "page-1",
  title: "About",
  excerpt: "",
  content: "<h1>About us</h1>",
  uri: "/about/",
  date: "",
  featuredImage: null,
  hasVideoHero: false,
  colors: [],
  spacingSizes: [],
};
let database: TestD1;
const config = (overrides: Partial<ContentConfig> = {}): ContentConfig => ({
  site: "Acme",
  graphqlEndpoint: "https://cms.test/graphql",
  cmsOrigin: "https://cms.test",
  isServer: () => true,
  bindings: () => ({ PUBLICATION_DB: database }),
  ...overrides,
});
const runtime = (overrides: Partial<ContentConfig> = {}) => createContentRuntime(config(overrides));
async function seed(
  key: string,
  body: unknown,
  state = "published",
  format = 1,
  read = 1,
  nodeId: string | null = null,
) {
  await database
    .prepare(
      "INSERT OR REPLACE INTO publications (key,state,format,body,read_started_at,promoted_at,node_id) VALUES (?,?,?,?,?,1,?)",
    )
    .bind(key, state, format, JSON.stringify(body), read, nodeId)
    .run();
}
function answer(uri = "/about/", title = "About") {
  return data({
    pageBy: {
      id: "page-1",
      title,
      content: "<h1>About us</h1>",
      uri,
      status: "publish",
      isRestricted: false,
      featuredImage: null,
    },
    postBy: null,
    designTokens: { colors: [], spacingSizes: [] },
  });
}
beforeEach(() => {
  database = openTestD1();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
});
afterEach(() => {
  database.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("unprepared store refuses home and entries before contacting CMS", async () => {
  const fetch = vi.fn();
  const api = runtime({ fetch });
  expect(await api.publishedHome()).toMatchObject({
    kind: "unavailable",
    failure: { reason: "not-ready" },
  });
  expect(await api.publishedEntry("/about/")).toMatchObject({
    kind: "unavailable",
    failure: { reason: "not-ready" },
  });
  expect(await api.pageChrome()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
test("production without a database refuses every live delivery path", async () => {
  const fetch = vi.fn();
  const api = runtime({ bindings: () => ({}), fetch });
  expect(await api.publishedHome()).toMatchObject({
    kind: "unavailable",
    failure: { reason: "not-ready" },
  });
  expect(await api.publishedEntry("/about/")).toMatchObject({
    kind: "unavailable",
    failure: { reason: "not-ready" },
  });
  expect(await api.pageChrome()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
test("only explicit development permits live home, entry and chrome without a database", async () => {
  const fetch = stubWordPress({
    home: () =>
      data({
        generalSettings: { title: "Acme", description: "Things" },
        nodeByUri: {
          __typename: "Page",
          isFrontPage: true,
          title: "Home",
          content: "<h1>Welcome</h1>",
        },
        designTokens: { colors: [], spacingSizes: [] },
      }),
    entry: () => answer(),
  });
  const api = runtime({ bindings: () => ({}), development: true });
  expect(await api.publishedHome("https://site.test")).toMatchObject({
    kind: "found",
    content: { home },
  });
  expect(await api.publishedEntry("/about/", "https://site.test")).toMatchObject({
    kind: "found",
    content: { entry },
  });
  expect(await api.pageChrome("https://site.test")).toMatchObject({
    menuItems: [{ href: "/about/" }],
  });
  expect(queries(fetch, "HomePage")).toHaveLength(1);
});
test("development retains credential destination and pairing restrictions", async () => {
  const fetch = vi.fn();
  for (const bindings of [
    () => ({ GQ_AUTH_GRAPHQL_CLIENT_ID: "id" }),
    () => ({ GQ_AUTH_GRAPHQL_CLIENT_ID: "id", GQ_AUTH_GRAPHQL_CLIENT_SECRET: "secret" }),
  ]) {
    const api = runtime({
      development: true,
      graphqlEndpoint: "http://cms.test/graphql",
      bindings,
      fetch,
    });
    expect((await api.publishedHome()).kind).toBe("unavailable");
    expect((await api.publishedEntry("/about/")).kind).toBe("unavailable");
    expect(await api.pageChrome()).toBeNull();
  }
  expect(fetch).not.toHaveBeenCalled();
});
test("store failures never trigger live fallback even in development", async () => {
  const fetch = vi.fn();
  database.unavailable = true;
  const api = runtime({ fetch, development: true });
  expect(await api.publishedHome()).toMatchObject({
    kind: "unavailable",
    failure: { reason: "store" },
  });
  expect(await api.publishedEntry("/about/")).toMatchObject({
    kind: "unavailable",
    failure: { reason: "store" },
  });
  expect(await api.pageChrome()).toBeNull();
  expect(fetch).not.toHaveBeenCalled();
});
test.each([
  ["home", 99, home],
  ["home", 1, { bad: true }],
  ["home", 1, "malformed"],
  ["chrome", 99, chrome],
  ["chrome", 1, {}],
])("unreadable %s format %s fails safely", async (key, format, body) => {
  await seed("home", home);
  await seed("chrome", chrome);
  await seed(key, body, "published", format);
  expect(await runtime().publishedHome()).toMatchObject({
    kind: "unavailable",
    failure: { reason: "not-ready" },
  });
});
test("invalid JSON and unknown publication state are never served", async () => {
  await seed("chrome", chrome);
  await seed("home", home);
  database.exec("UPDATE publications SET body='{' WHERE key='home'");
  expect((await runtime().publishedHome()).kind).toBe("unavailable");
  await seed("home", home, "future-state");
  expect((await runtime().publishedHome()).kind).toBe("unavailable");
});
test("confirmed missing home retains available chrome", async () => {
  await seed("home", null, "missing");
  await seed("chrome", chrome);
  expect(await runtime().publishedHome()).toEqual({ kind: "missing", chrome });
});
test("shared design overrides per-publication presets and invalid design retains original presets", async () => {
  await seed("home", home);
  await seed("chrome", chrome);
  await seed("entry:/about/", entry);
  const design = {
    colors: [{ slug: "brand", color: "#c00" }],
    spacingSizes: [{ slug: "large", size: "4rem" }],
  };
  await seed("design", design);
  expect(await runtime().publishedHome()).toMatchObject({
    kind: "found",
    content: { home: design },
  });
  expect(await runtime().publishedEntry("/about/")).toMatchObject({
    kind: "found",
    content: { entry: design },
  });
  await seed("design", {}, "published", 99);
  expect(await runtime().publishedHome()).toMatchObject({ kind: "found", content: { home } });
});
test("stored entries, missing and moved routes read no CMS", async () => {
  await seed("chrome", chrome);
  await seed("entry:/about/", entry);
  await seed("entry:/gone/", null, "missing");
  await seed("entry:/old/", { uri: "/about/" }, "moved");
  const fetch = vi.fn();
  const api = runtime({ fetch });
  expect(await api.publishedEntry("about")).toEqual({
    kind: "found",
    content: { entry, chrome, alternates: [] },
  });
  expect(await api.publishedEntry("/gone/")).toEqual({ kind: "missing", chrome });
  expect(await api.publishedEntry("/old/")).toEqual({ kind: "moved", uri: "/about/" });
  expect(fetch).not.toHaveBeenCalled();
});
test.each([
  ["published", 99, entry],
  ["published", 1, {}],
  ["moved", 1, { uri: "//evil.test/" }],
  ["moved", 1, null],
])("malformed entry %s format %s is unavailable", async (state, format, body) => {
  await seed("chrome", chrome);
  await seed("entry:/about/", body, state, format);
  expect(await runtime().publishedEntry("/about/")).toMatchObject({
    kind: "unavailable",
    failure: { reason: "not-ready" },
  });
});
test("cold lookup reads once then serves durable content through outage", async () => {
  await seed("chrome", chrome);
  const fetch = stubWordPress({ entry: () => answer() });
  const api = runtime();
  expect(await api.publishedEntry("/about/")).toMatchObject({ kind: "found", content: { entry } });
  fetch.mockImplementation(async () => {
    throw new Error("offline");
  });
  expect(await api.publishedEntry("/about/")).toMatchObject({ kind: "found", content: { entry } });
  expect(queries(fetch, "EntryByUri")).toHaveLength(1);
});
test.each([() => httpError(503), () => timeout(), () => Promise.reject(new Error("offline"))])(
  "cold failed lookup is unavailable, never missing",
  async (handler) => {
    await seed("chrome", chrome);
    stubWordPress({ entry: handler });
    expect((await runtime().publishedEntry("/about/")).kind).toBe("unavailable");
  },
);
test("cold confirmed missing stores no negative row and may later become published", async () => {
  await seed("chrome", chrome);
  const fetch = stubWordPress({
    entry: () =>
      data({ pageBy: null, postBy: null, designTokens: { colors: [], spacingSizes: [] } }),
  });
  const api = runtime();
  expect(await api.publishedEntry("/about/")).toEqual({ kind: "missing", chrome });
  fetch.mockImplementation(async () => answer());
  expect((await api.publishedEntry("/about/")).kind).toBe("found");
  expect(queries(fetch, "EntryByUri")).toHaveLength(2);
});
test("cold route aliases redirect to canonical paths including absolute and percent encoded CMS URIs", async () => {
  await seed("chrome", chrome);
  stubWordPress({ entry: () => answer("https://site.test/caf%C3%A9/") });
  expect(await runtime().publishedEntry("/old/")).toEqual({ kind: "moved", uri: "/café/" });
  expect((await runtime().publishedEntry("/caf%c3%a9")).kind).toBe("found");
});
test("a cold lookup at a new route moves the older stored route of the same entry", async () => {
  await seed("chrome", chrome);
  await seed("entry:/old/", { ...entry, uri: "/old/" }, "published", 1, 1, "page-1");
  stubWordPress({ entry: () => answer() });
  const api = runtime();
  expect((await api.publishedEntry("/about/")).kind).toBe("found");
  expect(await api.publishedEntry("/old/")).toEqual({ kind: "moved", uri: "/about/" });
});
test("publication data survives closing and reopening the database", async () => {
  mkdirSync(join(process.cwd(), ".proofs"), { recursive: true });
  const directory = mkdtempSync(join(process.cwd(), ".proofs/restart-"));
  const path = join(directory, "publications.sqlite");
  database.close();
  database = openTestD1(path);
  try {
    await seed("home", home);
    await seed("chrome", chrome);
    await seed("entry:/about/", entry);
    database.close();
    database = openTestD1(path);
    const api = runtime({ fetch: vi.fn() });
    expect((await api.publishedHome()).kind).toBe("found");
    expect((await api.publishedEntry("/about/")).kind).toBe("found");
  } finally {
    database.close();
    database = openTestD1();
    rmSync(directory, { recursive: true, force: true });
  }
});
test("a long-lived runtime loads a fresh database on every delivery operation", async () => {
  const other = openTestD1();
  await seed("home", home);
  await seed("chrome", chrome);
  const api = runtime();
  expect((await api.publishedHome()).kind).toBe("found");
  const original = database;
  database = other;
  try {
    expect((await api.publishedHome()).kind).toBe("unavailable");
    expect((await api.publishedEntry("/about/")).kind).toBe("unavailable");
    expect(await api.pageChrome()).toBeNull();
  } finally {
    database = original;
    other.close();
  }
});

test("two language homes and entries retain canonical alternates and their own chrome", async () => {
  const api = runtime({
    wordpress: { locale: "pt_PT_ao90", languages: [{ locale: "en_US", slug: "en" }] },
  });
  const pt = api.defaultLanguage;
  const en = api.languages[1]!;
  await seed("home", home);
  await seed("chrome", chrome);
  await seed("home:en", { ...home, page: { ...home.page, title: "English" } });
  const enChrome = { ...chrome, siteIcon: { sourceUrl: "/en.png", altText: "English" } };
  await seed("chrome:en", enChrome);
  await seed("entry:/sobre/", {
    ...entry,
    language: "pt",
    uri: "/sobre/",
    translations: [{ uri: "/en/about/", language: "en" }],
  });
  await seed("entry:/en/about/", {
    ...entry,
    language: "en",
    uri: "/en/about/",
    translations: [{ uri: "/sobre/", language: "pt" }],
  });
  const portuguese = await api.publishedHome(undefined, pt);
  const english = await api.publishedHome(undefined, en);
  expect(portuguese).toMatchObject({
    kind: "found",
    content: { home, chrome, alternates: [{ language: en, route: "/en/", translation: true }] },
  });
  expect(english).toMatchObject({
    kind: "found",
    content: {
      home: { page: { title: "English" } },
      chrome: enChrome,
      alternates: [{ language: pt, route: "/", translation: true }],
    },
  });
  if (portuguese.kind !== "found" || english.kind !== "found") throw new Error("Expected homes");
  expect(portuguese.content.alternates[0]!.language).toBe(en);
  expect(english.content.alternates[0]!.language).toBe(pt);
  const about = await api.publishedEntry("/en/about/");
  expect(about).toMatchObject({
    kind: "found",
    content: {
      chrome: enChrome,
      alternates: [{ language: pt, route: "/sobre/", translation: true }],
    },
  });
  if (about.kind !== "found") throw new Error("Expected entry");
  expect(about.content.alternates[0]!.language).toBe(pt);
  expect(api.routeLanguage("/en/about/")).toBe(en);
  await seed("entry:/sobre/", null, "withdrawn");
  expect(await api.publishedEntry("/en/about/")).toMatchObject({
    kind: "found",
    content: { alternates: [{ language: pt, route: "/", translation: false }] },
  });
  await seed("home", null, "withdrawn");
  expect(await api.publishedEntry("/en/about/")).toMatchObject({
    kind: "found",
    content: { alternates: [] },
  });
});
test("language homes never held, wrong-language entries and legacy entries keep language isolation", async () => {
  const api = runtime({
    wordpress: { locale: "pt_PT", languages: [{ locale: "en_US", slug: "en" }] },
  });
  await seed("chrome", chrome);
  await seed("chrome:en", chrome);
  expect(await api.publishedHome(undefined, api.languages[1])).toEqual({ kind: "missing", chrome });
  expect(await api.publishedEntry("/en/about/")).toEqual({ kind: "missing", chrome });
  await seed("home:en", home);
  await seed("entry:/en/about/", entry);
  await seed("entry:/about/", entry);
  expect(await api.publishedEntry("/en/about/")).toEqual({ kind: "missing", chrome });
  expect((await api.publishedEntry("/about/")).kind).toBe("found");
});
test("cold lookup cannot promote a withdrawn identity", async () => {
  await seed("chrome", chrome);
  await database
    .prepare(
      "INSERT INTO withdrawals (node_id,event_id,uri,withdrawn_at,accepted_at) VALUES ('page-1','withdraw','/old/',1,1)",
    )
    .run();
  stubWordPress({ entry: () => answer() });
  expect(await runtime().publishedEntry("/about/")).toEqual({ kind: "missing", chrome });
});
test("a later cold read wins over an older in-flight lookup", async () => {
  await seed("chrome", chrome);
  let finish!: () => void;
  let started!: () => void;
  const waiting = new Promise<void>((resolve) => {
    started = resolve;
  });
  const gate = new Promise<void>((resolve) => {
    finish = resolve;
  });
  let reads = 0;
  stubWordPress({
    entry: async () => {
      if (++reads === 1) {
        started();
        await gate;
        return answer("/about/", "Older");
      }
      return answer("/about/", "Newer");
    },
  });
  vi.spyOn(Date, "now").mockReturnValueOnce(100).mockReturnValue(200);
  const api = runtime();
  const older = api.publishedEntry("/about/");
  await waiting;
  const newer = await api.publishedEntry("/about/");
  finish();
  await older;
  expect(newer).toMatchObject({ kind: "found", content: { entry: { title: "Newer" } } });
  expect(await api.publishedEntry("/about/")).toMatchObject({
    kind: "found",
    content: { entry: { title: "Newer" } },
  });
});
test.each(["draft", "private"])("cold %s entries are missing", async (status) => {
  await seed("chrome", chrome);
  stubWordPress({
    entry: () =>
      data({
        pageBy: {
          id: "x",
          title: "Hidden",
          content: "secret",
          uri: "/hidden/",
          status,
          isRestricted: false,
          featuredImage: null,
        },
        postBy: null,
        designTokens: { colors: [], spacingSizes: [] },
      }),
  });
  expect(await runtime().publishedEntry("/hidden/")).toEqual({ kind: "missing", chrome });
});
test("cold password protected entries are missing", async () => {
  await seed("chrome", chrome);
  stubWordPress({
    entry: () =>
      data({
        pageBy: {
          id: "x",
          title: "Hidden",
          content: "secret",
          uri: "/hidden/",
          status: "publish",
          isRestricted: true,
          featuredImage: null,
        },
        postBy: null,
        designTokens: { colors: [], spacingSizes: [] },
      }),
  });
  expect(await runtime().publishedEntry("/hidden/")).toEqual({ kind: "missing", chrome });
});

test("an English cold lookup queries and serves its own language", async () => {
  await seed("home:en", home);
  await seed("chrome:en", chrome);
  const api = runtime({
    wordpress: { locale: "pt_PT", languages: [{ locale: "en_US", slug: "en" }] },
  });
  const fetch = stubWordPress({
    entry: (variables) => {
      expect(variables.uri).toBe("/en/about/");
      return data({
        postBy: null,
        pageBy: {
          __typename: "Page",
          id: "english-1",
          title: "English page",
          content: "<p>English</p>",
          uri: "/en/about/",
          status: "publish",
          isRestricted: false,
          featuredImage: null,
          language: { slug: "en" },
          translations: [],
        },
        designTokens: { colors: [], spacingSizes: [] },
      });
    },
  });
  expect(await api.publishedEntry("/en/about/")).toMatchObject({
    kind: "found",
    content: { entry: { language: "en", title: "English page" } },
  });
  expect(queries(fetch, "EntryByUri")).toHaveLength(1);
});
test("a partial cold lookup stays unstored and recovers on the next complete read", async () => {
  await seed("chrome", chrome);
  let complete = false;
  const fetch = stubWordPress({
    entry: (variables) => (complete || variables.withBlocks === false ? answer() : httpError(502)),
  });
  const api = runtime();
  expect((await api.publishedEntry("/about/")).kind).toBe("found");
  complete = true;
  expect((await api.publishedEntry("/about/")).kind).toBe("found");
  expect(queries(fetch, "EntryByUri")).toHaveLength(3);
  fetch.mockImplementation(async () => {
    throw new Error("offline");
  });
  expect((await api.publishedEntry("/about/")).kind).toBe("found");
});
test("database diagnostics do not expose secrets in public failures or logs", async () => {
  const api = runtime({
    bindings: () => ({
      PUBLICATION_DB: {
        prepare() {
          throw new Error("private-store-secret");
        },
        async batch() {
          return [];
        },
      },
    }),
  });
  const result = await api.publishedHome();
  expect(result).toMatchObject({ kind: "unavailable", failure: { reason: "store" } });
  expect(JSON.stringify(result)).not.toContain("private-store-secret");
  expect(JSON.stringify(vi.mocked(console.error).mock.calls)).not.toContain("private-store-secret");
});
