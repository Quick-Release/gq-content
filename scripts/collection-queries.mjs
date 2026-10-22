// Prints the GraphQL the built runtime sends for a Site with collections (an
// item read and the archives read), for the P2 proof to run against real
// WPGraphQL. Nothing is stored and WordPress is never reached.
import { createContentRuntime } from "../frontend/dist/server.js";

const queries = {};
const runtime = createContentRuntime({
  site: "archives-proof",
  graphqlEndpoint: "https://cms.test/graphql",
  cmsOrigin: "https://cms.test",
  development: true,
  isServer: () => true,
  bindings: () => ({}),
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
console.error = log;
process.stdout.write(JSON.stringify(queries));
