import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createHmac, randomUUID } from "node:crypto";
import { createContentRuntime } from "@getquick/content/server";
import type { ContentExtension, EntryDelivery, HomeDelivery } from "@getquick/content";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";
import {
  data,
  httpError,
  queries,
  routes,
  stubWordPress,
  type Handler,
} from "./support/wordpress-stub";

// A Site's own content on its pages and posts: a block tree a plugin exposes as
// JSON, and a page setting.
interface Design {
  blocks: Array<{ blockName: string | null }>;
  background: string | null;
}
const isDesign = (value: unknown): value is Design =>
  typeof value === "object" &&
  value !== null &&
  Array.isArray((value as Design).blocks) &&
  (value as Design).blocks.every((block) => typeof block?.blockName !== "undefined") &&
  ((value as Design).background === null || typeof (value as Design).background === "string");
const extension: ContentExtension<Design> = {
  fields: { page: "wpBlocksJson\nsiteBackground", post: "wpBlocksJson" },
  read: ({ kind, fields }) => {
    if (typeof fields.wpBlocksJson !== "string") return undefined;
    const blocks: unknown = JSON.parse(fields.wpBlocksJson);
    if (!Array.isArray(blocks)) throw new Error("wpBlocksJson isn't a list of blocks");
    if (!blocks.some((block) => String(block?.blockName).startsWith("site/"))) return undefined;
    const background = kind === "page" ? fields.siteBackground : null;
    return {
      blocks: blocks as Design["blocks"],
      background: typeof background === "string" ? background : null,
    };
  },
  parse: (stored) => (isDesign(stored) ? stored : undefined),
};

let db: TestD1;
const token = "extension-test-token-0123456789012345678901234567";
const secret = "extension-event-key-01234567890123456789012345";
const config = {
  site: "Acme",
  graphqlEndpoint: "https://cms.test/graphql",
  cmsOrigin: "https://cms.test",
  isServer: () => true,
  bindings: () => ({
    PUBLICATION_DB: db,
    FRONTEND_REFRESH_TOKEN: token,
    PUBLICATION_EVENT_SECRET: secret,
  }),
};
const api = () => createContentRuntime({ ...config, extension });
async function refresh(runtime = api(), body: unknown = {}) {
  const response = await runtime.handleRefresh(
    new Request("https://site.test/gq/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
      body: JSON.stringify(body),
    }),
    { siteOrigin: "https://site.test" },
  );
  return { status: response.status, report: await response.json() };
}
async function event(runtime: ReturnType<typeof api>, action: string) {
  const body = JSON.stringify({ site: "Acme", id: randomUUID(), occurredAt: Date.now(), action });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(timestamp + "." + body)
    .digest("hex");
  const response = await runtime.handleEvent(
    new Request("https://site.test/gq/events", {
      method: "POST",
      body,
      headers: { "GQ-Event-Timestamp": timestamp, "GQ-Event-Signature": `v1=${signature}` },
    }),
  );
  return { status: response.status, body: await response.json() };
}

const presets = { colors: [{ slug: "brand", color: "#c00" }], spacingSizes: [] };
const siteBlocks = (heading = "Welcome") =>
  JSON.stringify([{ blockName: "site/hero", attrs: { heading } }, { blockName: "core/paragraph" }]);
let homeFields: Record<string, unknown>;
let entryFields: Record<string, unknown>;
const home: Handler = () =>
  data({
    generalSettings: { title: "Acme", description: "Things" },
    nodeByUri: {
      __typename: "Page",
      id: "front",
      isFrontPage: true,
      title: "Home",
      content: "<h1>Welcome</h1>",
      ...homeFields,
    },
    designTokens: presets,
  });
const page = (fields: Record<string, unknown>) =>
  data({
    pageBy: {
      id: "page-1",
      uri: "/about/",
      title: "About",
      content: "<p>About</p>",
      status: "publish",
      isRestricted: false,
      featuredImage: null,
      ...fields,
    },
    postBy: null,
    designTokens: presets,
  });
const post = (fields: Record<string, unknown>) =>
  data({
    postBy: {
      id: "post-1",
      uri: "/news/",
      title: "News",
      excerpt: "",
      content: "<p>News</p>",
      date: "2026-10-01T09:00:00",
      status: "publish",
      isRestricted: false,
      featuredImage: null,
      ...fields,
    },
    pageBy: null,
    designTokens: presets,
  });
const entry: Handler = ({ uri }) =>
  uri === "/news/" ? post({ wpBlocksJson: siteBlocks("News") }) : page(entryFields);
const wordpress = (overrides: Parameters<typeof stubWordPress>[0] = {}) =>
  stubWordPress({
    home,
    entry,
    routes: () => routes("/", "/about/", "/news/"),
    design: () => data({ designTokens: presets }),
    ...overrides,
  });
const offline = (fetch: ReturnType<typeof wordpress>) =>
  fetch.mockImplementation(async () => {
    throw new Error("CMS offline");
  });
const found = <T extends HomeDelivery<Design> | EntryDelivery<Design>>(delivery: T) => {
  if (delivery.kind !== "found") throw new Error(`not found: ${JSON.stringify(delivery)}`);
  return delivery.content as Extract<T, { kind: "found" }>["content"];
};

beforeEach(() => {
  db = openTestD1();
  homeFields = { wpBlocksJson: siteBlocks(), siteBackground: "#fafafa" };
  entryFields = { wpBlocksJson: siteBlocks("About"), siteBackground: null };
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("each kind of node is read with the Site's fields, alongside its blocks", async () => {
  const fetch = wordpress();
  await api().wordpress.getHomeContent();
  await api().wordpress.getEntryByUri("/about/");
  const [homeQuery] = queries(fetch, "HomePage").map(([, init]) => JSON.parse(init.body as string));
  const [entryQuery] = queries(fetch, "EntryByUri").map(([, init]) =>
    JSON.parse(init.body as string),
  );
  expect(homeQuery.query).toMatch(
    /isFrontPage\n\.\.\. @include\(if: \$withBlocks\) \{\nwpBlocksJson\nsiteBackground\n\}/,
  );
  const [postBy, pageBy] = entryQuery.query.split("pageBy(uri: $uri)");
  expect(postBy).toMatch(/\.\.\. @include\(if: \$withBlocks\) \{\nwpBlocksJson\n\}/);
  expect(postBy).not.toContain("siteBackground");
  expect(pageBy).toMatch(
    /\.\.\. @include\(if: \$withBlocks\) \{\nwpBlocksJson\nsiteBackground\n\}/,
  );

  // Without an extension, the queries are the runtime's own.
  fetch.mockClear();
  await createContentRuntime(config).wordpress.getEntryByUri("/about/");
  expect(queries(fetch, "EntryByUri")[0]![1].body as string).not.toContain(
    "@include(if: $withBlocks) {",
  );
});

test("a read carries the Site's value for its page or post, and leaves it out without one", async () => {
  wordpress();
  const runtime = api();
  const read = await runtime.wordpress.getHomeContent();
  expect(read).toMatchObject({
    kind: "found",
    content: {
      page: {
        title: "Home",
        extension: { background: "#fafafa", blocks: [{ blockName: "site/hero" }, {}] },
      },
    },
  });
  expect(await runtime.wordpress.getEntryByUri("/news/")).toMatchObject({
    kind: "found",
    content: { title: "News", extension: { background: null } },
  });

  entryFields = { wpBlocksJson: JSON.stringify([{ blockName: "core/paragraph" }]) };
  const plain = await runtime.wordpress.getEntryByUri("/about/");
  expect(plain.kind === "found" && "extension" in plain.content).toBe(false);
});

test("a value the Site's read rejects fails the read as the wrong schema", async () => {
  entryFields = { wpBlocksJson: '{"not":"blocks"}' };
  wordpress();
  expect(await api().wordpress.getEntryByUri("/about/")).toEqual({
    kind: "unavailable",
    failure: {
      reason: "schema",
      message:
        "WordPress's page doesn't match the Site's extension: wpBlocksJson isn't a list of blocks",
    },
  });
});

test("a refresh stores the extension, and every page serves it through a CMS outage", async () => {
  const fetch = wordpress();
  expect((await refresh()).report).toMatchObject({ ready: true, refreshed: true });
  offline(fetch);
  const runtime = api();
  const front = found(await runtime.publishedHome("https://site.test"));
  expect(front.home.page.extension).toEqual({
    background: "#fafafa",
    blocks: [
      { blockName: "site/hero", attrs: { heading: "Welcome" } },
      { blockName: "core/paragraph" },
    ],
  });
  expect(found(await runtime.publishedEntry("/about/")).entry.extension?.blocks[0]).toEqual({
    blockName: "site/hero",
    attrs: { heading: "About" },
  });
  expect(found(await runtime.publishedEntry("/news/")).entry.extension?.background).toBeNull();
});

test("a read without its blocks has no extension, and isn't stored", async () => {
  wordpress();
  await refresh();
  entryFields = { wpBlocksJson: siteBlocks("Changed"), siteBackground: null };
  const fetch = wordpress({
    entry: (variables) => (variables.withBlocks === false ? page({}) : httpError(502)),
  });
  const siteRead = vi.fn(() => ({ blocks: [], background: null }));
  const read = await createContentRuntime({
    ...config,
    extension: { ...extension, read: siteRead },
  }).wordpress.getEntryByUri("/about/");
  expect(read).toMatchObject({ kind: "found", content: { blocksOmitted: true } });
  expect(read.kind === "found" && "extension" in read.content).toBe(false);
  expect(siteRead).not.toHaveBeenCalled();
  expect((await refresh(api(), { uris: ["/about/"] })).report).toMatchObject({
    entries: { "/about/": { outcome: "kept", failure: { reason: "partial" } } },
  });
  offline(fetch);
  expect(found(await api().publishedEntry("/about/")).entry.extension?.blocks[0]).toEqual({
    blockName: "site/hero",
    attrs: { heading: "About" },
  });
});

test("rows stored before the Site declared its extension still serve, without it", async () => {
  const fetch = wordpress();
  expect((await refresh(createContentRuntime(config))).report.ready).toBe(true);
  offline(fetch);
  const front = found(await api().publishedHome());
  expect(front.home.page).toEqual({
    title: "Home",
    content: "<h1>Welcome</h1>",
    hasVideoHero: false,
  });
  const about = found(await api().publishedEntry("/about/"));
  expect(about.entry.title).toBe("About");
  expect("extension" in about.entry).toBe(false);

  // And a Site that stops declaring one serves its rows without it.
  wordpress();
  await refresh();
  offline(fetch);
  const without = createContentRuntime(config);
  expect(found(await without.publishedHome()).home.page).toEqual({
    title: "Home",
    content: "<h1>Welcome</h1>",
    hasVideoHero: false,
  });
  expect("extension" in found(await without.publishedEntry("/about/")).entry).toBe(false);
});

test("an extension the Site can't parse is neither stored nor served", async () => {
  wordpress();
  await refresh();
  // A read whose value doesn't survive the Site's own parse keeps what is stored.
  const strict = createContentRuntime({
    ...config,
    extension: { ...extension, parse: () => undefined },
  });
  expect((await refresh(strict, { uris: ["/about/"] })).report).toMatchObject({
    entries: { "/about/": { outcome: "kept", failure: { reason: "schema" } } },
  });
  // A stored row whose extension the Site no longer parses is unusable, as any
  // body that doesn't parse.
  expect(await strict.publishedEntry("/about/")).toMatchObject({
    kind: "unavailable",
    failure: { reason: "not-ready" },
  });
  expect(found(await api().publishedEntry("/about/")).entry.extension).toBeDefined();
});

test("reconciliation compares the front page's extension with the stored one", async () => {
  wordpress();
  await refresh();
  const runtime = api();
  expect((await event(runtime, "reconcile")).body).toMatchObject({
    shared: { home: { outcome: "unchanged" } },
  });
  homeFields = { wpBlocksJson: siteBlocks("Changed"), siteBackground: "#fafafa" };
  expect((await event(runtime, "reconcile")).body).toMatchObject({
    shared: { home: { outcome: "promoted", state: "published" } },
  });
  expect(found(await runtime.publishedHome()).home.page.extension?.blocks[0]).toEqual({
    blockName: "site/hero",
    attrs: { heading: "Changed" },
  });
});

test("the stored design presets and the Site's own origins serve pages that aren't publications", async () => {
  const fetch = wordpress();
  const runtime = api();
  expect(await runtime.designPresets()).toBeNull();
  await refresh();
  offline(fetch);
  expect(await runtime.designPresets()).toEqual(presets);
  expect(runtime.internalOrigins("https://site.test")).toEqual([
    "https://cms.test",
    "https://site.test",
  ]);
  expect(runtime.internalOrigins()).toEqual(["https://cms.test"]);

  // Explicit development without a store reads them live; a browser context never does.
  wordpress();
  const live = { ...config, bindings: () => ({}), development: true };
  expect(await createContentRuntime(live).designPresets()).toEqual(presets);
  expect(await createContentRuntime({ ...live, development: false }).designPresets()).toBeNull();
  expect(await createContentRuntime({ ...live, isServer: () => false }).designPresets()).toBeNull();
});

test("empty extension fields are refused when the runtime is created", () => {
  expect(() =>
    createContentRuntime({ ...config, extension: { ...extension, fields: { post: " " } } }),
  ).toThrow("The extension's post fields are empty");
});
