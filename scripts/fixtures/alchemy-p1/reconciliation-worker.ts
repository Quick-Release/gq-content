import { createContentRuntime } from "@getquick/content/server";
import type { ContentBindings } from "@getquick/content";

// Disposable installed consumer only. Diagnostics are not package APIs.
export default {
  async fetch(request: Request, env: ContentBindings & { CMS_GRAPHQL: string; REVISION: string }) {
    const runtime = createContentRuntime({
      site: "P1",
      graphqlEndpoint: env.CMS_GRAPHQL,
      cmsOrigin: new URL(env.CMS_GRAPHQL).origin,
      wordpress: { locale: "pt_PT_ao90", languages: [{ locale: "en_US", slug: "en" }] },
      isServer: () => true,
      bindings: () => env,
    });
    const url = new URL(request.url);
    if (url.pathname === "/gq/events") return runtime.handleEvent(request);
    if (url.pathname === "/gq/refresh") return runtime.handleRefresh(request);
    if (url.pathname === "/proof/read")
      return Response.json(await runtime.publishedEntry(url.searchParams.get("uri")!));
    if (url.pathname === "/proof/home")
      return Response.json(
        await runtime.publishedHome(
          undefined,
          runtime.languages.find((l) => l.slug === url.searchParams.get("language")),
        ),
      );
    const db = env.PUBLICATION_DB!;
    if (url.pathname === "/proof/age" && request.method === "POST") {
      await db
        .prepare(
          "UPDATE publications SET read_started_at=read_started_at-31536000000,promoted_at=promoted_at-31536000000",
        )
        .run();
    }
    return Response.json({
      revision: env.REVISION,
      reconciliation: (await db.prepare("SELECT * FROM reconciliation ORDER BY id").all()).results,
      publications: (await db.prepare("SELECT * FROM publications ORDER BY key").all()).results,
      withdrawals: (await db.prepare("SELECT * FROM withdrawals ORDER BY node_id").all()).results,
      events: (await db.prepare("SELECT * FROM publication_events ORDER BY id").all()).results,
      ledger: (await db.prepare("SELECT * FROM __alchemy_migrations ORDER BY rowid").all()).results,
      attempts: (await db.prepare("SELECT * FROM refresh_attempts ORDER BY key").all()).results,
    });
  },
};
