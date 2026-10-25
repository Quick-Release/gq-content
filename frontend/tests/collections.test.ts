// Collections (ADR 0005): a Site's custom post types stored as entries, and
// listed, filtered and searched from the publication store alone.
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createHmac, randomUUID } from "node:crypto";
import { createContentRuntime } from "@getquick/content/server";
import type { ContentExtension } from "@getquick/content";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";
import { data, gmt, listing, queries, stubWordPress, type Handler } from "./support/wordpress-stub";

const token = "collections-test-token-0123456789012345678901234";
const secret = "collections-event-key-0123456789012345678901234";
let db: TestD1;
let unavailable: boolean;

interface Item {
  id: string;
  typename: string;
  title: string;
  excerpt?: string;
  date: string;
  modified: number;
  terms?: Array<{ slug: string; name: string; taxonomyName: string }>;
  status?: string;
  fields?: Record<string, unknown>;
}

/** What WordPress publishes, by URI: pages and items. */
let published: Map<string, Item>;
let archives: Array<{ postType: string; uri: string | null }> | "unsupported";

const presets = { colors: [], spacingSizes: [] };
const legislacao = { slug: "legislacao", name: "Legislação", taxonomyName: "categoria_biblioteca" };
const estudos = { slug: "estudos", name: "Estudos", taxonomyName: "categoria_biblioteca" };
const norte = { slug: "norte", name: "Norte", taxonomyName: "regiao" };
const day = (n: number) => `2026-10-${String(n).padStart(2, "0")}T09:00:00`;

const config = {
  site: "Nomia",
  graphqlEndpoint: "https://cms.test/graphql",
  cmsOrigin: "https://cms.test",
  isServer: () => true,
  bindings: () => ({
    PUBLICATION_DB: db,
    FRONTEND_REFRESH_TOKEN: token,
    PUBLICATION_EVENT_SECRET: secret,
  }),
  collections: {
    biblioteca: {
      postType: "biblioteca",
      graphqlType: "Biblioteca",
      taxonomies: ["categoria_biblioteca", "regiao"],
    },
    "recursos-educativos": { postType: "recursos_educativos", graphqlType: "RecursoEducativo" },
  },
};
const api = () => createContentRuntime(config);

/** Addresses a post type's own archive claims: WordPress reads the archive there. */
let claimed: Set<string>;
const node: Handler = ({ uri }) => {
  const path = decodeURI(String(uri));
  const item = claimed.has(path) ? undefined : published.get(path);
  if (unavailable) return { ok: false, status: 502 };
  return data({
    designTokens: presets,
    node: item
      ? {
          __typename: item.typename,
          id: item.id,
          uri: path,
          date: item.date,
          status: item.status ?? "publish",
          isRestricted: false,
          modifiedGmt: gmt(item.modified),
          title: item.title,
          content: `<p>${item.title}</p>`,
          ...(item.excerpt !== undefined ? { excerpt: item.excerpt } : {}),
          featuredImage: null,
          ...(item.terms ? { terms: { nodes: item.terms } } : {}),
          ...item.fields,
        }
      : path === "/biblioteca/categoria/"
        ? { __typename: "Category" }
        : claimed.has(path)
          ? { __typename: "ContentType" }
          : null,
  });
};
const home: Handler = () =>
  data({
    generalSettings: { title: "Nomia", description: "" },
    nodeByUri: { __typename: "Page", id: "front", isFrontPage: true, title: "Início", content: "" },
    designTokens: presets,
  });
const routesAnswer: Handler = () =>
  listing(
    { uri: "/", id: "front", modifiedGmt: gmt(1) },
    ...[...published].map(([uri, item]) => ({ uri, id: item.id, modifiedGmt: gmt(item.modified) })),
  );
let shown: { postTypes: string[]; taxonomies: string[] };
/** Each post type's graphql_single_name, and the taxonomies connected to it, as WPGraphQL shows them. */
let singleNames: Record<string, string>;
let connected: Record<string, string[]>;
const archivesAnswer: Handler = (_variables, query = "") => {
  const schema = {
    contentTypes: {
      nodes: shown.postTypes.map((name) => ({
        name,
        graphqlSingleName: singleNames[name] ?? name,
        connectedTaxonomies: connected[name]
          ? { nodes: connected[name].map((taxonomy) => ({ name: taxonomy })) }
          : null,
      })),
    },
    taxonomies: { nodes: shown.taxonomies.map((name) => ({ name })) },
  };
  if (!query.includes("getquickArchives")) return data(schema);
  if (archives === "unsupported")
    return {
      ok: true as const,
      json: async () => ({
        errors: [{ message: 'Cannot query field "getquickArchives" on type "RootQuery".' }],
      }),
    };
  return data({ getquickArchives: archives, ...schema });
};

let fetchMock: ReturnType<typeof stubWordPress>;
function stub() {
  fetchMock = stubWordPress({
    home,
    entry: node,
    routes: routesAnswer,
    archives: archivesAnswer,
  });
}

beforeEach(() => {
  db = openTestD1();
  unavailable = false;
  claimed = new Set();
  singleNames = { biblioteca: "biblioteca", recursos_educativos: "recurso_educativo" };
  connected = {
    post: ["category"],
    biblioteca: ["categoria_biblioteca", "regiao"],
  };
  shown = {
    postTypes: ["page", "post", "biblioteca", "recursos_educativos", "eventos"],
    taxonomies: ["category", "categoria_biblioteca", "regiao"],
  };
  archives = [
    { postType: "biblioteca", uri: "/biblioteca/" },
    { postType: "recursos_educativos", uri: "/recursos-educativos/" },
    { postType: "eventos", uri: "/eventos/" },
  ];
  published = new Map([
    [
      "/biblioteca/",
      { id: "page-b", typename: "Page", title: "Biblioteca", date: day(1), modified: 1 },
    ],
    [
      "/biblioteca/lei-de-bases/",
      {
        id: "b1",
        typename: "Biblioteca",
        title: "Lei de Bases",
        excerpt: "<p>A lei que organiza tudo.</p>",
        date: day(3),
        modified: 3,
        terms: [legislacao, norte],
      },
    ],
    [
      "/biblioteca/relatorio-anual/",
      {
        id: "b2",
        typename: "Biblioteca",
        title: "Relatório anual",
        excerpt: "<p>Os números do ano.</p>",
        date: day(5),
        modified: 5,
        terms: [estudos],
      },
    ],
    [
      "/biblioteca/codigo-civil/",
      {
        id: "b3",
        typename: "Biblioteca",
        title: "Código civil",
        excerpt: "",
        date: day(4),
        modified: 4,
        terms: [legislacao],
      },
    ],
    [
      "/recursos-educativos/guia/",
      { id: "r1", typename: "RecursoEducativo", title: "Guia", date: day(2), modified: 2 },
    ],
  ]);
  stub();
});
afterEach(() => {
  vi.unstubAllGlobals();
  db.close();
});

async function refresh(runtime: Pick<ReturnType<typeof api>, "handleRefresh"> = api()) {
  const response = await runtime.handleRefresh(
    new Request("https://site.test/gq/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
  );
  return { status: response.status, report: await response.json() };
}

async function event(
  runtime: Pick<ReturnType<typeof api>, "handleEvent">,
  body: Record<string, unknown>,
) {
  const text = JSON.stringify({
    site: "Nomia",
    id: randomUUID(),
    occurredAt: Date.now(),
    ...body,
  });
  const timestamp = String(Math.floor(Date.now() / 1000));
  const signature = createHmac("sha256", secret)
    .update(timestamp + "." + text)
    .digest("hex");
  const response = await runtime.handleEvent(
    new Request("https://site.test/gq/events", {
      method: "POST",
      body: text,
      headers: { "GQ-Event-Timestamp": timestamp, "GQ-Event-Signature": `v1=${signature}` },
    }),
  );
  return { status: response.status, body: await response.json() };
}

const titles = (listing: Awaited<ReturnType<ReturnType<typeof api>["list"]>>) =>
  listing.kind === "found" ? listing.items.map((item) => item.title) : listing;

test("a collection's items are read as the node at their URI, with each type's own fields", async () => {
  const runtime = createContentRuntime({
    ...config,
    extension: {
      fields: { page: "pageSetting", collections: { biblioteca: "documentUrl" } },
      read: () => undefined,
      parse: () => undefined,
    },
  });
  await refresh(runtime);
  const [query] = queries(fetchMock, "EntryByUri").map(
    ([, init]) => JSON.parse(init.body as string).query as string,
  );
  expect(query).toContain("node: nodeByUri(uri: $uri)");
  // A field a type may lack is asked of the interface, never of the type.
  expect(query).toMatch(/\.\.\. on NodeWithExcerpt \{\s+excerpt\s+\}/);
  expect(query).toMatch(/\.\.\. on Biblioteca \{\s+terms\(first: 100\)/);
  expect(query).toMatch(/\.\.\. on Biblioteca \{[^]*documentUrl[^]*\}/);
  expect(query).toMatch(/\.\.\. on Page \{[^]*pageSetting/);
  expect(query).not.toContain("on RecursoEducativo");
  expect(query).not.toContain("pageBy");

  const [list] = queries(fetchMock, "PublishedRoutes").map(
    ([, init]) => JSON.parse(init.body as string).query as string,
  );
  expect(list).toContain("contentTypes: [PAGE, POST, BIBLIOTECA, RECURSOS_EDUCATIVOS]");
});

test("a refresh stores the items and where their archives are; visits are served from the store", async () => {
  const runtime = api();
  const { status, report } = await refresh(runtime);
  expect(status).toBe(200);
  expect(report.archives).toEqual({ outcome: "promoted", state: "published" });
  expect(report.entries["/biblioteca/lei-de-bases/"]).toEqual({
    outcome: "promoted",
    state: "published",
  });

  fetchMock.mockClear();
  vi.stubGlobal(
    "fetch",
    vi.fn(() => Promise.reject(new TypeError("fetch failed"))),
  );
  const entry = await runtime.publishedEntry("/biblioteca/lei-de-bases/");
  expect(entry).toMatchObject({
    kind: "found",
    content: {
      entry: {
        title: "Lei de Bases",
        excerpt: "<p>A lei que organiza tudo.</p>",
        collection: {
          name: "biblioteca",
          terms: {
            categoria_biblioteca: [{ slug: "legislacao", name: "Legislação" }],
            regiao: [{ slug: "norte", name: "Norte" }],
          },
        },
      },
    },
  });
  // The search text is the store's, never served.
  expect(entry.kind === "found" && entry.content.entry.collection).not.toHaveProperty("search");
  // The archive Page is a page, at the URI the archive left it.
  expect(await runtime.publishedEntry("/biblioteca/")).toMatchObject({
    kind: "found",
    content: { entry: { title: "Biblioteca" } },
  });
  expect(await runtime.archiveUri("biblioteca")).toBe("/biblioteca/");
  // Only the Site's collections are kept.
  expect(await runtime.archiveUri("recursos-educativos")).toBe("/recursos-educativos/");
  expect(titles(await runtime.list({ collection: "biblioteca" }))).toEqual([
    "Relatório anual",
    "Código civil",
    "Lei de Bases",
  ]);
});

test("a listing pages, filters by terms and searches, newest first, from the store alone", async () => {
  const runtime = api();
  await refresh(runtime);
  const reads = vi.fn(() => Promise.reject(new TypeError("fetch failed")));
  vi.stubGlobal("fetch", reads);

  const first = await runtime.list({ collection: "biblioteca", perPage: 2 });
  expect(first).toMatchObject({ kind: "found", total: 3, page: 1, pages: 2 });
  expect(titles(first)).toEqual(["Relatório anual", "Código civil"]);
  const second = await runtime.list({ collection: "biblioteca", perPage: 2, page: 2 });
  expect(second).toMatchObject({ kind: "found", total: 3, page: 2, pages: 2 });
  expect(second.kind === "found" && second.items).toEqual([
    {
      uri: "/biblioteca/lei-de-bases/",
      title: "Lei de Bases",
      date: day(3),
      modifiedAt: Date.parse(`${gmt(3)}Z`),
      excerpt: "<p>A lei que organiza tudo.</p>",
      featuredImage: null,
      terms: {
        categoria_biblioteca: [{ slug: "legislacao", name: "Legislação" }],
        regiao: [{ slug: "norte", name: "Norte" }],
      },
    },
  ]);
  // Past the last page: none, and still how many there are.
  expect(await runtime.list({ collection: "biblioteca", perPage: 2, page: 3 })).toEqual({
    kind: "found",
    items: [],
    total: 3,
    page: 3,
    pages: 2,
  });

  // Any slug of a taxonomy, and every taxonomy given.
  expect(
    titles(
      await runtime.list({
        collection: "biblioteca",
        terms: { categoria_biblioteca: ["legislacao", "estudos"] },
      }),
    ),
  ).toEqual(["Relatório anual", "Código civil", "Lei de Bases"]);
  expect(
    titles(
      await runtime.list({
        collection: "biblioteca",
        terms: { categoria_biblioteca: ["legislacao"], regiao: ["norte"] },
      }),
    ),
  ).toEqual(["Lei de Bases"]);
  expect(
    await runtime.list({ collection: "biblioteca", terms: { regiao: ["sul"] } }),
  ).toMatchObject({ kind: "found", items: [], total: 0, pages: 0 });

  // Title and excerpt, ignoring case and accents; never the markup.
  expect(titles(await runtime.list({ collection: "biblioteca", search: "RELATORIO" }))).toEqual([
    "Relatório anual",
  ]);
  expect(titles(await runtime.list({ collection: "biblioteca", search: "  organiza " }))).toEqual([
    "Lei de Bases",
  ]);
  expect(titles(await runtime.list({ collection: "biblioteca", search: "<p>" }))).toEqual([]);
  expect(
    titles(
      await runtime.list({
        collection: "biblioteca",
        search: "código",
        terms: { regiao: ["norte"] },
      }),
    ),
  ).toEqual([]);
  // The other collection, and none of the pages.
  expect(titles(await runtime.list({ collection: "recursos-educativos" }))).toEqual(["Guia"]);

  expect(await runtime.terms("biblioteca", "categoria_biblioteca")).toEqual({
    kind: "found",
    terms: [
      { slug: "estudos", name: "Estudos", count: 1 },
      { slug: "legislacao", name: "Legislação", count: 2 },
    ],
  });
  expect(await runtime.terms("biblioteca", "regiao")).toEqual({
    kind: "found",
    terms: [{ slug: "norte", name: "Norte", count: 1 }],
  });
  expect(reads).not.toHaveBeenCalled();
});

test("a listing's bounds and mistakes: page and perPage clamp, unknown names are errors", async () => {
  const runtime = api();
  await refresh(runtime);
  expect(await runtime.list({ collection: "biblioteca", page: 0, perPage: 1000 })).toMatchObject({
    page: 1,
    pages: 1,
    total: 3,
  });
  await expect(runtime.list({ collection: "eventos" })).rejects.toThrow("isn't a collection");
  await expect(
    runtime.list({ collection: "biblioteca", terms: { tipo_evento: ["x"] } }),
  ).rejects.toThrow("isn't one of the biblioteca collection's taxonomies");
  await expect(runtime.terms("recursos-educativos", "regiao")).rejects.toThrow();
  expect(() => runtime.archiveUri("eventos")).toThrow("isn't a collection");
});

test("a listing is never read live: without a store, or with one that fails, it is unavailable", async () => {
  const runtime = api();
  await refresh(runtime);
  db.unavailable = true;
  expect(await runtime.list({ collection: "biblioteca" })).toMatchObject({
    kind: "unavailable",
    failure: { reason: "store" },
  });
  expect(await runtime.terms("biblioteca", "regiao")).toMatchObject({
    kind: "unavailable",
    failure: { reason: "store" },
  });
  expect(await runtime.archiveUri("biblioteca")).toBeNull();

  const live = createContentRuntime({ ...config, development: true, bindings: () => ({}) });
  expect(await live.list({ collection: "biblioteca" })).toMatchObject({
    kind: "unavailable",
    failure: { reason: "not-ready" },
  });
  // Explicit development reads the archives live.
  expect(await live.archiveUri("biblioteca")).toBe("/biblioteca/");
});

test("events publish and withdraw items, and listings follow", async () => {
  const runtime = api();
  await refresh(runtime);

  const item = published.get("/biblioteca/codigo-civil/")!;
  item.title = "Código civil anotado";
  item.modified = 9;
  const publish = await event(runtime, {
    action: "publish",
    entry: { id: "b3", uri: "/biblioteca/codigo-civil/" },
  });
  expect(publish.status).toBe(200);
  expect(titles(await runtime.list({ collection: "biblioteca", search: "anotado" }))).toEqual([
    "Código civil anotado",
  ]);
  expect(await runtime.search({ search: "anotado" })).toMatchObject({
    kind: "found",
    content: {
      items: [{ uri: "/biblioteca/codigo-civil/", title: "Código civil anotado" }],
      total: 1,
    },
  });

  const withdraw = await event(runtime, {
    action: "withdraw",
    entry: { id: "b1", uri: "/biblioteca/lei-de-bases/" },
  });
  expect(withdraw.body).toMatchObject({
    status: "withdrawn",
    withdrawn: ["/biblioteca/lei-de-bases/"],
  });
  expect(titles(await runtime.list({ collection: "biblioteca" }))).toEqual([
    "Relatório anual",
    "Código civil anotado",
  ]);
  expect(await runtime.terms("biblioteca", "regiao")).toEqual({ kind: "found", terms: [] });
  expect(await runtime.publishedEntry("/biblioteca/lei-de-bases/")).toMatchObject({
    kind: "missing",
  });
  // Withdrawal applies to search immediately, with the CMS offline too.
  unavailable = true;
  fetchMock.mockClear();
  expect(await runtime.search({ search: "lei de bases" })).toMatchObject({
    kind: "found",
    content: { items: [], total: 0 },
  });
  expect(await runtime.search({ search: "anotado" })).toMatchObject({
    kind: "found",
    content: { total: 1 },
  });
  expect(fetchMock).not.toHaveBeenCalled();
});

test("site search receives pages, posts and resources through ordinary full refresh", async () => {
  published.set("/noticia/", {
    id: "post-search",
    typename: "Post",
    title: "Pesquisa geral notícia",
    date: day(9),
    modified: 9,
  });
  published.get("/biblioteca/")!.title = "Pesquisa geral página";
  published.get("/recursos-educativos/guia/")!.title = "Pesquisa geral recurso";
  const runtime = api();
  expect((await refresh(runtime)).status).toBe(200);
  expect(await runtime.search({ search: "pesquisa geral" })).toMatchObject({
    kind: "found",
    content: {
      items: [
        { uri: "/noticia/", title: "Pesquisa geral notícia" },
        { uri: "/recursos-educativos/guia/", title: "Pesquisa geral recurso" },
        { uri: "/biblioteca/", title: "Pesquisa geral página" },
      ],
      total: 3,
    },
  });
});

test("site search follows ordered withdrawal and republication, and canonical moves", async () => {
  const base = Date.now();
  const clock = vi.spyOn(Date, "now").mockReturnValue(base);
  try {
    const runtime = api();
    await refresh(runtime);
    clock.mockReturnValue(base + 1_000);
    expect(
      (
        await event(runtime, {
          action: "withdraw",
          entry: { id: "b1", uri: "/biblioteca/lei-de-bases/" },
        })
      ).body,
    ).toMatchObject({ status: "withdrawn" });
    clock.mockReturnValue(base + 2_000);
    // Ordinary refresh cannot undo an authoritative withdrawal.
    await refresh(runtime);
    expect(await runtime.search({ search: "lei de bases" })).toMatchObject({
      kind: "found",
      content: { total: 0 },
    });
    clock.mockReturnValue(base + 3_000);
    expect(
      (
        await event(runtime, {
          action: "publish",
          entry: { id: "b1", uri: "/biblioteca/lei-de-bases/" },
        })
      ).body,
    ).toMatchObject({ status: "refreshed" });
    expect(await runtime.search({ search: "lei de bases" })).toMatchObject({
      kind: "found",
      content: { items: [{ uri: "/biblioteca/lei-de-bases/" }], total: 1 },
    });
    clock.mockReturnValue(base + 4_000);
    const renamed = published.get("/biblioteca/lei-de-bases/")!;
    published.delete("/biblioteca/lei-de-bases/");
    published.set("/biblioteca/lei-renomeada/", renamed);
    expect(
      (
        await event(runtime, {
          action: "publish",
          entry: {
            id: "b1",
            uri: "/biblioteca/lei-renomeada/",
            previousUri: "/biblioteca/lei-de-bases/",
          },
        })
      ).status,
    ).toBe(200);
    // A delayed withdrawal older than the accepted publication cannot hide it.
    clock.mockReturnValue(base + 5_000);
    await event(runtime, {
      action: "withdraw",
      occurredAt: base + 1_000,
      entry: { id: "b1", uri: "/biblioteca/lei-de-bases/" },
    });
    expect(await runtime.search({ search: "lei de bases" })).toMatchObject({
      kind: "found",
      content: { items: [{ uri: "/biblioteca/lei-renomeada/" }], total: 1 },
    });
  } finally {
    clock.mockRestore();
  }
});

test("an item of a type the Site doesn't store, or not public, or another node, is missing", async () => {
  published.set("/eventos/feira/", {
    id: "e1",
    typename: "Evento",
    title: "Feira",
    date: day(1),
    modified: 1,
  });
  published.set("/biblioteca/rascunho/", {
    id: "b9",
    typename: "Biblioteca",
    title: "Rascunho",
    date: day(1),
    modified: 1,
    status: "draft",
  });
  const runtime = api();
  await refresh(runtime);
  expect((await runtime.publishedEntry("/eventos/feira/")).kind).toBe("missing");
  expect((await runtime.publishedEntry("/biblioteca/rascunho/")).kind).toBe("missing");
  expect((await runtime.publishedEntry("/biblioteca/categoria/")).kind).toBe("missing");
  expect(titles(await runtime.list({ collection: "biblioteca" }))).toHaveLength(3);
});

test("reconciliation finds new and removed items, and a change to the archives", async () => {
  const runtime = api();
  await refresh(runtime);
  published.set("/biblioteca/novo/", {
    id: "b4",
    typename: "Biblioteca",
    title: "Novo",
    date: day(9),
    modified: 9,
    terms: [estudos],
  });
  published.delete("/biblioteca/relatorio-anual/");
  archives = [{ postType: "biblioteca", uri: "/recursos/biblioteca/" }];

  const run = await event(runtime, { action: "reconcile" });
  expect(run.status).toBe(200);
  expect(run.body).toMatchObject({
    status: "reconciled",
    shared: { archives: { outcome: "promoted" } },
    entries: {
      "/biblioteca/novo/": { change: "new", outcome: "refreshed" },
      "/biblioteca/relatorio-anual/": { change: "removed", outcome: "refreshed" },
      // The archive moved: its old and new addresses are read again.
      "/biblioteca/": { change: "archive", outcome: "refreshed" },
      "/recursos/biblioteca/": { change: "archive", outcome: "refreshed" },
      "/recursos-educativos/": { change: "archive", outcome: "refreshed" },
    },
  });
  expect(titles(await runtime.list({ collection: "biblioteca" }))).toEqual([
    "Novo",
    "Código civil",
    "Lei de Bases",
  ]);
  expect(await runtime.archiveUri("biblioteca")).toBe("/recursos/biblioteca/");
  expect(await runtime.archiveUri("recursos-educativos")).toBeNull();

  const again = await event(runtime, { action: "reconcile" });
  expect(again.body.shared.archives).toEqual({ outcome: "unchanged" });
});

test("an archives settings event refreshes where the archives are, and reads every archive address again", async () => {
  const runtime = api();
  await refresh(runtime);
  archives = [
    { postType: "biblioteca", uri: "/arquivo/" },
    { postType: "recursos_educativos", uri: "/recursos-educativos/" },
  ];
  fetchMock.mockClear();
  const settings = await event(runtime, { action: "settings", setting: "archives" });
  expect(settings).toMatchObject({
    status: 200,
    body: {
      status: "refreshed",
      archives: { outcome: "promoted", state: "published" },
      entries: {
        "/biblioteca/": { outcome: "promoted", state: "published" },
        "/arquivo/": { outcome: "promoted", state: "missing" },
        "/recursos-educativos/": { outcome: "promoted", state: "missing" },
      },
    },
  });
  expect(queries(fetchMock, "ContentArchives")).toHaveLength(1);
  expect(queries(fetchMock, "EntryByUri")).toHaveLength(3);
  expect(fetchMock).toHaveBeenCalledTimes(4);
  expect(await runtime.archiveUri("biblioteca")).toBe("/arquivo/");
});

test("giving an archive's address to its Page serves the Page at once, and taking it back stops serving it", async () => {
  // The type's own archive claims /biblioteca/: its Page reads as missing,
  // and reconciliation finds nothing new to read there.
  claimed.add("/biblioteca/");
  const runtime = api();
  await refresh(runtime);
  expect((await runtime.publishedEntry("/biblioteca/")).kind).toBe("missing");
  await event(runtime, { action: "reconcile" });
  expect((await runtime.publishedEntry("/biblioteca/")).kind).toBe("missing");

  // GETQUICK → Archives gives /biblioteca/ to the Page: the archive's address
  // doesn't change, and the Page isn't modified. Saving sends the archives event.
  claimed.delete("/biblioteca/");
  const assigned = await event(runtime, { action: "settings", setting: "archives" });
  expect(assigned.body).toMatchObject({
    status: "refreshed",
    archives: { outcome: "promoted" },
    entries: { "/biblioteca/": { outcome: "promoted", state: "published" } },
  });
  expect(await runtime.publishedEntry("/biblioteca/")).toMatchObject({
    kind: "found",
    content: { entry: { title: "Biblioteca" } },
  });

  // Taking the address back for the type's own archive stops serving the Page there.
  claimed.add("/biblioteca/");
  const unassigned = await event(runtime, { action: "settings", setting: "archives" });
  expect(unassigned.body.entries).toMatchObject({
    "/biblioteca/": { outcome: "promoted", state: "missing" },
  });
  expect((await runtime.publishedEntry("/biblioteca/")).kind).toBe("missing");
});

test("a CMS whose GETQUICK Content has no Archives yet gives no archives, and still refreshes", async () => {
  archives = "unsupported";
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  const runtime = api();
  const { status, report } = await refresh(runtime);
  expect(status).toBe(200);
  expect(report.archives).toEqual({ outcome: "promoted", state: "published" });
  expect(await runtime.archiveUri("biblioteca")).toBeNull();
  expect(warn).toHaveBeenCalled();
});

test("a Site without collections reads entries as before, and stores no archives", async () => {
  const runtime = createContentRuntime({ ...config, collections: undefined });
  stubWordPress({
    home,
    entry: () => data({ postBy: null, pageBy: null, designTokens: presets }),
    routes: () => listing({ uri: "/", id: "front", modifiedGmt: gmt(1) }),
  });
  const { status, report } = await refresh(runtime);
  expect(status).toBe(200);
  expect(report).not.toHaveProperty("archives");
});

test("the extension reads an item's own fields, with its collection", async () => {
  published.get("/biblioteca/lei-de-bases/")!.fields = {
    documentUrl: "https://media.test/lei.pdf",
  };
  const read = vi.fn<ContentExtension<{ pdf: string }>["read"]>(({ kind, fields }) =>
    kind === "item" && typeof fields.documentUrl === "string"
      ? { pdf: fields.documentUrl }
      : undefined,
  );
  const runtime = createContentRuntime({
    ...config,
    extension: {
      fields: { collections: { biblioteca: "documentUrl" } },
      read,
      parse: (stored) =>
        typeof (stored as { pdf?: unknown })?.pdf === "string"
          ? (stored as { pdf: string })
          : undefined,
    },
  });
  await refresh(runtime);
  expect(read).toHaveBeenCalledWith(
    expect.objectContaining({ kind: "item", collection: "biblioteca" }),
  );
  const listed = await runtime.list({ collection: "biblioteca", search: "lei" });
  expect(listed.kind === "found" && listed.items[0]?.extension).toEqual({
    pdf: "https://media.test/lei.pdf",
  });
  const entry = await runtime.publishedEntry("/biblioteca/lei-de-bases/");
  expect(entry.kind === "found" && entry.content.entry.extension).toEqual({
    pdf: "https://media.test/lei.pdf",
  });
});

test("a collection must be declared with names the store and WPGraphQL accept", () => {
  const make = (collections: Record<string, unknown>, fields?: Record<string, string>) => () =>
    createContentRuntime({
      ...config,
      collections: collections as never,
      ...(fields
        ? {
            extension: {
              fields: { collections: fields },
              read: () => undefined,
              parse: () => undefined,
            },
          }
        : {}),
    });
  expect(make({ "Bad Name": { postType: "x", graphqlType: "X" } })).toThrow("needs a name");
  expect(make({ a: { postType: "page", graphqlType: "Page" } })).toThrow("can't be WordPress's");
  expect(make({ a: { postType: "x", graphqlType: "X-Y" } })).toThrow("GraphQL type name");
  expect(make({ a: { postType: "x", graphqlType: "X", taxonomies: ['a"b'] } })).toThrow(
    "isn't a taxonomy name",
  );
  expect(
    make({ a: { postType: "x", graphqlType: "X" }, b: { postType: "x", graphqlType: "Y" } }),
  ).toThrow("another collection's");
  expect(make({ a: { postType: "x", graphqlType: "X" } }, { b: "f" })).toThrow(
    "isn't a collection",
  );
  expect(make({ a: { postType: "x", graphqlType: "X" } }, { a: " " })).toThrow("are empty");
});

test("on a multilingual Site a listing is in one language, the default's unless named", async () => {
  published = new Map([
    [
      "/biblioteca/lei/",
      {
        id: "b1",
        typename: "Biblioteca",
        title: "Lei",
        date: day(1),
        modified: 1,
        fields: { language: { slug: "pt" }, translations: [] },
      },
    ],
    [
      "/en/biblioteca/law/",
      {
        id: "b2",
        typename: "Biblioteca",
        title: "Law",
        date: day(2),
        modified: 2,
        fields: { language: { slug: "en" }, translations: [] },
      },
    ],
  ]);
  stubWordPress({
    home: () =>
      data({
        generalSettings: { title: "Nomia", description: "" },
        language: { title: "Nomia", description: "" },
        nodeByUri: {
          __typename: "Page",
          id: "front",
          isFrontPage: true,
          title: "Home",
          content: "",
        },
        designTokens: presets,
      }),
    entry: node,
    routes: routesAnswer,
    archives: archivesAnswer,
  });
  const runtime = createContentRuntime({
    ...config,
    wordpress: { locale: "pt_PT", languages: [{ locale: "en_US", slug: "en" }] },
  });
  const { status } = await refresh(runtime);
  expect(status).toBe(200);
  expect(titles(await runtime.list({ collection: "biblioteca" }))).toEqual(["Lei"]);
  const english = await runtime.list({ collection: "biblioteca", language: "en" });
  expect(english.kind === "found" && english.items).toMatchObject([
    { title: "Law", language: "en" },
  ]);
  await expect(runtime.list({ collection: "biblioteca", language: "fr" })).rejects.toThrow(
    "isn't one of the Site's languages",
  );
});

test("a collection whose post type or taxonomy WPGraphQL doesn't show fails, by name, and keeps what is stored", async () => {
  const runtime = api();
  await refresh(runtime);
  shown = { postTypes: ["page", "post", "biblioteca"], taxonomies: ["categoria_biblioteca"] };
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { status, report } = await refresh(runtime);
  expect(status).toBe(503);
  expect(report.archives).toEqual({
    outcome: "kept",
    failure: {
      reason: "schema",
      message:
        "WPGraphQL doesn't show biblioteca's taxonomy regiao, recursos-educativos's post type recursos_educativos (show_in_graphql)",
    },
  });
  expect(await runtime.archiveUri("biblioteca")).toBe("/biblioteca/");
  const reconciled = await event(runtime, { action: "reconcile" });
  expect(reconciled.status).toBe(503);
  expect(reconciled.body.failure.message).toContain("regiao");
});

test("a collection whose graphqlType isn't its post type's, or whose taxonomy isn't connected to it, fails by name", async () => {
  const runtime = api();
  await refresh(runtime);
  singleNames.biblioteca = "livro";
  connected.biblioteca = ["categoria_biblioteca"];
  vi.spyOn(console, "error").mockImplementation(() => {});
  const { status, report } = await refresh(runtime);
  expect(status).toBe(503);
  expect(report.archives).toEqual({
    outcome: "kept",
    failure: {
      reason: "schema",
      message:
        "biblioteca's graphqlType Biblioteca isn't post type biblioteca's GraphQL type, Livro; biblioteca's taxonomy regiao isn't connected to post type biblioteca",
    },
  });
  // WPGraphQL's own naming: recurso_educativo is RecursoEducativo.
  expect(report.archives.failure.message).not.toContain("recursos-educativos");
  expect(await runtime.archiveUri("biblioteca")).toBe("/biblioteca/");
});

test("a listing's page must be a number, and a taxonomy given no terms doesn't filter", async () => {
  const runtime = api();
  await refresh(runtime);
  await expect(
    runtime.list({ collection: "biblioteca", page: "abc" as unknown as number }),
  ).rejects.toThrow('page must be a number, not "abc"');
  await expect(runtime.list({ collection: "biblioteca", perPage: Number.NaN })).rejects.toThrow(
    "perPage must be a number",
  );
  expect(
    await runtime.list({ collection: "biblioteca", page: "1" as unknown as number, perPage: 2 }),
  ).toMatchObject({ kind: "found", page: 1, pages: 2, total: 3 });
  expect(
    titles(await runtime.list({ collection: "biblioteca", terms: { categoria_biblioteca: [] } })),
  ).toEqual(["Relatório anual", "Código civil", "Lei de Bases"]);
  expect(
    titles(
      await runtime.list({
        collection: "biblioteca",
        terms: { categoria_biblioteca: ["legislacao"], regiao: [] },
      }),
    ),
  ).toEqual(["Código civil", "Lei de Bases"]);
});

test("search matches an item's text with its character references decoded", async () => {
  published.set("/biblioteca/oneill/", {
    id: "b5",
    typename: "Biblioteca",
    title: "O&#8217;Neill &amp; R&amp;D",
    excerpt: "<p>Caf&eacute; &#x2014; &lt;notas&gt;</p>",
    date: day(6),
    modified: 6,
    terms: [estudos],
  });
  const runtime = api();
  await refresh(runtime);
  for (const search of ["o'neill", "O’Neill", "r&d", "<notas>"]) {
    expect(titles(await runtime.list({ collection: "biblioteca", search }))).toEqual([
      "O&#8217;Neill &amp; R&amp;D",
    ]);
  }
});

test("reconciliation reserves both archives requests a CMS without Archives makes", async () => {
  archives = "unsupported";
  vi.spyOn(console, "warn").mockImplementation(() => {});
  for (let n = 0; n < 30; n++) {
    published.set(`/biblioteca/item-${String(n).padStart(2, "0")}/`, {
      id: `many-${n}`,
      typename: "Biblioteca",
      title: `Item ${n}`,
      date: day(1),
      modified: 1,
    });
  }
  const runtime = api();
  fetchMock.mockClear();
  const run = await event(runtime, { action: "reconcile" });
  expect(run.body.status).toBe("behind");
  // 40 requests: design, archives (2), home (2) and chrome, the listing, and
  // two per entry read (16).
  expect(Object.keys(run.body.entries)).toHaveLength(16);
  expect(queries(fetchMock, "ContentArchives")).toHaveLength(2);
  expect(fetchMock.mock.calls.length).toBeLessThanOrEqual(40);
});
