import { createContentRuntime } from "@getquick/content/server";
import type { ContentBindings } from "@getquick/content";

export default {
  async fetch(request: Request, env: ContentBindings & { REVISION: string }) {
    const db = env.PUBLICATION_DB!;
    const url = new URL(request.url);
    const path = url.pathname;
    // A test consumer's seed action, never a production package endpoint.
    if (path === "/" && request.method === "POST") {
      const home = {
        settings: { title: "P1 durable Site", description: "Installed package" },
        page: { title: "Home", content: "<h1>Survives Worker update</h1>", hasVideoHero: false },
        colors: [],
        spacingSizes: [],
      };
      const chrome = { menuItems: [], siteIcon: null, siteLogo: null };
      for (const [key, body] of [
        ["home", home],
        ["chrome", chrome],
        ["chrome:en", chrome],
      ] as const) {
        await db
          .prepare(
            "INSERT INTO publications (key,state,format,body,read_started_at,promoted_at) VALUES (?,'published',1,?,1,1)",
          )
          .bind(key, JSON.stringify(body))
          .run();
      }
    }
    const runtime = createContentRuntime({
      site: "P1",
      graphqlEndpoint: "https://offline.invalid/graphql",
      cmsOrigin: "https://offline.invalid",
      wordpress: { locale: "pt_PT_ao90", languages: [{ locale: "en_US", slug: "en" }] },
      isServer: () => true,
      bindings: () => env,
      fetch: async (_url, init) => {
        if (url.searchParams.has("cms-offline")) throw new Error("Disposable CMS outage");
        const body = JSON.parse(String(init?.body));
        if (body.query.includes("HomePage"))
          return Response.json({
            data: {
              language: { title: "English", description: "Shared rows" },
              nodeByUri: {
                __typename: "Page",
                id: "front-en",
                isFrontPage: true,
                title: "Home",
                content: "<h1>English workerd home</h1>",
              },
              designTokens: { colors: [], spacingSizes: [] },
            },
          });
        if (body.query.includes("DesignPresets"))
          return Response.json({
            data: {
              designTokens: {
                colors: [{ slug: "brand", color: env.REVISION === "second" ? "#00a" : "#0a0" }],
                spacingSizes: [],
              },
            },
          });
        if (!body.query.includes("EntryByUri")) throw new Error("Unexpected CMS read");
        return Response.json({
          data: {
            pageBy: {
              id: "workerd-page-1",
              uri: "/entry/",
              title: "Runtime proof",
              content: "<p>Signed publication in workerd</p>",
              status: "publish",
              isRestricted: false,
              featuredImage: null,
              language: { slug: "pt" },
              translations: [],
            },
            postBy: null,
            designTokens: { colors: [], spacingSizes: [] },
          },
        });
      },
    });
    if (path === "/gq/events") return runtime.handleEvent(request);
    if (path === "/gq/refresh") return runtime.handleRefresh(request);
    if (path === "/en/") {
      const home = await runtime.publishedHome(undefined, runtime.languages[1]);
      if (
        home.kind === "found" &&
        !home.content.alternates.every((a) => runtime.languages.includes(a.language))
      )
        throw new Error("Noncanonical language identity");
      return Response.json(home);
    }
    if (path === "/entry/") return Response.json(await runtime.publishedEntry(path));
    const ledger = await db.prepare("SELECT * FROM __alchemy_migrations ORDER BY rowid").all();
    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all();
    const rows = await db.prepare("SELECT * FROM publications ORDER BY key").all();
    // Test-consumer diagnostics only; never a production package endpoint.
    const events = await db.prepare("SELECT * FROM publication_events ORDER BY id").all();
    return Response.json({
      revision: env.REVISION,
      delivery: await runtime.publishedHome(),
      ledger: ledger.results,
      tables: tables.results,
      rows: rows.results,
      events: events.results,
    });
  },
};
