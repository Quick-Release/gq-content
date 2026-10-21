// CMS-selected header and footer patterns: read with the Site chrome, kept in
// the publication store as last-known-good, refreshed with it, and rendered
// through the Site's block renderers.
import { createContentRuntime } from "@getquick/content/server";
import {
  designMenuItems,
  escapeHtml,
  parseDesignBlocks,
  renderDesignPattern,
  type DesignBlock,
  type DesignBlockRenderer,
} from "@getquick/content";
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";
import {
  chrome,
  data,
  httpError,
  queries,
  stubWordPress,
  timeout,
  type Handler,
} from "./support/wordpress-stub";

const SECRET = "design-pattern-event-key-0123456789abcdef";
const TOKEN = "design-pattern-refresh-key-0123456789abcdef";
let db: TestD1;

const runtime = (config: { designTemplate?: string } = {}) =>
  createContentRuntime({
    site: "Acme",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings: () => ({
      PUBLICATION_DB: db,
      FRONTEND_REFRESH_TOKEN: TOKEN,
      PUBLICATION_EVENT_SECRET: SECRET,
    }),
    ...config,
  });

/** GQ Design's Site Navigation block, with the menu its serializer filter adds. */
const navigation = (label = "About us"): DesignBlock => ({
  name: "getquick/header-navigation",
  attributes: {
    menuId: 7,
    menuItems: [
      { id: 11, parentId: 0, label, url: "https://cms.test/about/", target: "_self" },
      {
        id: 12,
        parentId: 11,
        label: "Team",
        url: "https://site.test/about/team/",
        target: "_self",
      },
      { id: 13, parentId: 0, label: "Shop", url: "https://shop.example/", target: "_blank" },
    ],
  },
  content: null,
  children: [],
});
const headerTree = (label?: string): DesignBlock[] => [
  {
    // GQ Design sends saved HTML only for blocks without children.
    name: "core/group",
    attributes: { tagName: "header", className: "gqd-site-header", layout: { type: "flex" } },
    content: null,
    children: [
      {
        name: "core/site-logo",
        attributes: {
          isLink: true,
          linkTarget: "_self",
          width: 120,
          logo: {
            id: 41,
            url: "https://media.example/logo.png",
            alt: "Acme",
            width: 512,
            height: 128,
            mimeType: "image/png",
          },
          logoVariation: null,
        },
        content: null,
        children: [],
      },
      navigation(label),
    ],
  },
];
const footerTree: DesignBlock[] = [
  {
    name: "core/paragraph",
    attributes: {},
    content: "<p>© Acme</p>",
    children: [],
  },
];
/** `designPattern` as GQ Design answers it: `blocksJson` is JSON text. */
const pattern = (title: string, blocks: unknown) => ({ title, blocksJson: JSON.stringify(blocks) });
const chromeWith =
  (header: unknown, footer: unknown): Handler =>
  () =>
    data({ ...chrome, header, footer });
const assigned = (label?: string) =>
  chromeWith(pattern("Main header", headerTree(label)), pattern("Main footer", footerTree));

const home = data({
  generalSettings: { title: "Acme", description: "Things" },
  nodeByUri: { __typename: "Page", isFrontPage: true, title: "Home", content: "<h1>Home</h1>" },
  designTokens: { colors: [], spacingSizes: [] },
});
const wordpress = (chromeHandler: Handler) =>
  stubWordPress({ home: () => home, chrome: chromeHandler });

async function refresh() {
  const response = await runtime().handleRefresh(
    new Request("https://site.test/gq/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: "{}",
    }),
    { siteOrigin: "https://site.test" },
  );
  return { status: response.status, body: await response.json() };
}

async function deliver(fields: Record<string, unknown>) {
  const body = JSON.stringify({
    site: "Acme",
    id: randomUUID(),
    occurredAt: Date.now(),
    ...fields,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const response = await runtime().handleEvent(
    new Request("https://site.test/gq/events", {
      method: "POST",
      body,
      headers: {
        "GQ-Event-Timestamp": timestamp,
        "GQ-Event-Signature": `v1=${createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex")}`,
      },
    }),
    { siteOrigin: "https://site.test" },
  );
  return { status: response.status, body: await response.json() };
}

async function servedChrome() {
  const page = await runtime().publishedHome("https://site.test");
  if (page.kind !== "found") throw new Error(`home is ${page.kind}`);
  return page.content.chrome;
}

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

test("the chrome read asks for both regions of the configured design route", async () => {
  const fetch = wordpress(assigned());
  expect(await runtime().wordpress.getSiteChrome()).toMatchObject({
    kind: "found",
    content: {
      header: { title: "Main header", blocks: headerTree() },
      footer: { title: "Main footer", blocks: footerTree },
    },
  });
  const [, init] = queries(fetch, "SiteChrome")[0]!;
  const request = JSON.parse(init.body as string) as {
    query: string;
    variables: Record<string, unknown>;
  };
  expect(request.query).toContain('header: designPattern(template: $template, slot: "header")');
  expect(request.query).toContain('footer: designPattern(template: $template, slot: "footer")');
  expect(request.variables).toEqual({ location: "PRIMARY", template: "page" });

  await runtime({ designTemplate: "front-page" }).wordpress.getSiteChrome();
  expect(JSON.parse(queries(fetch, "SiteChrome")[1]![1].body as string).variables).toEqual({
    location: "PRIMARY",
    template: "front-page",
  });
  expect(() => runtime({ designTemplate: "123" })).toThrow(/route key/);
  expect(() => runtime({ designTemplate: 'page") { databaseId } x: designPattern(' })).toThrow(
    /route key/,
  );
});

test("assigned patterns are stored with the chrome and served without the CMS", async () => {
  const fetch = wordpress(assigned());
  expect((await refresh()).body).toMatchObject({
    ready: true,
    chrome: { outcome: "promoted", state: "published" },
  });
  fetch.mockImplementation(async () => {
    throw new TypeError("offline");
  });
  const served = await servedChrome();
  expect(served.header).toEqual({ title: "Main header", blocks: headerTree() });
  expect(served.footer).toEqual({ title: "Main footer", blocks: footerTree });
  expect((await runtime().pageChrome())?.header?.title).toBe("Main header");
});

test("null patterns (template parts, or nothing published selected) leave the Site's own regions", async () => {
  wordpress(chromeWith(null, null));
  expect((await refresh()).status).toBe(200);
  const served = await servedChrome();
  expect(served).toMatchObject({ header: null, footer: null, menuItems: [{ label: "About us" }] });
  expect(runtime().renderDesignPattern(served.header)).toBe("");

  // One region selected, the other a template part.
  wordpress(chromeWith(pattern("Main header", headerTree()), null));
  expect((await refresh()).status).toBe(200);
  expect(await servedChrome()).toMatchObject({ header: { title: "Main header" }, footer: null });
});

test("a pattern change reaches visitors with a patterns event, a whole refresh or reconciliation", async () => {
  wordpress(assigned("About us"));
  await refresh();

  const fetch = wordpress(assigned("Who we are"));
  const event = await deliver({ action: "settings", setting: "patterns" });
  expect(event).toMatchObject({ status: 200, body: { status: "refreshed" } });
  // A patterns change reads only the chrome.
  expect(fetch).toHaveBeenCalledTimes(1);
  expect(queries(fetch, "SiteChrome")).toHaveLength(1);
  const served = await servedChrome();
  expect(
    designMenuItems(served.header!.blocks[0]!.children[1]!.attributes.menuItems)[0]?.label,
  ).toBe("Who we are");

  // Unselected in the CMS: refreshed as null, so the Site's own header returns.
  wordpress(chromeWith(null, pattern("Main footer", footerTree)));
  expect((await refresh()).status).toBe(200);
  expect((await servedChrome()).header).toBeNull();

  // A missed change is repaired by reconciliation, which compares the chrome.
  stubWordPress({
    home: () => home,
    chrome: assigned("Contact"),
    routes: () =>
      data({ contentNodes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }),
  });
  expect((await deliver({ action: "reconcile" })).status).toBe(200);
  expect((await servedChrome()).header!.blocks[0]!.children[1]!.attributes.menuItems).toMatchObject(
    [{ label: "Contact" }, {}, {}],
  );
});

test.each([
  ["an HTTP error", () => httpError(502)],
  ["a timeout", () => timeout()],
  [
    "GraphQL errors",
    () => ({ ok: true as const, json: async () => ({ errors: [{ message: "boom" }] }) }),
  ],
  [
    "blocksJson that isn't JSON",
    chromeWith({ title: "Main header", blocksJson: "{not json" }, null),
  ],
  ["a selected pattern GQ Design couldn't resolve", chromeWith(pattern("Main header", []), null)],
  [
    "a partially malformed tree",
    chromeWith(pattern("Main header", [...headerTree(), { nope: 1 }]), null),
  ],
  [
    "a malformed child",
    chromeWith(pattern("Main header", [{ ...headerTree()[0], children: [{ nope: 1 }] }]), null),
  ],
  [
    "malformed attributes",
    chromeWith(pattern("Main header", [{ ...footerTree[0], attributes: 7 }]), null),
  ],
  [
    "an answer without its patterns",
    () => data({ ...chrome, header: undefined, footer: undefined }),
  ],
])("a chrome read failing with %s keeps the last-known-good regions", async (_label, failing) => {
  wordpress(assigned());
  await refresh();
  wordpress(failing as Handler);
  const failed = await deliver({ action: "settings", setting: "patterns" });
  expect(failed.status).toBe(503);
  expect(failed.body).toMatchObject({ status: "failed" });
  const served = await servedChrome();
  expect(served.header).toEqual({ title: "Main header", blocks: headerTree() });
  expect(served.footer).toEqual({ title: "Main footer", blocks: footerTree });
});

test("chrome stored before patterns were read is served with none, then gains them", async () => {
  await db
    .prepare(
      "INSERT INTO publications (key,state,format,body,read_started_at,promoted_at) VALUES ('chrome','published',1,?,1,1)",
    )
    .bind(JSON.stringify({ menuItems: [], siteIcon: null, siteLogo: null }))
    .run();
  expect(await runtime().pageChrome()).toEqual({
    menuItems: [],
    siteIcon: null,
    siteLogo: null,
    header: null,
    footer: null,
  });
  wordpress(assigned());
  expect((await deliver({ action: "settings", setting: "patterns" })).status).toBe(200);
  expect((await runtime().pageChrome())?.header?.title).toBe("Main header");
});

test("a stored pattern this Frontend can't read makes the chrome unusable, never half-served", async () => {
  await db
    .prepare(
      "INSERT INTO publications (key,state,format,body,read_started_at,promoted_at) VALUES ('chrome','published',1,?,1,1)",
    )
    .bind(
      JSON.stringify({
        menuItems: [],
        siteIcon: null,
        siteLogo: null,
        header: { title: "Broken", blocks: [{ name: 7 }] },
        footer: null,
      }),
    )
    .run();
  expect(await runtime().pageChrome()).toBeNull();
});

test("failed pattern events retry the same identity and cannot roll back a later change", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
  wordpress(assigned());
  await refresh();
  const change = {
    action: "settings",
    setting: "patterns",
    id: randomUUID(),
    occurredAt: Date.now() + 1000,
  };
  vi.setSystemTime(Date.now() + 1000);
  wordpress(chromeWith(pattern("Invalid", []), null));
  expect((await deliver(change)).status).toBe(503);
  wordpress(assigned("Changed"));
  expect((await deliver(change)).status).toBe(200);
  const fetch = wordpress(assigned("Old"));
  expect((await deliver(change)).body.duplicate).toBe(true);
  expect(
    (await deliver({ ...change, id: randomUUID(), occurredAt: change.occurredAt - 1 })).body.status,
  ).toBe("superseded");
  expect(fetch).not.toHaveBeenCalled();
  expect((await servedChrome()).header!.blocks).toEqual(headerTree("Changed"));
});

test("a slower pattern read cannot replace a later promotion", async () => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-21T12:00:00Z"));
  wordpress(assigned());
  await refresh();
  let release!: () => void;
  const gate = new Promise<void>((resolve) => {
    release = resolve;
  });
  const older = assigned("Older")({});
  const fetch = wordpress(async () => {
    await gate;
    return older;
  });
  const slow = deliver({ action: "settings", setting: "patterns" });
  await vi.waitFor(() => expect(queries(fetch, "SiteChrome")).toHaveLength(1));
  vi.setSystemTime(Date.now() + 1000);
  wordpress(assigned("Newer"));
  expect((await deliver({ action: "settings", setting: "patterns" })).status).toBe(200);
  release();
  expect((await slow).body.chrome.outcome).toBe("superseded");
  expect((await servedChrome()).header!.blocks).toEqual(headerTree("Newer"));
});

test("reconciliation repairs old rows, keeps last-known-good on failure, and converges on null", async () => {
  const reconcile = () => deliver({ action: "reconcile" });
  const handlers = {
    home: () => home,
    routes: () =>
      data({ contentNodes: { pageInfo: { hasNextPage: false, endCursor: null }, nodes: [] } }),
  };
  wordpress(assigned());
  await refresh();
  await db
    .prepare("UPDATE publications SET body = ? WHERE key = 'chrome'")
    .bind(JSON.stringify({ menuItems: [], siteIcon: null, siteLogo: null }))
    .run();
  stubWordPress({ ...handlers, chrome: assigned() });
  expect((await reconcile()).body.shared.chrome.outcome).toBe("promoted");
  expect((await reconcile()).body.shared.chrome.outcome).toBe("unchanged");
  stubWordPress({ ...handlers, chrome: chromeWith(pattern("Broken", []), null) });
  expect((await reconcile()).body.shared.chrome.outcome).toBe("kept");
  expect((await servedChrome()).header!.title).toBe("Main header");
  // Null is the provider's authoritative answer for a hidden/deleted selection.
  stubWordPress({ ...handlers, chrome: chromeWith(null, null) });
  expect((await reconcile()).body.shared.chrome.outcome).toBe("promoted");
  expect(await servedChrome()).toMatchObject({ header: null, footer: null });
});

const siteNavigation: DesignBlockRenderer = (block, context) => {
  const items = designMenuItems(block.attributes.menuItems, context.href);
  const list = (level: typeof items): string =>
    `<ul>${level
      .map(
        (item) =>
          `<li><a href="${escapeHtml(item.href)}"${item.target ? ` target="${item.target}"` : ""}>${escapeHtml(item.label)}</a>${item.children.length ? list(item.children) : ""}</li>`,
      )
      .join("")}</ul>`;
  return `<nav class="site-navigation" aria-label="Primary">${list(items)}</nav>`;
};

test("Site block renderers render custom blocks such as getquick/header-navigation", async () => {
  wordpress(assigned());
  await refresh();
  const served = await servedChrome();
  const html = runtime().renderDesignPattern(served.header, {
    siteOrigin: "https://site.test",
    blocks: { "getquick/header-navigation": siteNavigation },
  });
  expect(html).toBe(
    '<header class="wp-block-group gqd-site-header is-layout-flex">' +
      '<div class="wp-block-site-logo"><a href="/" class="custom-logo-link" rel="home">' +
      '<img class="custom-logo" src="https://media.example/logo.png" alt="Acme" width="120" height="30" decoding="async" /></a></div>' +
      '<nav class="site-navigation" aria-label="Primary"><ul>' +
      '<li><a href="/about/">About us</a><ul><li><a href="/about/team/">Team</a></li></ul></li>' +
      '<li><a href="https://shop.example/" target="_blank">Shop</a></li>' +
      "</ul></nav></header>",
  );
  expect(runtime().renderDesignPattern(served.footer)).toBe("<p>© Acme</p>");
});

test("containers without a renderer are wrapped as WordPress would; dynamic leaves are reported", () => {
  const unrendered: string[] = [];
  const paragraph = (text: string): DesignBlock => ({
    name: "core/paragraph",
    attributes: {},
    content: `<p>${text}</p>`,
    children: [],
  });
  const blocks: DesignBlock[] = [
    {
      name: "core/group",
      attributes: {
        tagName: "script",
        className: 'site-footer" onload="x',
        align: "full",
        backgroundColor: "brand",
        textColor: "white",
        layout: { type: "constrained" },
      },
      content: null,
      children: [
        { name: "acme/columns", attributes: {}, content: null, children: [paragraph("Kept")] },
        navigation(),
        { name: "core/site-title", attributes: {}, content: null, children: [] },
      ],
    },
  ];
  expect(
    renderDesignPattern(blocks, { onUnrendered: (block) => unrendered.push(block.name) }),
  ).toBe(
    '<div class="wp-block-group site-footer&quot; onload=&quot;x alignfull has-brand-background-color has-background has-white-color has-text-color is-layout-constrained">' +
      '<div class="wp-block-acme-columns"><p>Kept</p></div></div>',
  );
  expect(unrendered).toEqual(["getquick/header-navigation", "core/site-title"]);
});

test("Site renderers take precedence, see their ancestors and may render children selectively", () => {
  const seen: string[][] = [];
  const html = renderDesignPattern(
    { title: "Header", blocks: headerTree() },
    {
      blocks: {
        "core/group": (block, context) =>
          `<header>${context.render(block.children.filter((child) => child.name !== "core/site-logo"))}</header>`,
        "getquick/header-navigation": (block, context) => {
          seen.push(context.ancestors.map((ancestor) => ancestor.name));
          return "<nav></nav>";
        },
        "core/site-logo": () => "<b>own logo</b>",
      },
    },
  );
  expect(html).toBe("<header><nav></nav></header>");
  // Only the selective render: children nobody reads aren't rendered.
  expect(seen).toEqual([["core/group"]]);
});

test("links and menus from CMS data are made safe", () => {
  const href = (url: unknown) =>
    runtime().renderDesignPattern(
      [{ name: "x/link", attributes: { url }, content: null, children: [] }],
      {
        siteOrigin: "https://site.test",
        blocks: { "x/link": (block, context) => context.href(block.attributes.url) },
      },
    );
  expect(href("https://cms.test/about/?a=1#b")).toBe("/about/?a=1#b");
  expect(href("https://site.test/team/")).toBe("/team/");
  expect(href("https://elsewhere.example/")).toBe("https://elsewhere.example/");
  expect(href("javascript:alert(1)")).toBe("#");
  expect(href("//evil.example/")).toBe("#");
  expect(href(42)).toBe("#");
  expect(href("mailto:hi@acme.example")).toBe("mailto:hi@acme.example");

  expect(
    designMenuItems([
      { id: 1, parentId: 2, label: "A", url: "/a/" },
      { id: 2, parentId: 1, label: "B", url: "/b/" },
      { id: 3, parentId: 99, label: "Orphan", url: "/c/" },
      { id: 3, parentId: 0, label: "Duplicate", url: "/d/" },
      { label: "No id" },
      "not an item",
    ]).map((item) => [item.label, item.children.length]),
  ).toEqual([
    ["A", 0],
    ["B", 0],
    ["Orphan", 0],
  ]);
  expect(designMenuItems(undefined)).toEqual([]);

  const logo = renderDesignPattern([
    {
      name: "core/site-logo",
      attributes: { logo: { url: "javascript:alert(1)", alt: "x" } },
      content: null,
      children: [],
    },
    {
      name: "core/site-logo",
      attributes: {
        isLink: false,
        className: '"><script>',
        logo: { url: "https://media.example/a.svg", alt: '"Acme"', width: null, height: null },
      },
      content: null,
      children: [],
    },
  ]);
  expect(logo).toBe(
    '<div class="wp-block-site-logo &quot;&gt;&lt;script&gt;"><img class="custom-logo" src="https://media.example/a.svg" alt="&quot;Acme&quot;" decoding="async" /></div>',
  );
});

test("pattern parsing rejects incomplete trees and accepts PHP's empty attributes", () => {
  expect(parseDesignBlocks([{ ...footerTree[0], attributes: [] }])).toEqual(footerTree);
  for (const invalid of [
    [...footerTree, { attributes: {} }],
    [{ ...headerTree()[0], children: [{ nope: 1 }] }],
    [{ ...footerTree[0], attributes: [1] }],
    [{ ...footerTree[0], content: 7 }],
    [{ ...footerTree[0], children: null }],
    [{ ...footerTree[0], name: "" }],
  ])
    expect(parseDesignBlocks(invalid)).toBeUndefined();
  expect(parseDesignBlocks("{}")).toBeUndefined();
  expect(parseDesignBlocks("not json")).toBeUndefined();
  expect(renderDesignPattern(null)).toBe("");
});

test("unregistered block names never resolve inherited JavaScript properties as renderers", () => {
  const unrendered: string[] = [];
  expect(
    renderDesignPattern(
      [
        { name: "toString", attributes: {}, content: null, children: [] },
        { name: "constructor", attributes: {}, content: null, children: [] },
      ],
      { onUnrendered: (block) => unrendered.push(block.name) },
    ),
  ).toBe("");
  expect(unrendered).toEqual(["toString", "constructor"]);
});
