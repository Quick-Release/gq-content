import assert from "node:assert/strict";
import { createServer } from "node:http";
import { htmlLang, parseWordPressBlocks, renderWordPressBlocks, routeOf } from "@getquick/content";
import { createContentRuntime } from "@getquick/content/server";

assert.equal(htmlLang("pt_PT_ao90"), "pt-PT");
assert.equal(routeOf("caf%C3%A9"), "/café/");
assert.equal(
  renderWordPressBlocks(
    parseWordPressBlocks('[{"name":"core/paragraph","htmlContent":"<p>Installed</p>"}]'),
  ),
  "<p>Installed</p>",
);
const server = createServer(async (request, response) => {
  assert.equal(request.url, "/graphql");
  assert.equal(request.method, "POST");
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.headers.cookie, undefined);
  let body = "";
  for await (const chunk of request) body += chunk;
  const { query } = JSON.parse(body);
  assert.match(query, /HomePage/);
  // A Site's extension fields are selected with the blocks, and answered.
  const extended = query.includes("@include(if: $withBlocks) {\nsiteBlocksJson\n}");
  response.setHeader("Content-Type", "application/json");
  response.end(
    JSON.stringify({
      data: {
        generalSettings: { title: "Installed consumer", description: "Works without Astro" },
        nodeByUri: {
          __typename: "Page",
          isFrontPage: true,
          title: "Home",
          content: "<p>From HTTP</p>",
          ...(extended ? { siteBlocksJson: '[{"blockName":"site/hero"}]' } : {}),
        },
        designTokens: { colors: [], spacingSizes: [] },
      },
    }),
  );
});
await new Promise((resolve) => server.listen(0, "127.0.0.1", resolve));
try {
  const { port } = server.address();
  const origin = `http://127.0.0.1:${port}`;
  const content = createContentRuntime({
    site: "Installed / Identity",
    cmsOrigin: origin,
    graphqlEndpoint: `${origin}/graphql`,
    isServer: () => true,
    bindings: () => ({}),
  });
  assert.deepEqual(await content.wordpress.getHomeContent(), {
    kind: "found",
    content: {
      nodeId: null,
      settings: { title: "Installed consumer", description: "Works without Astro" },
      page: { title: "Home", content: "<p>From HTTP</p>", hasVideoHero: false },
      blocksOmitted: false,
      spacingSizes: [],
      colors: [],
    },
  });
  const extended = createContentRuntime({
    site: "Installed / Identity",
    cmsOrigin: origin,
    graphqlEndpoint: `${origin}/graphql`,
    isServer: () => true,
    bindings: () => ({}),
    extension: {
      fields: { page: "siteBlocksJson" },
      read: ({ kind, fields }) => ({ kind, blocks: JSON.parse(fields.siteBlocksJson) }),
      parse: (stored) => stored,
    },
  });
  const read = await extended.wordpress.getHomeContent();
  assert.deepEqual(read.kind === "found" && read.content.page.extension, {
    kind: "page",
    blocks: [{ blockName: "site/hero" }],
  });
  assert.deepEqual(extended.internalOrigins("https://site.test"), [origin, "https://site.test"]);
  console.log("Installed ESM imports, pure helpers and real HTTP client integration passed.");
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
