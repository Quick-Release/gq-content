// Prints the GraphQL the built runtime sends for a Site with `forms` (the front
// page, a page or post, and a node on a Site with collections), for the P2
// proof to run against real WPGraphQL with the forms module active. WordPress
// is never reached and nothing is stored.
import { createContentRuntime } from "../frontend/dist/server.js";

const queries = {};
const runtime = (collections) =>
  createContentRuntime({
    site: "forms-proof",
    graphqlEndpoint: "https://cms.test/graphql",
    cmsOrigin: "https://cms.test",
    development: true,
    forms: true,
    isServer: () => true,
    bindings: () => ({}),
    ...(collections ? { collections } : {}),
    fetch: async (_url, init) => {
      const { query } = JSON.parse(init.body);
      const name = /query (\w+)/.exec(query)[1];
      queries[name === "EntryByUri" && collections ? "NodeByUri" : name] = query;
      return Response.json({ errors: [{ message: "not WordPress" }] });
    },
  });
const log = console.error;
console.error = () => {};
await runtime().wordpress.getHomeContent();
await runtime().wordpress.getEntryByUri("/contactos/");
await runtime({
  biblioteca: { postType: "biblioteca", graphqlType: "Biblioteca" },
}).wordpress.getEntryByUri("/contactos/");
console.error = log;
process.stdout.write(JSON.stringify(queries));
