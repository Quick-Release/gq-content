import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import { createContentRuntime, type ContentConfig } from "@getquick/content/server";
import type { SearchDelivery, SearchQuery } from "@getquick/content";
import { openTestD1, type TestD1 } from "./support/sqlite-d1";

let db: TestD1;
const fetch = vi.fn(() => {
  throw new Error("CMS is offline");
});
const config = (): ContentConfig => ({
  site: "Nomia",
  cmsOrigin: "https://cms.test",
  graphqlEndpoint: "https://cms.test/graphql",
  isServer: () => true,
  bindings: () => ({ PUBLICATION_DB: db }),
  fetch,
  wordpress: { locale: "pt_PT", languages: [{ locale: "en_US", slug: "en" }] },
  collections: { recursos: { postType: "recurso", graphqlType: "Recurso" } },
});
const presets = { colors: [], spacingSizes: [] };
const home = {
  ...presets,
  settings: { title: "Nomia", description: "" },
  page: { title: "Início", content: "<p>Bioeconomia em casa</p>", hasVideoHero: false },
};
const chrome = { menuItems: [], siteIcon: null, siteLogo: null };
const entry = (uri: string, overrides: Record<string, unknown> = {}) => ({
  ...presets,
  id: uri,
  uri,
  title: "Bioeconomia",
  excerpt: "<p>Um resumo &amp; mais</p>",
  content: "<p>Texto publicado</p>",
  date: "2026-10-01T12:00:00",
  featuredImage: null,
  hasVideoHero: false,
  ...overrides,
});
async function put(key: string, body: unknown, state = "published", format = 1) {
  await db
    .prepare(
      "INSERT OR REPLACE INTO publications (key,state,format,body,read_started_at,promoted_at) VALUES (?,?,?,?,1,1)",
    )
    .bind(key, state, format, JSON.stringify(body))
    .run();
}
const content = (result: SearchDelivery) => {
  expect(result.kind).toBe("found");
  if (result.kind !== "found") throw new Error(result.failure.message);
  return result.content;
};

beforeEach(async () => {
  db = openTestD1();
  fetch.mockClear();
  await put("home", home);
  await put("chrome", chrome);
});
afterEach(() => {
  expect(fetch).not.toHaveBeenCalled();
  db.close();
});

test("searches existing 0.3.2 pages, posts, resources and home without new fields or CMS reads", async () => {
  await put("entry:/pagina/", entry("/pagina/", { title: "Bioeconomia na página" }));
  await put(
    "entry:/noticia/",
    entry("/noticia/", {
      title: "Notícia",
      excerpt: "A bioeconomia de hoje",
      date: "2026-10-02T12:00:00",
    }),
  );
  await put(
    "entry:/recurso/",
    entry("/recurso/", {
      title: "Guia",
      excerpt: "",
      content: "<p>Bioeconomia e legislação</p>",
      collection: { name: "recursos", terms: {} },
    }),
  );
  const runtime = createContentRuntime(config());
  expect(content(await runtime.search({ search: "BIOECONOMÍA", page: "1", perPage: "2" }))).toEqual(
    {
      items: [
        { uri: "/noticia/", title: "Notícia", excerpt: "A bioeconomia de hoje", language: "pt" },
        {
          uri: "/pagina/",
          title: "Bioeconomia na página",
          excerpt: "Um resumo & mais",
          language: "pt",
        },
      ],
      total: 4,
      page: 1,
      perPage: 2,
      totalPages: 2,
    },
  );
  expect(
    content(await runtime.search({ search: "bioeconomia", page: 2, perPage: 2 })).items,
  ).toEqual([
    { uri: "/recurso/", title: "Guia", excerpt: "Bioeconomia e legislação", language: "pt" },
    { uri: "/", title: "Início", excerpt: "Bioeconomia em casa", language: "pt" },
  ]);
  expect(
    content(await runtime.search({ search: "bioeconomia", page: 3, perPage: 2 })),
  ).toMatchObject({ items: [], total: 4, totalPages: 2 });
  expect(
    content(await runtime.search({ search: "legislacao" })).items.map((item) => item.uri),
  ).toEqual(["/recurso/"]);
});

test("blank and unmatched searches are successful zero results; excerpts are bounded plain text", async () => {
  await put(
    "entry:/pagina/",
    entry("/pagina/", {
      title: "<em>A&ccedil;&atilde;o</em>",
      excerpt: "",
      content: `<style>segredo</style><script>segredo</script><!-- segredo --><p>Corpo</p><p>${"Texto ".repeat(80)}</p>`,
    }),
  );
  const runtime = createContentRuntime(config());
  for (const search of ["", "  \t ", "sem resultados", "segredo", "<p>"])
    expect(content(await runtime.search({ search }))).toEqual({
      items: [],
      total: 0,
      page: 1,
      perPage: 12,
      totalPages: 0,
    });
  const found = content(await runtime.search({ search: "acao" })).items[0]!;
  expect(found.title).toBe("Ação");
  expect(found.excerpt).toHaveLength(240);
  expect(found.excerpt).toMatch(/^Corpo Texto/);
  expect(content(await runtime.search({ search: "corpo texto" })).total).toBe(1);
});

test("only canonical, currently published routes and declared collections appear", async () => {
  for (const state of ["missing", "moved", "withdrawn"])
    await put(`entry:/${state}/`, entry(`/${state}/`), state);
  await put("entry:/removed/", entry("/removed/", { collection: { name: "removed", terms: {} } }));
  await put("entry:/", entry("/")); // A legacy duplicate of the shared home.
  await put("entry:/publica/", entry("/publica/"));
  expect(
    content(await createContentRuntime(config()).search({ search: "bioeconomia" })).items.map(
      (item) => item.uri,
    ),
  ).toEqual(["/publica/", "/"]);
});

test("matches inline text without inventing spaces and preserves block boundaries", async () => {
  await put(
    "entry:/inline/",
    entry("/inline/", {
      title: "Guia",
      excerpt: "",
      content: "<p>Bio<strong>economia</strong></p><p>circular</p>",
    }),
  );
  expect(
    content(await createContentRuntime(config()).search({ search: "bioeconomia circular" })).items,
  ).toEqual([{ uri: "/inline/", title: "Guia", excerpt: "Bioeconomia circular", language: "pt" }]);
});

test("language is isolated by route and stored language, with legacy rows in the default language", async () => {
  await put("home:en", { ...home, page: { ...home.page, title: "English home" } });
  await put("chrome:en", chrome);
  await put("entry:/legado/", entry("/legado/"));
  await put("entry:/en/article/", entry("/en/article/", { language: "en" }));
  await put("entry:/en/legacy/", entry("/en/legacy/"));
  await put("entry:/wrong/", entry("/wrong/", { language: "en" }));
  const runtime = createContentRuntime(config());
  expect(
    content(await runtime.search({ search: "bioeconomia" })).items.map((item) => item.uri),
  ).toEqual(["/legado/", "/"]);
  expect(
    content(await runtime.search({ search: "bioeconomia", language: "en" })).items.map(
      (item) => item.uri,
    ),
  ).toEqual(["/en/article/", "/en/"]);
  db.exec("DELETE FROM publications WHERE key = 'home:en'");
  expect(await runtime.search({ search: "bioeconomia", language: "en" })).toMatchObject({
    kind: "unavailable",
    failure: { reason: "not-ready" },
  });
});

test("withdrawn home is omitted without hiding other published entries", async () => {
  await put("home", null, "withdrawn");
  await put("entry:/publica/", entry("/publica/"));
  expect(
    content(await createContentRuntime(config()).search({ search: "bioeconomia" })).items.map(
      (item) => item.uri,
    ),
  ).toEqual(["/publica/"]);
});

test.each(["home", "chrome", "entry:/bad/"])(
  "unreadable %s fails clearly before totals or partial results",
  async (key) => {
    const runtime = createContentRuntime(config());
    await put(key, { invalid: true });
    expect(await runtime.search({ search: "bioeconomia" })).toMatchObject({
      kind: "unavailable",
      failure: { reason: "not-ready" },
    });
    await put(
      key,
      key === "home" ? home : key === "chrome" ? chrome : entry("/bad/"),
      "published",
      99,
    );
    expect(await runtime.search({ search: "bioeconomia" })).toMatchObject({
      kind: "unavailable",
      failure: { reason: "not-ready" },
    });
    db.exec(`UPDATE publications SET format = 1, body = '{' WHERE key = '${key}'`);
    expect(await runtime.search({ search: "bioeconomia" })).toMatchObject({
      kind: "unavailable",
      failure: { reason: "not-ready" },
    });
  },
);

test("unprepared, absent and failing stores stay unavailable, including explicit development", async () => {
  db.exec("DELETE FROM publications");
  expect(await createContentRuntime(config()).search({ search: "" })).toMatchObject({
    kind: "unavailable",
    failure: { reason: "not-ready" },
  });
  db.unavailable = true;
  expect(await createContentRuntime(config()).search({ search: "bioeconomia" })).toMatchObject({
    kind: "unavailable",
    failure: { reason: "store" },
  });
  for (const development of [false, true]) {
    const runtime = createContentRuntime({ ...config(), development, bindings: () => ({}) });
    expect(await runtime.search({ search: "bioeconomia" })).toMatchObject({
      kind: "unavailable",
      failure: { reason: "not-ready" },
    });
  }
  const runtime = createContentRuntime({
    ...config(),
    bindings: () => {
      throw new Error("private credentials");
    },
  });
  const result = await runtime.search({ search: "bioeconomia" });
  expect(result).toMatchObject({ kind: "unavailable", failure: { reason: "store" } });
  expect(JSON.stringify(result)).not.toContain("private credentials");
});

test("browser access is refused before bindings", async () => {
  const bindings = vi.fn(() => ({}));
  const runtime = createContentRuntime({ ...config(), isServer: () => false, bindings });
  expect(await runtime.search({ search: "bioeconomia" })).toMatchObject({
    kind: "unavailable",
    failure: { reason: "not-ready" },
  });
  expect(bindings).not.toHaveBeenCalled();
});

test("validates language and pagination and caps page size", async () => {
  const runtime = createContentRuntime(config());
  for (const page of [0, -1, 1.5, "two", Infinity, Number.MAX_SAFE_INTEGER])
    await expect(runtime.search({ search: "bioeconomia", page })).rejects.toThrow("page");
  await expect(runtime.search({ search: "bioeconomia", perPage: 0 })).rejects.toThrow("perPage");
  await expect(runtime.search({ search: "bioeconomia", language: "fr" })).rejects.toThrow(
    "languages",
  );
  expect(content(await runtime.search({ search: "bioeconomia", perPage: 200 })).perPage).toBe(100);
  const query: SearchQuery = { search: "bioeconomia", page: "2", perPage: "10" };
  expect(content(await runtime.search(query))).toMatchObject({ page: 2, perPage: 10 });
});
