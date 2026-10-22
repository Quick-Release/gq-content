// Prints the GraphQL the built runtime sends for a Site with collections (an
// item read, the archives read and the published routes' listing), for the P2
// proof to run against real WPGraphQL. Nothing is stored (the refresh's store
// fails every statement) and WordPress is never reached.
import { createContentRuntime } from "../frontend/dist/server.js";

const queries = {};
// The item and archives are read live (development, no store); the refresh
// needs a store bound.
let refreshing = false;
const token = "collection-queries-token-0123456789012345";
const unavailable = () => {
  throw new Error("nothing is stored");
};
const runtime = createContentRuntime({
  site: "archives-proof",
  graphqlEndpoint: "https://cms.test/graphql",
  cmsOrigin: "https://cms.test",
  development: true,
  isServer: () => true,
  bindings: () =>
    refreshing
      ? {
          PUBLICATION_DB: { prepare: unavailable, batch: unavailable, exec: unavailable },
          FRONTEND_REFRESH_TOKEN: token,
        }
      : {},
  collections: {
    biblioteca: { postType: "biblioteca", graphqlType: "Biblioteca", taxonomies: ["category"] },
    eventos: { postType: "eventos", graphqlType: "Evento" },
  },
  fetch: async (_url, init) => {
    const { query } = JSON.parse(init.body);
    queries[/query (\w+)/.exec(query)[1]] = query;
    return Response.json({ errors: [{ message: "not WordPress" }] });
  },
});
const log = console.error;
console.error = () => {};
await runtime.publishedEntry("/biblioteca/lei/");
await runtime.archiveUri("biblioteca");
// A full refresh lists the published routes (PublishedRoutes) before it stores anything.
refreshing = true;
await runtime
  .handleRefresh(
    new Request("https://site.test/gq/refresh", {
      method: "POST",
      headers: { Authorization: `Bearer ${token}` },
    }),
  )
  .catch(() => {});
console.error = log;
process.stdout.write(JSON.stringify(queries));
