// Source settings/languages/language-updates runtime assertions at the configured package seam.
import { createContentRuntime } from "@getquick/content/server";
import { htmlLang } from "@getquick/content";
import { createHmac, randomUUID } from "node:crypto";
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";
import {
  data,
  httpError,
  queries,
  routes,
  stubWordPress,
  timeout,
  type Handler,
} from "./support/wordpress-stub";

const SECRET = "settings-proof-event-key-0123456789abcdef";
const TOKEN = "settings-proof-refresh-key-0123456789abcdef";
let db: TestD1;
let api: ReturnType<typeof createContentRuntime>;
let color: string;
let logo: string;
let icon: string;
let fronts: Record<string, { title: string; description: string; content: string; menu: string }>;
const entries = {
  "/sobre/": {
    id: "p1",
    title: "Sobre",
    content: "<p>Coisas</p>",
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
    content: "<p>Things</p>",
    uri: "/en/about/",
    status: "publish",
    isRestricted: false,
    featuredImage: null,
    language: { slug: "en" },
    translations: [{ uri: "/sobre/", language: { slug: "pt" } }],
  },
};
const presets = () => ({ colors: [{ slug: "brand", color }], spacingSizes: [] });
const handlers = {
  home: (v) => {
    const lang = v.language === "EN" ? "en" : "pt";
    const front = fronts[lang]!;
    return data({
      [v.language ? "language" : "generalSettings"]: {
        title: front.title,
        description: front.description,
      },
      nodeByUri: {
        __typename: "Page",
        id: `front-${lang}`,
        isFrontPage: true,
        title: front.title,
        content: front.content,
      },
      designTokens: presets(),
    });
  },
  chrome: (v) =>
    data({
      generalSettings: {
        siteLogo: { node: { sourceUrl: logo, altText: "Logo" } },
        siteIcon: { node: { sourceUrl: icon, altText: "" } },
      },
      menuItems: {
        nodes: [
          {
            id: "menu",
            parentId: null,
            label: fronts[v.language === "EN" ? "en" : "pt"]!.menu,
            url: v.language === "EN" ? "/en/about/" : "/sobre/",
            target: null,
          },
        ],
      },
    }),
  entry: (v) =>
    data({
      pageBy: entries[v.uri as keyof typeof entries] ?? null,
      postBy: null,
      designTokens: presets(),
    }),
  design: () => data({ designTokens: presets() }),
  routes: () => routes("/", "/en/", ...Object.keys(entries)),
} satisfies Record<string, Handler>;
const wordpress = (overrides: Partial<Record<keyof typeof handlers, Handler>> = {}) =>
  stubWordPress({ ...handlers, ...overrides });
const offline = () => {
  const fail = () => {
    throw new TypeError("offline");
  };
  return stubWordPress({ home: fail, chrome: fail, entry: fail, design: fail, routes: fail });
};
const variables = (fetch: ReturnType<typeof stubWordPress>, name: string) =>
  queries(fetch, name).map(([, init]) => JSON.parse(init.body as string).variables);
function event(fields: Record<string, unknown>) {
  return {
    site: "Settings / Á",
    id: randomUUID(),
    occurredAt: Date.now(),
    action: "settings",
    ...fields,
  };
}
async function deliver(value: unknown, secret = SECRET) {
  const body = JSON.stringify(value),
    timestamp = Math.floor(Date.now() / 1000);
  const response = await api.handleEvent(
    new Request("https://site.test/gq/events", {
      method: "POST",
      headers: {
        "GQ-Event-Timestamp": String(timestamp),
        "GQ-Event-Signature": `v1=${createHmac("sha256", secret).update(`${timestamp}.${body}`).digest("hex")}`,
      },
      body,
    }),
  );
  expect(response.headers.get("Cache-Control")).toBe("no-store");
  return { status: response.status, body: await response.json() };
}
const refresh = async () => {
  const r = await api.handleRefresh(
    new Request("https://site.test/gq/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: "{}",
    }),
  );
  return { status: r.status, body: await r.json() };
};
const home = async (slug = "pt") => {
  const r = await api.publishedHome(
    undefined,
    api.languages.find((l) => l.slug === slug),
  );
  expect(r.kind).toBe("found");
  if (r.kind !== "found") throw new Error("home missing");
  return r.content;
};
const entry = async (path = "/en/about/") => {
  const r = await api.publishedEntry(path);
  expect(r.kind).toBe("found");
  if (r.kind !== "found") throw new Error("entry missing");
  return r.content;
};
async function prepare() {
  wordpress();
  expect((await refresh()).status).toBe(200);
}
beforeEach(() => {
  vi.useFakeTimers({ toFake: ["Date"] });
  vi.setSystemTime(new Date("2026-10-18T10:00:00Z"));
  db = openTestD1();
  color = "#c00";
  logo = "https://media.test/logo.svg";
  icon = "https://media.test/icon.png";
  fronts = {
    pt: {
      title: "Início",
      description: "Coisas",
      content: "<h1>Bem-vindo</h1>",
      menu: "Sobre nós",
    },
    en: { title: "Home", description: "Things", content: "<h1>Welcome</h1>", menu: "About us" },
  };
  api = createContentRuntime({
    site: "Settings / Á",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    wordpress: { locale: "pt_PT_ao90", languages: [{ locale: "en_US", slug: "en" }] },
    isServer: () => true,
    bindings: () => ({
      PUBLICATION_DB: db,
      PUBLICATION_EVENT_SECRET: SECRET,
      FRONTEND_REFRESH_TOKEN: TOKEN,
    }),
  });
  vi.spyOn(console, "info").mockImplementation(() => {});
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => {
  db.close();
  vi.useRealTimers();
  vi.unstubAllGlobals();
  vi.restoreAllMocks();
});

test("each language's home, chrome, routes and alternates survive an outage with canonical language identities", async () => {
  await prepare();
  const fetch = offline();
  const pt = await home(),
    en = await home("en"),
    about = await entry(),
    sobre = await entry("/sobre/");
  expect(pt.home.page.content).toContain("Bem-vindo");
  expect(en.home.page.content).toContain("Welcome");
  expect(pt.chrome.menuItems[0]?.label).toBe("Sobre nós");
  expect(en.chrome.menuItems[0]?.label).toBe("About us");
  expect(en.home.settings.description).toBe("Things");
  expect(pt.home.settings.description).toBe("Coisas");
  expect(api.routeLanguage("/en/about/")).toBe(api.languages[1]);
  expect(api.defaultLanguage).toBe(api.languages[0]);
  expect(htmlLang(api.defaultLanguage.locale)).toBe("pt-PT");
  expect(api.isLanguageHome("/en/")).toBe(true);
  expect(about.alternates.map((a) => [a.language.slug, a.route, a.translation])).toEqual([
    ["pt", "/sobre/", true],
  ]);
  expect(sobre.alternates[0]?.language).toBe(api.languages[1]);
  expect(about.alternates[0]?.language).toBe(api.defaultLanguage);
  expect(en.alternates[0]?.language).toBe(api.defaultLanguage);
  expect(pt.alternates[0]?.language).toBe(api.languages[1]);
  expect(fetch).not.toHaveBeenCalled();
});

test.each(["menus", "logo", "identity", "design"])(
  "shared %s changes reach every stored page without republishing entries and persist through outage",
  async (setting) => {
    await prepare();
    vi.setSystemTime(Date.now() + 1000);
    fronts.pt!.menu = "Contacto";
    fronts.en!.menu = "Contact";
    logo = "https://media.test/new.svg";
    icon = "https://media.test/new.png";
    fronts.pt!.description = "Melhor";
    fronts.en!.description = "Better";
    color = "#0a0";
    const fetch = wordpress(),
      change = event({ setting });
    const r = await deliver(change);
    expect(r.status).toBe(200);
    expect(r.body).toMatchObject({ status: "refreshed", setting });
    expect(queries(fetch, "EntryByUri")).toEqual([]);
    expect(queries(fetch, "PublishedRoutes")).toEqual([]);
    offline();
    const pages = [await home(), await home("en"), await entry("/sobre/"), await entry()];
    for (const page of pages) {
      if (setting === "menus") expect(page.chrome.menuItems[0]?.label).toMatch(/Contact/);
      if (setting === "logo") expect(page.chrome.siteLogo?.sourceUrl).toBe(logo);
      if (setting === "identity") expect(page.chrome.siteIcon?.sourceUrl).toBe(icon);
      if (setting === "design")
        expect(("home" in page ? page.home : page.entry).colors).toEqual([
          { slug: "brand", color: "#0a0" },
        ]);
    }
    if (setting === "identity") expect((await home("en")).home.settings.description).toBe("Better");
    const duplicate = await deliver(change);
    expect(duplicate.body).toEqual({ event: change.id, status: "refreshed", duplicate: true });
  },
);

test.each(["menus", "logo", "identity", "design"])(
  "failed %s retains last-known-good settings and the same identity can retry successfully",
  async (setting) => {
    await prepare();
    color = "#0a0";
    fronts.en!.menu = "New";
    fronts.en!.description = "Better";
    logo = "https://media.test/new.svg";
    offline();
    const change = event({ setting });
    expect((await deliver(change)).status).toBe(503);
    expect((await entry()).chrome.menuItems[0]?.label).toBe("About us");
    expect((await home("en")).home.settings.description).toBe("Things");
    expect((await entry()).entry.colors[0]?.color).toBe("#c00");
    wordpress();
    expect((await deliver(change)).status).toBe(200);
    offline();
    expect((await deliver(change)).body.duplicate).toBe(true);
  },
);

test.each(["menus", "identity"])(
  "language-specific %s refreshes only its own subject and is ordered independently",
  async (setting) => {
    await prepare();
    vi.setSystemTime(Date.now() + 1000);
    fronts.en!.menu = "Who we are";
    fronts.en!.description = "Better things";
    const fetch = wordpress();
    expect((await deliver(event({ setting, language: "en" }))).status).toBe(200);
    expect(fetch).toHaveBeenCalledTimes(1);
    expect(variables(fetch, setting === "menus" ? "SiteChrome" : "HomePage")).toEqual([
      setting === "menus"
        ? { location: "PRIMARY", language: "EN" }
        : { uri: "/en/", language: "EN" },
    ]);
    offline();
    expect((await entry()).chrome.menuItems[0]?.label).toBe(
      setting === "menus" ? "Who we are" : "About us",
    );
    expect((await home("en")).home.settings.description).toBe(
      setting === "identity" ? "Better things" : "Things",
    );
    expect((await home()).home.settings.description).toBe("Coisas");
    expect((await entry("/sobre/")).chrome.menuItems[0]?.label).toBe("Sobre nós");
    wordpress();
    expect(
      (await deliver(event({ setting, language: "pt", occurredAt: Date.now() - 60000 }))).body
        .status,
    ).toBe("refreshed");
  },
);

test.each([
  { setting: "design", language: "en" },
  { setting: "logo", language: "en" },
  { setting: "menus", language: "fr" },
  { action: "publish", entry: { id: "p1", uri: "/sobre/", language: "en" } },
  { action: "withdraw", entry: { id: "p2", uri: "/en/about/", language: "pt" } },
])("invalid language subject %j is rejected before transport", async (fields) => {
  await prepare();
  const fetch = wordpress();
  expect((await deliver(event(fields))).status).toBe(400);
  expect(fetch).not.toHaveBeenCalled();
});

test("older settings cannot roll back newer settings", async () => {
  await prepare();
  vi.setSystemTime(Date.now() + 1000);
  const older = event({ setting: "menus", occurredAt: Date.now() - 60000 });
  fronts.en!.menu = "New";
  wordpress();
  const newer = event({ setting: "menus" });
  await deliver(newer);
  fronts.en!.menu = "Old";
  const fetch = wordpress();
  const r = await deliver(older);
  expect(r.body).toEqual({ event: older.id, status: "superseded", by: newer.id });
  expect(fetch).not.toHaveBeenCalled();
  expect((await entry()).chrome.menuItems[0]?.label).toBe("New");
});

test("partly failed identity refresh promotes home independently and completes on retry", async () => {
  await prepare();
  vi.setSystemTime(Date.now() + 1000);
  fronts.en!.description = "Better";
  icon = "https://media.test/new.png";
  wordpress({ chrome: () => httpError(503) });
  const change = event({ setting: "identity" });
  const r = await deliver(change);
  expect(r.status).toBe(503);
  expect(r.body.chrome.outcome).toBe("kept");
  expect((await home("en")).home.settings.description).toBe("Better");
  expect((await entry()).chrome.siteIcon?.sourceUrl).toBe("https://media.test/icon.png");
  wordpress();
  expect((await deliver(change)).status).toBe(200);
  expect((await entry()).chrome.siteIcon?.sourceUrl).toBe(icon);
});

test.each([
  ["timeout", timeout],
  ["http", () => httpError(502)],
  [
    "graphql",
    () => ({
      ok: true as const,
      json: async () => ({ data: { designTokens: null }, errors: [{ message: "Internal" }] }),
    }),
  ],
  ["schema", () => data({ designTokens: { colors: [{ slug: "brand" }], spacingSizes: [] } })],
] as const)("invalid design read (%s) retains shared presets", async (reason, design) => {
  await prepare();
  wordpress({ design });
  const r = await deliver(event({ setting: "design" }));
  expect(r.status).toBe(503);
  expect(r.body.design.failure.reason).toBe(reason);
  expect((await entry()).entry.colors[0]?.color).toBe("#c00");
});

test("a slower settings read cannot replace a later promotion", async () => {
  await prepare();
  let release!: () => void;
  const gate = new Promise<void>((r) => {
    release = r;
  });
  const old = data({ designTokens: presets() });
  const fetch = wordpress({
    design: async () => {
      await gate;
      return old;
    },
  });
  const slow = deliver(event({ setting: "design" }));
  await vi.waitFor(() => expect(queries(fetch, "DesignPresets")).toHaveLength(1));
  vi.setSystemTime(Date.now() + 1000);
  color = "#0a0";
  wordpress();
  await deliver(event({ setting: "design" }));
  release();
  expect((await slow).body.design.outcome).toBe("superseded");
  expect((await entry()).entry.colors[0]?.color).toBe("#0a0");
});

test.each(["pt", "en"])(
  "settings and whole refresh never lift a withdrawn %s home or entry",
  async (language) => {
    await prepare();
    const uri = language === "en" ? "/en/" : "/";
    await deliver(event({ action: "withdraw", entry: { id: `front-${language}`, uri, language } }));
    await deliver(
      event({
        action: "withdraw",
        entry: {
          id: language === "en" ? "p2" : "p1",
          uri: language === "en" ? "/en/about/" : "/sobre/",
          language,
        },
      }),
    );
    for (const setting of ["identity", "menus", "design", "logo"])
      await deliver(event({ setting }));
    await refresh();
    offline();
    expect(
      (
        await api.publishedHome(
          undefined,
          api.languages.find((l) => l.slug === language),
        )
      ).kind,
    ).toBe("missing");
    expect((await api.publishedEntry(language === "en" ? "/en/about/" : "/sobre/")).kind).toBe(
      "missing",
    );
    expect((await home(language === "en" ? "pt" : "en")).home.page.content).toBeTruthy();
  },
);

test("publication updates only its own language home and a later publication can restore withdrawal", async () => {
  await prepare();
  await deliver(
    event({ action: "withdraw", entry: { id: "front-en", uri: "/en/", language: "en" } }),
  );
  vi.setSystemTime(Date.now() + 1000);
  fronts.en!.content = "<h1>Welcome back</h1>";
  const fetch = wordpress();
  const r = await deliver(
    event({ action: "publish", entry: { id: "front-en", uri: "/en/", language: "en" } }),
  );
  expect(r.body.languages.en.home.state).toBe("published");
  expect(variables(fetch, "HomePage")).toEqual([{ uri: "/en/", language: "EN" }]);
  expect((await home("en")).home.page.content).toContain("Welcome back");
  expect((await home()).home.page.content).toContain("Bem-vindo");
});

test.each(["missing", "unavailable"])(
  "%s English home never falls back to Portuguese and signed check reports its own state",
  async (kind) => {
    wordpress({
      home: (v) =>
        v.language
          ? kind === "missing"
            ? data({
                language: { title: "Home", description: "Things" },
                nodeByUri: null,
                designTokens: presets(),
              })
            : httpError(503)
          : handlers.home(v),
    });
    const r = await refresh();
    expect(r.body.ready).toBe(kind === "missing");
    offline();
    expect((await api.publishedHome(undefined, api.languages[1])).kind).toBe("missing");
    expect((await home()).home.page.content).toContain("Bem-vindo");
    const check = await deliver(event({ action: "check", setting: undefined }));
    expect(check.body.store.languages.en.home).toBe(kind === "missing" ? "missing" : null);
  },
);

test("wrong-language CMS entry never falls back and withdrawal removes translation alternates", async () => {
  await prepare();
  wordpress({
    entry: () => data({ pageBy: entries["/sobre/"], postBy: null, designTokens: presets() }),
  });
  expect((await api.publishedEntry("/en/sobre/")).kind).toBe("missing");
  await deliver(
    event({ action: "withdraw", entry: { id: "p2", uri: "/en/about/", language: "en" } }),
  );
  offline();
  const r = await entry("/sobre/");
  expect(r.alternates).toEqual([{ language: api.languages[1], route: "/en/", translation: false }]);
});

test("an entry published with lagging design data uses the shared design", async () => {
  await prepare();
  vi.setSystemTime(Date.now() + 1000);
  color = "#0a0";
  wordpress();
  await deliver(event({ setting: "design" }));
  wordpress({
    entry: () =>
      data({
        pageBy: entries["/en/about/"],
        postBy: null,
        designTokens: { colors: [{ slug: "brand", color: "#c00" }], spacingSizes: [] },
      }),
  });
  await deliver(
    event({ action: "publish", entry: { id: "p2", uri: "/en/about/", language: "en" } }),
  );
  offline();
  expect((await entry()).entry.colors).toEqual([{ slug: "brand", color: "#0a0" }]);
});

test.each(["absent", "unknown-format"])(
  "legacy design %s keeps page-local presets until a settings event supplies shared presets",
  async (state) => {
    await prepare();
    // Persisted-format migration input, not a storage assertion.
    if (state === "absent") db.exec("DELETE FROM publications WHERE key = 'design'");
    else db.exec("UPDATE publications SET format = 99, body = '{}' WHERE key = 'design'");
    offline();
    expect((await entry()).entry.colors).toEqual([{ slug: "brand", color: "#c00" }]);
    expect((await home("en")).home.colors).toEqual([{ slug: "brand", color: "#c00" }]);
    vi.setSystemTime(Date.now() + 1000);
    color = "#0a0";
    wordpress();
    await deliver(event({ setting: "design" }));
    offline();
    expect((await entry()).entry.colors[0]?.color).toBe("#0a0");
  },
);

test("a newer successful setting supersedes a failed older identity and settings are ordered apart", async () => {
  await prepare();
  const older = event({ setting: "design", occurredAt: Date.now() - 60000 });
  offline();
  expect((await deliver(older)).status).toBe(503);
  vi.setSystemTime(Date.now() + 1000);
  color = "#0a0";
  wordpress();
  await deliver(event({ setting: "design" }));
  const fetch = wordpress();
  expect((await deliver(older)).body).toEqual({
    event: older.id,
    status: "superseded",
    duplicate: true,
  });
  expect(fetch).not.toHaveBeenCalled();
  logo = "https://media.test/late.svg";
  wordpress();
  await deliver(event({ setting: "menus" }));
  expect(
    (await deliver(event({ setting: "logo", occurredAt: Date.now() - 60000 }))).body.status,
  ).toBe("refreshed");
  expect((await entry()).chrome.siteLogo?.sourceUrl).toBe(logo);
});

test.each([
  { setting: "widgets" },
  { setting: undefined },
  { setting: "menus", menu: [{ label: "Injected" }] },
])("invalid settings envelope %j changes nothing", async (fields) => {
  await prepare();
  const before = await entry();
  const fetch = wordpress();
  const result = await deliver(event(fields));
  expect(result.status).toBe(400);
  expect(typeof result.body.error).toBe("string");
  expect(fetch).not.toHaveBeenCalled();
  expect(await entry()).toEqual(before);
});

test("the whole refresh requires every language's chrome and targeted language-home refresh is refused", async () => {
  wordpress({ chrome: (v) => (v.language ? httpError(503) : handlers.chrome(v)) });
  expect(await refresh()).toMatchObject({
    status: 503,
    body: { ready: false, languages: { en: { chrome: { outcome: "kept" } } } },
  });
  const fetch = wordpress();
  const r = await api.handleRefresh(
    new Request("https://site.test/gq/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${TOKEN}` },
      body: JSON.stringify({ uris: ["/en/"] }),
    }),
  );
  expect(r.status).toBe(400);
  expect((await r.json()).error).toBe("/en/ is the en front page: refresh the whole Site for it.");
  expect(fetch).not.toHaveBeenCalled();
  expect(await refresh()).toMatchObject({ status: 200, body: { ready: true } });
});

test("a cold English entry and an English-only entry retain routing and home alternates", async () => {
  wordpress({ routes: () => routes("/", "/en/", "/sobre/") });
  await refresh();
  const fetch = wordpress();
  expect((await entry()).entry.content).toBe("<p>Things</p>");
  expect(variables(fetch, "EntryByUri")).toEqual([{ uri: "/en/about/" }]);
  wordpress({
    entry: () =>
      data({
        pageBy: { ...entries["/en/about/"], id: "en-only", uri: "/en/only/", translations: [] },
        postBy: null,
        designTokens: presets(),
      }),
  });
  const only = await entry("/en/only/");
  expect(only.alternates).toEqual([
    { language: api.defaultLanguage, route: "/", translation: false },
  ]);
});

test("a legacy entry with no language stays in the default language", async () => {
  await prepare();
  db.exec(
    "UPDATE publications SET body = json_remove(body, '$.language', '$.translations') WHERE key = 'entry:/sobre/'",
  );
  offline();
  expect((await entry("/sobre/")).entry.content).toBe("<p>Coisas</p>");
  expect((await entry("/sobre/")).alternates).toEqual([
    { language: api.languages[1], route: "/en/", translation: false },
  ]);
});

test("a route resolving to an English front page moves to its canonical language home", async () => {
  await prepare();
  wordpress({
    entry: () =>
      data({
        postBy: null,
        pageBy: { ...entries["/en/about/"], id: "front-en", uri: "/en/" },
        designTokens: presets(),
      }),
  });
  expect(await api.publishedEntry("/en/home/")).toEqual({ kind: "moved", uri: "/en/" });
});

test("settings signed by another Site key are refused before transport and do not alter public content", async () => {
  await prepare();
  const before = await entry();
  fronts.en!.menu = "Injected";
  const fetch = wordpress();
  expect(
    (await deliver(event({ setting: "menus" }), "another-site-key-0123456789abcdef0123456789"))
      .status,
  ).toBe(401);
  expect(fetch).not.toHaveBeenCalled();
  expect(await entry()).toEqual(before);
});

test.each(["pt", "en"])(
  "a %s publication refreshes only its own entry or home",
  async (language) => {
    await prepare();
    vi.setSystemTime(Date.now() + 1000);
    const fetch = wordpress();
    const uri = language === "en" ? "/en/about/" : "/sobre/";
    expect(
      (
        await deliver(
          event({
            action: "publish",
            entry: { id: language === "en" ? "p2" : "p1", uri, language },
          }),
        )
      ).body.status,
    ).toBe("refreshed");
    expect(variables(fetch, "EntryByUri")).toEqual([{ uri }]);
    expect(queries(fetch, "HomePage")).toEqual([]);
    expect(queries(fetch, "SiteChrome")).toEqual([]);
    const homeFetch = wordpress();
    const homeUri = language === "en" ? "/en/" : "/";
    expect(
      (
        await deliver(
          event({ action: "publish", entry: { id: `front-${language}`, uri: homeUri, language } }),
        )
      ).body.status,
    ).toBe("refreshed");
    expect(variables(homeFetch, "HomePage")).toEqual([
      language === "en" ? { uri: "/en/", language: "EN" } : {},
    ]);
    expect(queries(homeFetch, "EntryByUri")).toEqual([]);
  },
);

test("whole refresh reads both languages, lists all routes and excludes language homes from entries", async () => {
  const fetch = wordpress();
  const r = await refresh();
  expect(r.body).toMatchObject({
    ready: true,
    languages: { en: { home: { state: "published" }, chrome: { state: "published" } } },
  });
  expect(variables(fetch, "HomePage")).toEqual([{}, { uri: "/en/", language: "EN" }]);
  expect(variables(fetch, "SiteChrome")).toEqual([
    { location: "PRIMARY" },
    { location: "PRIMARY", language: "EN" },
  ]);
  expect(queries(fetch, "PublishedRoutes")[0]?.[1].body).toContain("language: ALL");
  expect(r.body.entries["/en/"]).toBeUndefined();
});

test("a never-stored English home disables English pages and alternates without using Portuguese", async () => {
  wordpress({ home: (v) => (v.language ? httpError(503) : handlers.home(v)) });
  await refresh();
  const fetch = offline();
  expect((await api.publishedHome(undefined, api.languages[1])).kind).toBe("missing");
  expect((await api.publishedEntry("/en/about/")).kind).toBe("missing");
  expect((await entry("/sobre/")).alternates).toEqual([]);
  expect(fetch).not.toHaveBeenCalled();
});

test("a failed English menu event keeps its own chrome and default-menu events read only default chrome", async () => {
  await prepare();
  fronts.en!.menu = "Changed";
  wordpress({ chrome: () => httpError(503) });
  const r = await deliver(event({ setting: "menus", language: "en" }));
  expect(r).toMatchObject({
    status: 503,
    body: { languages: { en: { chrome: { outcome: "kept", failure: { reason: "http" } } } } },
  });
  expect((await entry()).chrome.menuItems[0]?.label).toBe("About us");
  const fetch = wordpress();
  expect(
    (await deliver(event({ setting: "menus", language: "pt" }))).body.languages,
  ).toBeUndefined();
  expect(variables(fetch, "SiteChrome")).toEqual([{ location: "PRIMARY" }]);
});

test("reconciliation compares every language home and chrome and reads published entries in ALL languages", async () => {
  await prepare();
  vi.setSystemTime(Date.now() + 60000);
  const fetch = wordpress();
  const run = await deliver(event({ action: "reconcile" }));
  expect(run.body).toMatchObject({
    status: "reconciled",
    shared: {
      home: { outcome: "unchanged" },
      chrome: { outcome: "unchanged" },
      design: { outcome: "unchanged" },
      languages: { en: { home: { outcome: "unchanged" }, chrome: { outcome: "unchanged" } } },
    },
  });
  expect(variables(fetch, "HomePage")).toEqual([{}, { uri: "/en/", language: "EN" }]);
  expect(variables(fetch, "SiteChrome")).toEqual([
    { location: "PRIMARY" },
    { location: "PRIMARY", language: "EN" },
  ]);
  expect(queries(fetch, "PublishedRoutes")[0]![1].body).toContain("language: ALL");
});
test("reconciliation repairs missed English home, identity and menu changes without changing Portuguese", async () => {
  await prepare();
  const portuguese = await home();
  fronts.en!.content = "<h1>Changed</h1>";
  fronts.en!.description = "Better things";
  fronts.en!.menu = "Who we are";
  vi.setSystemTime(Date.now() + 60000);
  const changed = {
    ...entries["/en/about/"],
    content: "<p>Missed English update</p>",
    modifiedGmt: "2026-10-18T10:00:00",
  };
  wordpress({
    routes: () =>
      data({
        contentNodes: {
          nodes: [
            { id: changed.id, uri: changed.uri, modifiedGmt: changed.modifiedGmt },
            { uri: "/sobre/" },
          ],
          pageInfo: { hasNextPage: false, endCursor: null },
        },
      }),
    entry: (v) =>
      v.uri === "/en/about/"
        ? data({ pageBy: changed, postBy: null, designTokens: presets() })
        : handlers.entry(v),
  });
  const run = await deliver(event({ action: "reconcile" }));
  expect(run.body.shared).toMatchObject({
    home: { outcome: "unchanged" },
    chrome: { outcome: "unchanged" },
    languages: { en: { home: { outcome: "promoted" }, chrome: { outcome: "promoted" } } },
  });
  expect(run.body.entries["/en/about/"]).toEqual({ change: "changed", outcome: "refreshed" });
  expect((await entry()).entry.content).toBe("<p>Missed English update</p>");
  expect(await home()).toEqual(portuguese);
  const english = await home("en");
  expect(english.home.settings.description).toBe("Better things");
  expect(english.home.page.content).toBe("<h1>Changed</h1>");
  expect(english.chrome.menuItems[0]?.label).toBe("Who we are");
});
test("reconciliation preserves an unavailable English home without default-language fallback and shares design changes", async () => {
  await prepare();
  vi.setSystemTime(Date.now() + 60000);
  color = "#123456";
  wordpress({ home: (v) => (v.language === "EN" ? httpError(502) : handlers.home(v)) });
  expect((await deliver(event({ action: "reconcile" }))).status).toBe(503);
  const en = await home("en");
  expect(en.home.page.content).toBe("<h1>Welcome</h1>");
  expect(en.home.colors).toEqual([{ slug: "brand", color: "#123456" }]);
  expect((await home()).home.colors).toEqual(en.home.colors);
});

test("multilingual reconciliation reserves language shared reads and continues forty missed entries within budget", async () => {
  await prepare();
  const newEntries = Array.from({ length: 40 }, (_, n) => ({
    id: `missed-${n}`,
    uri: `/en/news-${n}/`,
    modifiedGmt: "2026-10-18T09:00:00",
    title: "Story",
    content: `<p>Story ${n}</p>`,
    status: "publish",
    isRestricted: false,
    featuredImage: null,
    language: { slug: "en" },
    translations: [],
  }));
  const answers = {
    routes: () =>
      data({
        contentNodes: { nodes: newEntries, pageInfo: { hasNextPage: false, endCursor: null } },
      }),
    entry: (v: Record<string, unknown>) =>
      data({
        pageBy: newEntries.find((e) => e.uri === v.uri) ?? null,
        postBy: null,
        designTokens: presets(),
      }),
  };
  // The two previously stored entries are now confirmed missing as well.
  const runs = [];
  for (let n = 0; n < 3; n++) {
    vi.setSystemTime(Date.now() + 60000);
    const fetch = wordpress(answers);
    const run = await deliver(event({ action: "reconcile" }));
    runs.push(run.body);
    expect(fetch.mock.calls.length).toBeLessThanOrEqual(40);
  }
  expect(runs.map((r) => [r.status, r.pending])).toEqual([
    ["behind", 25],
    ["behind", 8],
    ["reconciled", 0],
  ]);
  expect((await entry("/en/news-39/")).entry.content).toBe("<p>Story 39</p>");
});

test("missed home, menu, logo, icon, identity and design changes reach both language homes and stored entries", async () => {
  await prepare();
  vi.setSystemTime(Date.now() + 60000);
  fronts.pt!.title = "Identidade";
  fronts.pt!.description = "Coisas novas";
  fronts.pt!.content = "<h1>Nova página</h1>";
  fronts.pt!.menu = "Quem somos";
  fronts.en!.menu = "Who we are";
  logo = "https://media.test/new-logo.svg";
  icon = "https://media.test/new-icon.png";
  color = "#abcdef";
  wordpress();
  const run = await deliver(event({ action: "reconcile" }));
  expect(run.body.shared).toMatchObject({
    home: { outcome: "promoted" },
    chrome: { outcome: "promoted" },
    design: { outcome: "promoted" },
    languages: { en: { chrome: { outcome: "promoted" } } },
  });
  for (const page of [
    await home(),
    await home("en"),
    await entry("/sobre/"),
    await entry("/en/about/"),
  ]) {
    expect(page.chrome.siteLogo?.sourceUrl).toBe(logo);
    expect(page.chrome.siteIcon?.sourceUrl).toBe(icon);
  }
  const pt = await home();
  expect(pt.home.settings).toEqual({ title: "Identidade", description: "Coisas novas" });
  expect(pt.home.page.content).toBe("<h1>Nova página</h1>");
  expect(pt.home.colors).toEqual([{ slug: "brand", color }]);
  expect(pt.chrome.menuItems[0]?.label).toBe("Quem somos");
  expect((await home("en")).chrome.menuItems[0]?.label).toBe("Who we are");
  expect((await entry()).entry.colors).toEqual([{ slug: "brand", color }]);
});
