import assert from "node:assert/strict";
import { createServer } from "node:http";
import {
  designMenuItems,
  designRouteKey,
  htmlLang,
  parseWordPressBlocks,
  renderSiteHeader,
  renderWordPressBlocks,
  routeOf,
} from "@getquick/content";
import { createContentRuntime } from "@getquick/content/server";

assert.equal(htmlLang("pt_PT_ao90"), "pt-PT");
assert.equal(routeOf("caf%C3%A9"), "/café/");
assert.equal(
  renderWordPressBlocks(
    parseWordPressBlocks('[{"name":"core/paragraph","htmlContent":"<p>Installed</p>"}]'),
  ),
  "<p>Installed</p>",
);
assert.equal(designRouteKey({ kind: "entry", postType: "post" }), "single-post");
const navigation = {
  name: "getquick/header-navigation",
  attributes: { menuItems: [{ id: 1, parentId: 0, label: "About", url: "/about/", target: "" }] },
  htmlContent: "",
  innerBlocks: [],
};
const renderers = {
  "getquick/header-navigation": (block) =>
    `<nav>${designMenuItems(block.attributes.menuItems)
      .map((item) => `<a href="${item.href}">${item.label}</a>`)
      .join("")}</nav>`,
};
assert.equal(
  renderSiteHeader({ header: { title: "Header", blocks: [navigation] } }, { renderers }),
  '<header class="gq-site-header"><nav><a href="/about/">About</a></nav></header>',
);
assert.equal(
  renderWordPressBlocks([navigation], { renderers }),
  '<nav><a href="/about/">About</a></nav>',
);
assert.equal(renderSiteHeader({ menuItems: [], siteIcon: null, siteLogo: null }), null);
const server = createServer(async (request, response) => {
  assert.equal(request.url, "/graphql");
  assert.equal(request.method, "POST");
  assert.equal(request.headers.authorization, undefined);
  assert.equal(request.headers.cookie, undefined);
  let body = "";
  for await (const chunk of request) body += chunk;
  assert.match(JSON.parse(body).query, /HomePage/);
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
  console.log("Installed ESM imports, pure helpers and real HTTP client integration passed.");
} finally {
  await new Promise((resolve, reject) =>
    server.close((error) => (error ? reject(error) : resolve())),
  );
}
