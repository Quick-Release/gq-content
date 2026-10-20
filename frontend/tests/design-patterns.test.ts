// GQ Design's Header & Footer at the package seam: which route a page is
// served with, the patterns read and stored with the chrome, the classic
// chrome kept where there is none, rendering, and the refresh that follows a
// change.
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  designMenuItems,
  designRouteKey,
  renderSiteFooter,
  renderSiteHeader,
  renderWordPressBlocks,
  type BlockRenderer,
  type DesignRouteContent,
  type DesignRouteKey,
  type SiteChrome,
} from "@getquick/content";
import { createContentRuntime } from "@getquick/content/server";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";
import {
  chrome as classicChrome,
  data,
  queries,
  routes,
  stubWordPress,
  type Answer,
  type Handler,
} from "./support/wordpress-stub";

const SITE = "Acme";
const TOKEN = "design-patterns-refresh-token-0123456789abcdef";
const SECRET = "design-patterns-event-secret-0123456789abcdef";
let db: TestD1;
const api = () =>
  createContentRuntime({
    site: SITE,
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    isServer: () => true,
    bindings: () => ({
      PUBLICATION_DB: db,
      FRONTEND_REFRESH_TOKEN: TOKEN,
      PUBLICATION_EVENT_SECRET: SECRET,
    }),
  });

const presets = { colors: [], spacingSizes: [] };
const home = () =>
  data({
    generalSettings: { title: "Acme", description: "Things" },
    nodeByUri: { __typename: "Page", isFrontPage: true, title: "Home", content: "<h1>Hi</h1>" },
    designTokens: presets,
  });
const entry = ({ uri }: Record<string, unknown>) => {
  const fields = {
    title: "Entry",
    content: "<p>Body</p>",
    status: "publish",
    isRestricted: false,
    featuredImage: null,
  };
  if (uri === "/news/launch/")
    return data({
      postBy: { ...fields, id: "post-1", uri, excerpt: "", date: "2026-10-01T09:00:00" },
      pageBy: null,
      designTokens: presets,
    });
  if (uri === "/blog/")
    return data({
      postBy: null,
      pageBy: { ...fields, id: "page-2", uri, isPostsPage: true },
      designTokens: presets,
    });
  return data({
    postBy: null,
    pageBy: { ...fields, id: "page-1", uri, isPostsPage: false },
    designTokens: presets,
  });
};

/** A GQ Design layout node, as `blocksJson` lists it. */
const node = (
  name: string,
  attributes: Record<string, unknown> = {},
  content: string | null = null,
  children: unknown[] = [],
  supported = true,
) => ({ name, attributes, content, children, supported });

const menuItems = [
  { id: 41, parentId: 0, label: "About", url: "/about/", target: "" },
  { id: 42, parentId: 41, label: "Team", url: "https://example.org/team", target: "_blank" },
  { id: 43, parentId: 0, label: "Bad", url: "javascript:alert(1)", target: "" },
];

/** nomia-bnq's Header navigation pattern: a container and its Site navigation block. */
const navigationPattern = (items: unknown[] = menuItems) => ({
  title: "Header navigation",
  blocksJson: JSON.stringify([
    node("getquick-design/container", {}, null, [
      node("core/paragraph", {}, '<p class="tagline">Acme</p>'),
      node("getquick/header-navigation", { menuId: 7, menuItems: items }),
    ]),
  ]),
});
const footerPattern = {
  title: "Footer",
  blocksJson: JSON.stringify([node("core/paragraph", {}, "<p>© Acme</p>")]),
};

/** The chrome WordPress answers, with each route's selection (`header_single_post`, …). */
function designedChrome(patterns: Record<string, unknown>) {
  return data({ ...classicChrome, ...patterns });
}

/** Every route's region unselected: GQ Design 0.4 with only template parts. */
const unselected = Object.fromEntries(
  ["front_page", "home", "single_post", "page", "single", "archive", "search"].flatMap((route) => [
    [`header_${route}`, null],
    [`footer_${route}`, null],
  ]),
);

function wordpress(chrome: Handler) {
  return stubWordPress({
    home,
    entry,
    chrome,
    design: () => data({ designTokens: presets }),
    routes: () => routes("/", "/about/", "/news/launch/", "/blog/"),
  });
}

async function refresh() {
  const response = await api().handleRefresh(
    new Request("https://acme.test/gq/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: "{}",
    }),
    { siteOrigin: "https://acme.test" },
  );
  return { status: response.status, report: await response.json() };
}

/** A settings event, signed as the Site's CMS signs it. */
async function settingsEvent(setting: string) {
  const body = JSON.stringify({
    site: SITE,
    id: randomUUID(),
    action: "settings",
    occurredAt: Date.now(),
    setting,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await api().handleEvent(
    new Request("https://acme.test/gq/events", {
      method: "POST",
      headers: {
        "Content-Type": "application/json",
        "GQ-Event-Timestamp": String(timestamp),
        "GQ-Event-Signature": `v1=${createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex")}`,
      },
      body,
    }),
    { siteOrigin: "https://acme.test" },
  );
  return { status: response.status, body: await response.json() };
}

async function chromeAt(path: string): Promise<SiteChrome | null> {
  const delivery = path === "/" ? await api().publishedHome() : await api().publishedEntry(path);
  if (delivery.kind === "moved") throw new Error(`${path} moved`);
  if (delivery.kind === "unavailable") throw new Error(`${path} isn't served`);
  return delivery.kind === "found" ? delivery.content.chrome : delivery.chrome;
}

/** A Site renderer for its navigation block, as a Site's own would draw it. */
const navigation: BlockRenderer = (block) =>
  `<nav class="acme-nav"><ul>${designMenuItems(block.attributes?.menuItems)
    .map(
      (item) =>
        `<li><a href="${item.href}">${item.label}</a>${item.children.length ? `<ul>${item.children.map((child) => `<li><a href="${child.href}">${child.label}</a></li>`).join("")}</ul>` : ""}</li>`,
    )
    .join("")}</ul></nav>`;
const renderers = { "getquick/header-navigation": navigation };

beforeEach(() => {
  db = openTestD1();
  vi.spyOn(console, "error").mockImplementation(() => {});
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "warn").mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test.each<[DesignRouteContent, DesignRouteKey]>([
  [{ kind: "front-page" }, "front-page"],
  [{ kind: "entry", postType: "page", isFrontPage: true }, "front-page"],
  [{ kind: "entry", postType: "page", isPostsPage: true }, "home"],
  [{ kind: "entry", postType: "post" }, "single-post"],
  [{ kind: "entry", postType: "page" }, "page"],
  [{ kind: "entry", postType: "project" }, "single"],
  [{ kind: "entry", postType: "product" }, "single"],
  [{ kind: "archive" }, "archive"],
  [{ kind: "search" }, "search"],
  [{ kind: "not-found" }, "page"],
])("%j is served with the %s design route", (content, key) => {
  expect(designRouteKey(content)).toBe(key);
});

test("each page is served from the store with its own route's header and footer, through an outage", async () => {
  const fetch = wordpress(() =>
    designedChrome({
      ...unselected,
      header_single_post: navigationPattern(),
      footer_single_post: footerPattern,
      footer_page: footerPattern,
    }),
  );
  expect(await refresh()).toMatchObject({ status: 200, report: { ready: true } });
  // Every route's selection in the one chrome read.
  const [, init] = queries(fetch, "SiteChrome")[0]!;
  const text = JSON.parse(init.body as string).query as string;
  for (const route of ["front-page", "home", "single-post", "page", "single", "archive", "search"])
    for (const slot of ["header", "footer"])
      expect(text).toContain(`designPattern(template: "${route}", slot: "${slot}")`);

  stubWordPress({}).mockRejectedValue(new TypeError("fetch failed"));
  const post = await chromeAt("/news/launch/");
  expect(post?.header?.title).toBe("Header navigation");
  expect(post?.footer?.title).toBe("Footer");
  expect(post?.designPatterns).toBeUndefined();
  expect(post?.menuItems).toEqual([
    { id: "a", label: "About us", href: "/about/", target: null, children: [] },
  ]);
  // A page has only `page`'s footer; the front page and the posts page have neither.
  const page = await chromeAt("/about/");
  expect(page?.header).toBeUndefined();
  expect(page?.footer?.title).toBe("Footer");
  expect((await chromeAt("/"))?.header).toBeUndefined();
  expect((await chromeAt("/blog/"))?.footer).toBeUndefined();
  // A page the Site adds itself chooses its route.
  expect((await api().pageChrome("https://acme.test", "single-post"))?.header?.title).toBe(
    "Header navigation",
  );
  expect((await api().pageChrome("https://acme.test"))?.header).toBeUndefined();
  expect((await api().pageChrome("https://acme.test"))?.footer?.title).toBe("Footer");
  // A 404 is served with `page`'s: its footer, and no header.
  stubWordPress({ entry: () => data({ postBy: null, pageBy: null, designTokens: presets }) });
  const missing = await chromeAt("/missing/");
  expect(missing?.footer?.title).toBe("Footer");
  expect(missing?.header).toBeUndefined();
});

test("a Site renders its own block in a pattern exactly as in content", async () => {
  wordpress(() => designedChrome({ header_single_post: navigationPattern() }));
  await refresh();
  const chrome = await chromeAt("/news/launch/");
  expect(renderSiteHeader(chrome, { renderers })).toBe(
    '<header class="gq-site-header"><div class="wp-block-getquick-design-container">' +
      '<p class="tagline">Acme</p>' +
      '<nav class="acme-nav"><ul><li><a href="/about/">About</a><ul><li><a href="https://example.org/team">Team</a></li></ul></li><li><a href="#">Bad</a></li></ul></nav>' +
      "</div></header>",
  );
  // The block as content carries it renders to the same HTML by the same renderer.
  const inContent = {
    name: "getquick/header-navigation",
    attributes: { menuId: 7, menuItems },
    htmlContent: "",
    innerBlocks: [],
  };
  const header = chrome!.header!.blocks[0]!.innerBlocks![1]!;
  expect(renderWordPressBlocks([header], { renderers })).toBe(
    renderWordPressBlocks([inContent], { renderers }),
  );
  // Without the Site's renderer it renders as content renders it: its saved HTML, none.
  expect(renderWordPressBlocks([header])).toBe(renderWordPressBlocks([inContent]));
  expect(renderSiteFooter(chrome)).toBeNull();
});

test.each<[string, () => Answer]>([
  ["no route has a pattern", () => designedChrome(unselected)],
  ["the CMS answers without the field", () => data(classicChrome)],
])("when %s, the chrome is today's logo and primary menu, unchanged", async (_case, answer) => {
  wordpress(answer);
  expect(await refresh()).toMatchObject({ status: 200, report: { ready: true } });
  const classic = {
    menuItems: [{ id: "a", label: "About us", href: "/about/", target: null, children: [] }],
    siteIcon: null,
    siteLogo: { sourceUrl: "https://media.example/logo.svg", altText: "Acme" },
  };
  for (const path of ["/", "/about/", "/news/launch/", "/missing/"]) {
    expect(await chromeAt(path)).toStrictEqual(classic);
    expect(renderSiteHeader(await chromeAt(path))).toBeNull();
    expect(renderSiteFooter(await chromeAt(path))).toBeNull();
  }
  const stored = await db
    .prepare("SELECT body FROM publications WHERE key = 'chrome'")
    .first<{ body: string }>();
  expect(JSON.parse(stored!.body)).toStrictEqual(classic);
});

test("a CMS without GQ Design's designPattern field is read again without it, for today's chrome", async () => {
  let calls = 0;
  const fetch = wordpress((): Answer => {
    calls += 1;
    if (calls === 1)
      return {
        ok: true,
        json: async () => ({
          errors: [
            {
              message:
                'Cannot query field "designPattern" on type "RootQuery". Did you mean "designTokens"?',
            },
          ],
        }),
      };
    return data(classicChrome);
  });
  expect(await refresh()).toMatchObject({
    status: 200,
    report: { ready: true, chrome: { outcome: "promoted" } },
  });
  const reads = queries(fetch, "SiteChrome").map(
    ([, init]) => JSON.parse(init.body as string) as { query: string; variables: unknown },
  );
  expect(reads).toHaveLength(2);
  expect(reads[0]!.query).toContain("designPattern");
  expect(reads[1]!.query).not.toContain("designPattern");
  expect(reads[1]!.variables).toEqual({ location: "PRIMARY" });
  expect((await chromeAt("/news/launch/"))?.header).toBeUndefined();
  expect((await chromeAt("/news/launch/"))?.menuItems).toHaveLength(1);
});

test("a pattern GQ Design couldn't resolve, or any other failed read, keeps the stored header", async () => {
  wordpress(() => designedChrome({ header_single_post: navigationPattern() }));
  await refresh();
  for (const failed of [
    () => designedChrome({ header_single_post: { title: "Broken", blocksJson: "[]" } }),
    () => designedChrome({ header_single_post: { title: "Broken", blocksJson: "{" } }),
    (): Answer => ({ ok: true, json: async () => ({ errors: [{ message: "Internal error" }] }) }),
  ]) {
    wordpress(failed);
    expect(await settingsEvent("patterns")).toMatchObject({
      status: 503,
      body: { status: "failed" },
    });
    expect((await chromeAt("/news/launch/"))?.header?.title).toBe("Header navigation");
  }
});

test.each([
  ["a pattern or its route assignment", "patterns"],
  ["a menu a pattern shows", "patterns"],
  ["the primary menu", "menus"],
])(
  "a change to %s refreshes the chrome's patterns for every page, reading nothing else",
  async (_change, setting) => {
    wordpress(() => designedChrome({ header_single_post: navigationPattern() }));
    await refresh();
    const changed = [{ id: 51, parentId: 0, label: "Contact", url: "/contact/", target: "" }];
    const fetch = wordpress(() =>
      designedChrome({
        header_single_post: navigationPattern(changed),
        header_page: navigationPattern(changed),
      }),
    );
    expect(await settingsEvent(setting)).toMatchObject({
      status: 200,
      body: { status: "refreshed" },
    });
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(queries(fetch, "SiteChrome")).toHaveLength(1);
    for (const path of ["/news/launch/", "/about/"]) {
      expect(renderSiteHeader(await chromeAt(path), { renderers })).toContain(
        '<a href="/contact/">Contact</a>',
      );
    }
  },
);

test("an entry stored before its route was recorded is served with a post's or a page's", async () => {
  wordpress(() =>
    designedChrome({ header_single_post: navigationPattern(), header_page: footerPattern }),
  );
  await refresh();
  for (const key of ["entry:/news/launch/", "entry:/about/"]) {
    const row = await db
      .prepare("SELECT body FROM publications WHERE key = ?")
      .bind(key)
      .first<{ body: string }>();
    const { designRoute, ...older } = JSON.parse(row!.body) as Record<string, unknown>;
    expect(designRoute).toBe(key === "entry:/about/" ? "page" : "single-post");
    await db
      .prepare("UPDATE publications SET body = ? WHERE key = ?")
      .bind(JSON.stringify(older), key)
      .run();
  }
  expect((await chromeAt("/news/launch/"))?.header?.title).toBe("Header navigation");
  expect((await chromeAt("/about/"))?.header?.title).toBe("Footer");
});

test("a menu-backed block's items become the chrome's menu tree, with unsafe links neutralised", () => {
  expect(
    designMenuItems([
      ...menuItems,
      { id: 44, parentId: 99, label: "Orphan", url: "mailto:a@b.c", target: "_self" },
      { id: 45, parentId: 0, label: "", url: "/empty/" },
      "not an item",
    ]),
  ).toEqual([
    {
      id: "41",
      label: "About",
      href: "/about/",
      target: null,
      children: [
        {
          id: "42",
          label: "Team",
          href: "https://example.org/team",
          target: "_blank",
          children: [],
        },
      ],
    },
    { id: "43", label: "Bad", href: "#", target: null, children: [] },
    { id: "44", label: "Orphan", href: "mailto:a@b.c", target: null, children: [] },
  ]);
  expect(designMenuItems(undefined)).toEqual([]);
});
