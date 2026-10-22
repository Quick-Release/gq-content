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

const node: Handler = ({ uri }) => {
  const path = decodeURI(String(uri));
  const item = published.get(path);
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
const archivesAnswer: Handler = (_variables, query = "") => {
  const schema = {
    contentTypes: { nodes: shown.postTypes.map((name) => ({ name })) },
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

test("an archives settings event refreshes where the archives are, and nothing else", async () => {
  const runtime = api();
  await refresh(runtime);
  archives = [{ postType: "biblioteca", uri: "/arquivo/" }];
  fetchMock.mockClear();
  const settings = await event(runtime, { action: "settings", setting: "archives" });
  expect(settings).toMatchObject({
    status: 200,
    body: { status: "refreshed", archives: { outcome: "promoted", state: "published" } },
  });
  expect(queries(fetchMock, "ContentArchives")).toHaveLength(1);
  expect(fetchMock).toHaveBeenCalledTimes(1);
  expect(await runtime.archiveUri("biblioteca")).toBe("/arquivo/");
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
