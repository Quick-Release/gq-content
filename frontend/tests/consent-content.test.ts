// The content runtime with CONSENT-1 configured: embeds rewritten at the one
// delivery step (#20, #21, #25), the Legal Contract and GA4 settings delivered
// through `legal`/`analytics` settings events into every language's chrome
// (#24, #27), and the visitor path staying D1-only.
import { createContentRuntime } from "@getquick/content/server";
import { scanConsentHtml } from "@getquick/content/consent/testing";
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";
import {
  chrome,
  data,
  queries,
  routes,
  stubWordPress,
  type Handler,
} from "./support/wordpress-stub";

const SECRET = "consent-proof-event-key-0123456789abcdef";
const TOKEN = "consent-proof-refresh-key-0123456789abcdef";
const youtube =
  '<figure class="wp-block-embed"><div class="wp-block-embed__wrapper"><iframe title="Clip" src="https://www.youtube.com/embed/abcdefghijk?feature=oembed"></iframe></div></figure>';
const unknown = '<iframe src="https://tracker.example/frame"></iframe>';
const site = { siteOrigin: "https://site.test", firstPartyHosts: ["cms.test"] };
let db: TestD1;
let api: ReturnType<typeof createContentRuntime>;
let legal: Record<string, unknown>;
let analytics: { enabled: boolean; measurementId: string | null };

const entries: Record<string, unknown> = {
  "/sobre/": {
    id: "p1",
    title: "Sobre",
    content: `<p>Vídeo</p>${youtube}${unknown}`,
    uri: "/sobre/",
    status: "publish",
    isRestricted: false,
    featuredImage: null,
    language: { slug: "pt" },
    translations: [{ uri: "/en/about/", language: { slug: "en" } }],
  },
  "/en/about/": {
    id: "p2",
    title: "About",
    content: `<p>Video</p>${youtube}`,
    uri: "/en/about/",
    status: "publish",
    isRestricted: false,
    featuredImage: null,
    language: { slug: "en" },
    translations: [{ uri: "/sobre/", language: { slug: "pt" } }],
  },
};
const contract = (language: string | null) => {
  const roles = (legal.roles as Array<Record<string, unknown>>).map((role) => ({
    ...role,
    url: language === "en" ? `/en${role.url as string}` : role.url,
    isFallback: language === "en" && role.role === "privacy_policy",
  }));
  return { ...legal, roles };
};
const handlers = {
  home: (v) =>
    data({
      [v.language ? "language" : "generalSettings"]: { title: "Home", description: "" },
      nodeByUri: {
        __typename: "Page",
        id: `front-${(v.language as string | undefined) ?? "pt"}`,
        isFrontPage: true,
        title: "Home",
        content: `<h1>Olá</h1>${youtube}`,
      },
      designTokens: { colors: [], spacingSizes: [] },
    }),
  chrome: () => data(chrome),
  entry: (v) =>
    data({
      pageBy: entries[v.uri as string] ?? null,
      postBy: null,
      designTokens: { colors: [], spacingSizes: [] },
    }),
  design: () => data({ designTokens: { colors: [], spacingSizes: [] } }),
  routes: () => routes("/", "/en/", ...Object.keys(entries)),
  consent: (v) =>
    data({ getquickLegal: contract(v.language as string | null), googleAnalytics: analytics }),
} satisfies Record<string, Handler>;
const wordpress = () => stubWordPress(handlers);
const offline = () => {
  const fail = () => {
    throw new TypeError("offline");
  };
  return stubWordPress({
    home: fail,
    chrome: fail,
    entry: fail,
    design: fail,
    routes: fail,
    consent: fail,
  });
};

async function deliver(setting: string) {
  const body = JSON.stringify({
    site: "Acme",
    id: randomUUID(),
    occurredAt: Date.now(),
    action: "settings",
    setting,
  });
  const timestamp = Math.floor(Date.now() / 1000);
  const response = await api.handleEvent(
    new Request("https://site.test/gq/events", {
      method: "POST",
      headers: {
        "GQ-Event-Timestamp": String(timestamp),
        "GQ-Event-Signature": `v1=${createHmac("sha256", SECRET).update(`${timestamp}.${body}`).digest("hex")}`,
      },
      body,
    }),
  );
  return { status: response.status, body: (await response.json()) as Record<string, unknown> };
}

async function refresh() {
  const response = await api.handleRefresh(
    new Request("https://site.test/gq/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: "{}",
    }),
  );
  expect(response.status).toBe(200);
}

function runtime(consent?: Parameters<typeof createContentRuntime>[0]["consent"]) {
  return createContentRuntime({
    site: "Acme",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    wordpress: { locale: "pt_PT_ao90", languages: [{ locale: "en_US", slug: "en" }] },
    isServer: () => true,
    bindings: () => ({
      PUBLICATION_DB: db,
      PUBLICATION_EVENT_SECRET: SECRET,
      FRONTEND_REFRESH_TOKEN: TOKEN,
    }),
    ...(consent ? { consent } : {}),
  });
}

beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-22T10:00:00Z"));
  db = openTestD1();
  legal = {
    schemaVersion: 1,
    controller: { name: "Acme, Lda.", privacyEmail: "privacy@acme.test", dpoContact: null },
    roles: [
      {
        role: "privacy_policy",
        url: "/privacidade/",
        title: "Privacidade",
        revision: "2026-10-01T09:00:00",
        isFallback: false,
      },
      {
        role: "cookie_policy",
        url: "/cookies/",
        title: null,
        revision: "2026-10-02T09:00:00",
        isFallback: false,
      },
    ],
    missingRequired: [],
  };
  analytics = { enabled: false, measurementId: "G-ABC1234" };
  api = runtime({ services: ["youtube"], cmsSettings: true });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("stored and cold-looked-up bodies reach the Frontend without live third-party src", async () => {
  wordpress();
  await refresh();
  const fetch = offline();
  const home = await api.publishedHome();
  const entry = await api.publishedEntry("/sobre/");
  expect(home.kind).toBe("found");
  expect(entry.kind).toBe("found");
  if (home.kind !== "found" || entry.kind !== "found") return;
  expect(scanConsentHtml(home.content.home.page.content, site).liveThirdParty).toEqual([]);
  const scan = scanConsentHtml(entry.content.entry.content, site);
  expect(scan.liveThirdParty).toEqual([]);
  expect(scan.placeholders).toEqual(["youtube"]);
  expect(scan.blocked).toEqual([{ host: "tracker.example", tag: "iframe" }]);
  // Placeholders follow the entry's language.
  expect(entry.content.entry.content).toContain("Carregar uma vez");
  expect(fetch).not.toHaveBeenCalled();
  // The publication store keeps what WordPress published.
  const stored = await db
    .prepare("SELECT body FROM publications WHERE key = 'entry:/sobre/'")
    .first();
  expect(String(stored?.body)).toContain("https://www.youtube.com/embed/abcdefghijk");

  // A cold lookup passes through the same step.
  db.exec("DELETE FROM publications WHERE key = 'entry:/en/about/'");
  wordpress();
  const cold = await api.publishedEntry("/en/about/");
  expect(
    cold.kind === "found" && scanConsentHtml(cold.content.entry.content, site).placeholders,
  ).toEqual(["youtube"]);
  expect(cold.kind === "found" && cold.content.entry.content).toContain("Load once");
});

test("a legal event refreshes every language's chrome; visitors read D1 only; outages keep it", async () => {
  wordpress();
  await refresh();
  let fetch = offline();
  const pt = await api.publishedHome();
  const en = await api.publishedHome(undefined, api.languages[1]);
  expect(pt.kind === "found" && pt.content.chrome.legal?.roles.map((r) => r.url)).toEqual([
    "/privacidade/",
    "/cookies/",
  ]);
  expect(
    en.kind === "found" && en.content.chrome.legal?.roles.map((r) => [r.url, r.isFallback]),
  ).toEqual([
    ["/en/privacidade/", true],
    ["/en/cookies/", false],
  ]);
  expect(fetch).not.toHaveBeenCalled();

  (legal.roles as Array<Record<string, unknown>>).push({
    role: "terms_of_use",
    url: "/termos/",
    title: "Termos",
    revision: "1",
    isFallback: false,
  });
  vi.setSystemTime(Date.now() + 1000);
  fetch = wordpress();
  const changed = await deliver("legal");
  expect(changed.status).toBe(200);
  expect(changed.body).toMatchObject({ status: "refreshed", setting: "legal" });
  expect(
    queries(fetch, "ConsentSettings").map(([, init]) => JSON.parse(init.body as string).variables),
  ).toEqual(expect.arrayContaining([{ language: "pt" }, { language: "en" }]));
  expect(queries(fetch, "EntryByUri")).toEqual([]);

  fetch = offline();
  const entryEn = await api.publishedEntry("/en/about/");
  expect(
    entryEn.kind === "found" && entryEn.content.chrome.legal?.roles.map((r) => r.role),
  ).toEqual(["privacy_policy", "cookie_policy", "terms_of_use"]);
  // A failed legal refresh keeps the last stored values.
  vi.setSystemTime(Date.now() + 1000);
  expect((await deliver("legal")).status).toBe(503);
  const still = await api.publishedEntry("/sobre/");
  expect(still.kind === "found" && still.content.chrome.legal?.roles).toHaveLength(3);
  expect(fetch).toHaveBeenCalled();
});

test("GA4 becomes active only with gq-config's toggle; the configuration version follows", async () => {
  wordpress();
  await refresh();
  const before = await api.publishedHome();
  if (before.kind !== "found") throw new Error("home missing");
  const off = api.consentConfiguration(before.content.chrome)!;
  expect(off.services).toEqual(["consent", "youtube"]);
  analytics = { enabled: true, measurementId: "G-ABC1234" };
  vi.setSystemTime(Date.now() + 1000);
  wordpress();
  expect((await deliver("analytics")).status).toBe(200);
  offline();
  const after = await api.publishedHome();
  if (after.kind !== "found") throw new Error("home missing");
  const on = api.consentConfiguration(after.content.chrome)!;
  expect(on.services).toEqual(["consent", "ga4", "youtube"]);
  expect(on.measurementId).toBe("G-ABC1234");
  expect(on.version).not.toBe(off.version);
});

test("without consent configured, bodies and chrome are delivered as before", async () => {
  api = runtime();
  const fetch = wordpress();
  await refresh();
  expect(queries(fetch, "ConsentSettings")).toEqual([]);
  offline();
  const entry = await api.publishedEntry("/sobre/");
  expect(entry.kind === "found" && entry.content.entry.content).toBe(
    `<p>Vídeo</p>${youtube}${unknown}`,
  );
  expect(entry.kind === "found" && "legal" in entry.content.chrome).toBe(false);
  expect(api.consentConfiguration(null)).toBeNull();
});

test("review: a gq-config without consent settings doesn't block chrome refreshes", async () => {
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  stubWordPress({
    ...handlers,
    consent: () => ({
      ok: true,
      json: async () => ({
        errors: [{ message: 'Cannot query field "getquickLegal" on type "RootQuery".' }],
      }),
    }),
  });
  await refresh();
  offline();
  const home = await api.publishedHome();
  expect(home.kind === "found" && home.content.chrome.menuItems.length).toBe(1);
  expect(home.kind === "found" && home.content.chrome.legal).toBeNull();
  expect(home.kind === "found" && home.content.chrome.analytics).toEqual({
    enabled: false,
    measurementId: null,
  });
  expect(warn).toHaveBeenCalled();
  stubWordPress({
    ...handlers,
    consent: () => data({ getquickLegal: null, googleAnalytics: null }),
  });
  vi.setSystemTime(Date.now() + 1000);
  expect((await deliver("analytics")).status).toBe(200);
});

test("an embed in a footer pattern is held back until consent, in every way the chrome is served", async () => {
  const footer = {
    title: "Main footer",
    blocksJson: JSON.stringify([
      {
        name: "core/group",
        attributes: {},
        content: null,
        children: [
          { name: "core/paragraph", attributes: {}, content: "<p>Veja</p>", children: [] },
          { name: "core/embed", attributes: {}, content: youtube, children: [] },
          { name: "core/html", attributes: {}, content: unknown, children: [] },
        ],
      },
    ]),
  };
  stubWordPress({ ...handlers, chrome: () => data({ ...chrome, footer }) });
  await refresh();
  // A route WordPress doesn't have: a 404 page, served with the chrome.
  const missing = await api.publishedEntry("/nowhere/");
  const fetch = offline();
  const rendered = (value: { footer: Parameters<typeof api.renderDesignPattern>[0] } | null) =>
    api.renderDesignPattern(value?.footer);
  const home = await api.publishedHome();
  const en = await api.publishedEntry("/en/about/");
  const page = await api.pageChrome();
  expect(home.kind).toBe("found");
  expect(en.kind).toBe("found");
  expect(missing.kind).toBe("missing");
  if (home.kind !== "found" || en.kind !== "found" || missing.kind !== "missing") return;
  for (const html of [
    rendered(home.content.chrome),
    rendered(en.content.chrome),
    rendered(missing.chrome),
    rendered(page),
  ]) {
    const scan = scanConsentHtml(html, site);
    expect(scan.liveThirdParty).toEqual([]);
    expect(scan.placeholders).toEqual(["youtube"]);
    expect(scan.blocked).toEqual([{ host: "tracker.example", tag: "iframe" }]);
    expect(html).toMatch(/<p[^>]*>Veja<\/p>/);
  }
  // Placeholders follow the language the chrome is served in.
  expect(rendered(home.content.chrome)).toContain("Carregar uma vez");
  expect(rendered(en.content.chrome)).toContain("Load once");
  expect(fetch).not.toHaveBeenCalled();
  // The store keeps the pattern as published.
  const stored = await db.prepare("SELECT body FROM publications WHERE key = 'chrome'").first();
  expect(String(stored?.body)).toContain("https://www.youtube.com/embed/abcdefghijk");

  // Without consent configured, the pattern is delivered as published.
  api = runtime();
  const plain = await api.publishedHome();
  expect(plain.kind === "found" && rendered(plain.content.chrome)).toContain(
    'src="https://www.youtube.com/embed/abcdefghijk',
  );
});

test("canonical publication trees are consent-gated before preloaded Post Content rendering", async () => {
  const original = entries["/sobre/"];
  entries["/sobre/"] = {
    ...(original as Record<string, unknown>),
    databaseId: 17,
    // Deliberate content-boundary variant: the canonical tree has raw media,
    // independently of the rendered body. The store must retain that source.
    getquickBlocksJson: JSON.stringify([
      { name: "core/paragraph", attributes: {}, content: youtube, children: [], supported: true },
    ]),
  };
  try {
    wordpress();
    await refresh();
    const fetch = offline();
    const delivered = await api.publishedEntry("/sobre/");
    if (delivered.kind !== "found") throw new Error("Missing canonical publication");
    const blocks = delivered.content.entry.designBlocks;
    expect(blocks).toBeDefined();
    const html = api.renderDesignPattern(blocks);
    expect(scanConsentHtml(html, site).liveThirdParty).toEqual([]);
    expect(scanConsentHtml(html, site).placeholders).toEqual(["youtube"]);
    expect(fetch).not.toHaveBeenCalled();
    const stored = await db
      .prepare("SELECT body FROM publications WHERE key = 'entry:/sobre/'")
      .first();
    const raw = JSON.parse(String(stored?.body));
    expect(raw.designBlocks[0].content).toContain(
      '<iframe title="Clip" src="https://www.youtube.com/',
    );
  } finally {
    entries["/sobre/"] = original;
  }
});

test("ordinary stored WordPress Navigation HTML gains shared lifecycle without a consent configuration", async () => {
  const { readFileSync } = await import("node:fs");
  const original = entries["/sobre/"];
  const source = readFileSync(
    new URL("./fixtures/navigation/producer/rendered.html", import.meta.url),
    "utf8",
  );
  entries["/sobre/"] = { ...(original as Record<string, unknown>), content: source };
  try {
    api = runtime();
    wordpress();
    await refresh();
    offline();
    const delivered = await api.publishedEntry("/sobre/");
    if (delivered.kind !== "found") throw new Error("Missing published Navigation");
    expect(delivered.content.entry.content).toContain("data-gqd-navigation");
    expect(delivered.content.entry.content).toContain("Products");
    expect(delivered.content.entry.content).toContain("Shop");
    expect(delivered.content.entry.content).toContain("data-gqd-submenu");
    const stored = await db
      .prepare("SELECT body FROM publications WHERE key = 'entry:/sobre/'")
      .first();
    expect(JSON.parse(String(stored?.body)).content).toBe(source);
  } finally {
    entries["/sobre/"] = original;
  }
});
