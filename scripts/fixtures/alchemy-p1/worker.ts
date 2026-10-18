import { createContentRuntime } from "@getquick/content/server";
import type { ContentBindings } from "@getquick/content";

export default {
  async fetch(request: Request, env: ContentBindings & { REVISION: string }) {
    const db = env.PUBLICATION_DB!;
    // A test consumer's seed action, never a production package endpoint.
    if (request.method === "POST") {
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
      isServer: () => true,
      bindings: () => env,
      fetch: async () => {
        throw new Error("P1 must serve durable content without CMS");
      },
    });
    const ledger = await db.prepare("SELECT * FROM __alchemy_migrations ORDER BY rowid").all();
    const tables = await db
      .prepare("SELECT name FROM sqlite_master WHERE type='table' ORDER BY name")
      .all();
    const rows = await db.prepare("SELECT * FROM publications ORDER BY key").all();
    return Response.json({
      revision: env.REVISION,
      delivery: await runtime.publishedHome(),
      ledger: ledger.results,
      tables: tables.results,
      rows: rows.results,
    });
  },
};
