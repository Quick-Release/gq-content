// Installed package consumer: actual PHP HTTP transport enters the public handler.
import { createServer } from "node:http";
import { readFileSync } from "node:fs";
import { createContentRuntime } from "@getquick/content/server";
import { openTestD1 } from "./sqlite-d1.ts";
const db = openTestD1(process.env.PAIR_DATABASE);
let offline = false;
let reads = 0;
const runtime = createContentRuntime({
  site: "Pair Site / Á:06",
  graphqlEndpoint: "https://cms.test/graphql",
  cmsOrigin: "https://cms.test",
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
    const fixture = JSON.parse(readFileSync(process.env.PAIR_FIXTURE, "utf8"));
    if (query.includes("EntryByUri")) {
      const entry = fixture.entries[variables.uri];
      return Response.json({
        data: {
          pageBy: entry ?? null,
          postBy: null,
          designTokens: { colors: [], spacingSizes: [] },
        },
      });
    }
    if (query.includes("HomePage"))
      return Response.json({
        data: {
          generalSettings: { title: "Pair", description: "Proof" },
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
    if (url.pathname === "/proof/offline") {
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
      response = await (
        url.pathname === "/gq/events" ? runtime.handleEvent : runtime.handleRefresh
      )(request);
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
