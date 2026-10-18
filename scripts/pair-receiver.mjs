// Installed package consumer: actual PHP HTTP transport enters the public handler.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createContentRuntime } from "@getquick/content/server";
import { openTestD1 } from "./sqlite-d1.ts";
const db = openTestD1(process.env.PAIR_DATABASE);
let offline = false;
let reads = 0;
let rejectDelivery = false;
const envelopes = [];
const operations = [];
const events = [];
const runtime = createContentRuntime({
  site: "Pair Site / Á:06",
  graphqlEndpoint: "https://cms.test/graphql",
  cmsOrigin: "https://cms.test",
  wordpress: process.env.PAIR_MULTILINGUAL
    ? { locale: "pt_PT_ao90", languages: [{ locale: "en_US", slug: "en" }] }
    : undefined,
  isServer: () => true,
  bindings: () => ({
    PUBLICATION_DB: db,
    PUBLICATION_EVENT_SECRET: process.env.PAIR_SECRET,
    FRONTEND_REFRESH_TOKEN: process.env.PAIR_TOKEN,
  }),
  fetch: async (_url, init) => {
    reads++;
    if (offline) throw new Error("CMS boundary offline");
    const { query, variables } = JSON.parse(init.body);
    operations.push({ name: /query (\w+)/.exec(query)?.[1], variables });
    const fixture = JSON.parse(readFileSync(process.env.PAIR_FIXTURE, "utf8"));
    if (process.env.PAIR_MULTILINGUAL && query.includes("HomePage"))
      return Response.json({ data: fixture.homes[variables.language === "EN" ? "en" : "pt"] });
    if (process.env.PAIR_MULTILINGUAL && query.includes("SiteChrome"))
      return Response.json({ data: fixture.chrome[variables.language === "EN" ? "en" : "pt"] });
    if (process.env.PAIR_MULTILINGUAL && query.includes("DesignPresets"))
      return Response.json({ data: { designTokens: fixture.design } });
    if (query.includes("EntryByUri")) {
      const entry = fixture.entries[variables.uri];
      return Response.json({
        data: {
          pageBy: entry ?? null,
          postBy: null,
          designTokens: fixture.design ?? { colors: [], spacingSizes: [] },
        },
      });
    }
    if (query.includes("HomePage"))
      return Response.json({
        data: {
          generalSettings: fixture.identity ?? { title: "Pair", description: "Proof" },
          nodeByUri: {
            __typename: "Page",
            isFrontPage: true,
            title: "Home",
            content: "<h1>Pair home</h1>",
          },
          designTokens: { colors: [], spacingSizes: [] },
        },
      });
    if (query.includes("SiteChrome"))
      return Response.json({
        data: { menuItems: { nodes: [] }, generalSettings: { siteIcon: null, siteLogo: null } },
      });
    if (query.includes("DesignPresets"))
      return Response.json({ data: { designTokens: { colors: [], spacingSizes: [] } } });
    if (query.includes("PublishedRoutes"))
      return Response.json({
        data: {
          contentNodes: {
            nodes: Object.keys(fixture.entries).map((uri) => ({ uri })),
            pageInfo: { hasNextPage: false, endCursor: null },
          },
        },
      });
    throw new Error("unexpected GraphQL operation");
  },
});
const server = createServer(async (req, res) => {
  try {
    const url = new URL(req.url, "http://127.0.0.1");
    let response;
    if (url.pathname === "/proof/fail-delivery" || url.pathname === "/proof/accept-delivery") {
      rejectDelivery = url.pathname === "/proof/fail-delivery";
      response = Response.json({ rejectDelivery });
    } else if (url.pathname === "/proof/state") {
      response = Response.json({ reads, operations, events, envelopes });
    } else if (url.pathname === "/proof/home") {
      const language = runtime.languages.find((l) => l.slug === url.searchParams.get("language"));
      const delivery = await runtime.publishedHome(undefined, language);
      const canonical =
        delivery.kind !== "found" ||
        delivery.content.alternates.every((a) => runtime.languages.includes(a.language));
      response = Response.json({ delivery, canonical });
    } else if (url.pathname === "/proof/offline") {
      offline = true;
      response = Response.json({ reads });
    } else if (url.pathname === "/proof/online") {
      offline = false;
      response = Response.json({ reads });
    } else if (url.pathname === "/proof/read")
      response = Response.json({
        reads,
        delivery: await runtime.publishedEntry(url.searchParams.get("uri")),
      });
    else {
      const chunks = [];
      for await (const chunk of req) chunks.push(chunk);
      const request = new Request(url, {
        method: req.method,
        headers: req.headers,
        body: req.method === "POST" ? Buffer.concat(chunks) : undefined,
      });
      if (url.pathname === "/gq/events") {
        events.push(JSON.parse(Buffer.concat(chunks).toString()));
        envelopes.push({
          event: events.at(-1),
          timestamp: req.headers["gq-event-timestamp"],
          signature: req.headers["gq-event-signature"],
        });
      }
      response =
        rejectDelivery && url.pathname === "/gq/events"
          ? Response.json({ error: "Disposable transport outage" }, { status: 503 })
          : await (url.pathname === "/gq/events" ? runtime.handleEvent : runtime.handleRefresh)(
              request,
            );
    }
    res.writeHead(response.status, Object.fromEntries(response.headers));
    res.end(await response.text());
  } catch {
    res.writeHead(500);
    res.end("proof failed");
  }
});
server.listen(0, "127.0.0.1", () => console.log("READY " + server.address().port));
process.on("SIGTERM", () =>
  server.close(() => {
    db.close();
    process.exit(0);
  }),
);
