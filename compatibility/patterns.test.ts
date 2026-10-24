import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { FixtureNode } from "./projection";

// `designPattern { blocksJson }` carries a region's blocks in the layout API's
// shape, so the published layouts' regions and neutral block fixtures are the
// contract the chrome's header and footer patterns are parsed and rendered by.
const consumer = process.env.DESIGN_CONSUMER_MODULE;
if (!consumer) throw new Error("Run vp run design-fixtures to test the packed public consumer");
const content: typeof import("@getquick/content") = await import(consumer);
const fixture = <T>(path: string): T =>
  JSON.parse(
    readFileSync(
      fileURLToPath(import.meta.resolve(`@quick-release/design-contract/fixtures/${path}`)),
      "utf8",
    ),
  );
const { blocks } = fixture<{ blocks: { fixture: string; node: FixtureNode }[] }>(
  "blocks/neutral.json",
);
const layouts = ["default-ltr", "rtl", "fallback"].map((name) => ({
  name,
  layout: fixture<{ regions: { slot: string; blocks: FixtureNode[] }[] }>(`layout/${name}.json`),
}));
const strip = (node: FixtureNode): FixtureNode => ({
  name: node.name,
  attributes: node.attributes,
  content: node.content,
  children: node.children.map(strip),
});
// Explicitly missing source data in the published bare fixtures. These are
// reported, rather than invented. Carousel navigation is consumed by its parent.
const missingSource = new Set([
  "core/group",
  "getquick-design/container",
  "getquick-design/grid",
  "getquick-design/carousel-navigation",
  "core/heading",
  "core/paragraph",
  "core/button",
  "core/list-item",
  "core/columns",
  "core/column",
  "core/spacer",
  "core/separator",
]);
const expectedUnrendered = (nodes: FixtureNode[]): string[] =>
  nodes.flatMap((node) => {
    if (node.name === "getquick-design/sliders") return [];
    if (node.children.length) return expectedUnrendered(node.children);
    return node.content === null && missingSource.has(node.name) ? [node.name] : [];
  });
// Supporting caller-owned context, NOT data claimed to exist in Design fixtures.
// A null featured image deliberately preserves the published fixture limitation.
const supportingPost = {
  id: 9001,
  title: "Supporting post title",
  uri: "/supporting-post/",
  featuredImage: null,
  blocks: [
    {
      name: "core/paragraph",
      attributes: {},
      content: "<p>Supporting post body</p>",
      children: [],
    },
  ],
};
const supportingContext = {
  post: supportingPost,
  textContext: {
    site: {
      title: "Supporting site title",
      description: "Supporting tagline",
      url: "https://site.example/",
    },
  },
};
const text = (html: string): string => {
  const visit = (node: DefaultTreeAdapterMap["node"]): string =>
    "value" in node ? node.value : "childNodes" in node ? node.childNodes.map(visit).join("") : "";
  return parseFragment(html).childNodes.map(visit).join("");
};
const assertSourceContent = (nodes: FixtureNode[], html: string) => {
  for (const node of nodes) {
    if (node.content !== null && text(node.content))
      expect(text(html)).toContain(text(node.content));
    assertSourceContent(node.children, html);
  }
};

test.each(layouts)(
  "published $name header and footer regions parse as pattern trees and render",
  ({ layout }) => {
    const regions = layout.regions.filter((region) => ["header", "footer"].includes(region.slot));
    expect(regions.length).toBeGreaterThan(0);
    for (const region of regions) {
      const parsed = content.parseDesignBlocks(JSON.stringify(region.blocks));
      expect(parsed).toEqual(region.blocks.map(strip));
      const unrendered: string[] = [];
      const html = content.renderDesignPattern(
        { title: region.slot, blocks: parsed! },
        { ...supportingContext, onUnrendered: (block) => unrendered.push(block.name) },
      );
      assertSourceContent(region.blocks, html);
      expect(unrendered).toEqual(expectedUnrendered(region.blocks));
    }
  },
);

test("every published neutral block fixture parses and renders, or is reported", () => {
  for (const { fixture: id, node } of blocks) {
    const parsed = content.parseDesignBlocks([node]);
    expect(parsed, id).toEqual([strip(node)]);
    const unrendered: string[] = [];
    const html = content.renderDesignPattern(parsed, {
      ...supportingContext,
      onUnrendered: (block) => unrendered.push(block.name),
    });
    assertSourceContent([node], html);
    expect(unrendered, id).toEqual(expectedUnrendered([node]));
    if (
      unrendered.length ||
      ["getquick-design/query", "core/block", "core/post-featured-image"].includes(node.name)
    ) {
      expect(html, id).toBe("");
    } else {
      expect(html, id).toMatch(/<\w/);
    }
    if (node.name === "core/site-title")
      expect(text(html), id).toBe(supportingContext.textContext.site.title);
    if (node.name === "core/site-tagline")
      expect(text(html), id).toBe(supportingContext.textContext.site.description);
    if (node.name === "core/post-title") expect(text(html), id).toBe(supportingPost.title);
    if (node.name === "core/post-content") expect(text(html), id).toBe("Supporting post body");
  }
});

test("published null Site Logo without supporting Site title renders nothing", () => {
  const unrendered: string[] = [];
  const logo = blocks.find((entry) => entry.fixture === "core-site-logo")!.node;
  expect(
    content.renderDesignPattern([strip(logo)], {
      onUnrendered: (block) => unrendered.push(block.name),
    }),
  ).toBe("");
  expect(unrendered).toEqual([]);
});

test("published post-dependent fixtures require explicit context and null Featured Image stays empty", () => {
  for (const name of ["core/post-title", "core/post-content"]) {
    const node = blocks.find((entry) => entry.node.name === name)!.node;
    expect(() => content.renderDesignPattern([strip(node)])).toThrow(
      "requires preloaded post context",
    );
  }
  const featured = blocks.find(
    (entry) => entry.fixture === "core-post-featured-image-presentation",
  )!.node;
  expect(content.renderDesignPattern([strip(featured)], supportingContext)).toBe("");
  const logo = blocks.find((entry) => entry.fixture === "core-site-logo-presentation")!.node;
  expect(logo.attributes).toMatchObject({ logo: null, logoDark: null, logoVariation: null });
  const html = content.renderDesignPattern([strip(logo)], supportingContext);
  expect(text(html)).toBe("Supporting site title");
  expect(html).not.toContain("<img");
});

test("supporting Query composition preserves producer order and rejects missing preloaded items", () => {
  const source = blocks.find((entry) => entry.fixture === "getquick-query")!.node;
  expect(source.attributes.items).toEqual([]);
  expect(content.renderDesignPattern([strip(source)])).toBe("");
  // The source Query is empty. These identities and post contexts explicitly
  // exercise composition; they are not a replacement published fixture.
  const query = {
    ...strip(source),
    attributes: { ...source.attributes, items: [{ id: 22 }, { id: 11 }] },
    children: [strip(blocks.find((entry) => entry.fixture === "core-post-title")!.node)],
  };
  expect(() => content.renderDesignPattern([query])).toThrow("preloaded post context for item 22");
  const selected: (string | number)[] = [];
  const html = content.renderDesignPattern([query], {
    resolvePost: (item) => {
      selected.push(item.id);
      return { ...supportingPost, id: item.id, title: `Selected ${item.id}` };
    },
  });
  expect(selected).toEqual([22, 11]);
  expect(text(html)).toBe("Selected 22Selected 11");
  expect(() => content.renderDesignPattern([{ ...query, attributes: {} }])).toThrow(
    "producer-resolved items",
  );
});

test.each([
  [
    "getquick-grid-responsive",
    [
      "--gqd-base-gridColumns:repeat(2, minmax(0, 1fr))",
      "--gqd-md-rowGap:calc(var(--gqd-spacing, 0.25rem) * 0)",
      "First cell",
      "Second cell",
    ],
  ],
  [
    "core-group-responsive",
    ["<section", "--gqd-base-display:flex", "--gqd-lg-flexDirection:column", "Group child"],
  ],
  [
    "core-columns-unequal",
    [
      "is-not-stacked-on-mobile",
      "flex-basis:25%",
      "flex-basis:75%",
      "--gqd-lg-alignSelf:end",
      "Quarter",
      "Three quarters",
    ],
  ],
  [
    "core-spacer-responsive",
    ["height:37px", "--gqd-md-height:calc(var(--gqd-spacing, 0.25rem) * 8)"],
  ],
  [
    "core-separator-responsive",
    ["--gqd-base-marginInline:auto", "--gqd-base-width:50.00000000%", "--gqd-base-opacity:0.5"],
  ],
  [
    "core-image-presentation",
    [
      'href="https://example.test/route"',
      'src="https://gqd-media.test/photo.svg"',
      'alt="Mountain"',
      "Caption",
      "--gqd-base-aspectRatio:1 / 1",
    ],
  ],
  [
    "core-cover-presentation",
    [
      'src="https://gqd-media.test/photo.svg"',
      "wp-block-cover__background",
      "Readable foreground",
      "--gqd-base-overlayOpacity:0.5",
    ],
  ],
  [
    "core-navigation-responsive",
    [
      'href="/news"',
      'href="/about"',
      'href="/team"',
      "--gqd-lg-flexDirection:row",
      "--gqd-xl-display:none",
      "--gqd-2xl-display:flex",
    ],
  ],
  [
    "getquick-social-links-responsive",
    [
      "https://instagram.com/design.example",
      "https://bsky.app/profile/design.example",
      "--gqd-xl-display:none",
      "--gqd-2xl-display:flex",
    ],
  ],
  [
    "getquick-carousel-saved-presentation",
    [
      "--gqd-base-height:150px",
      "--gqd-md-height:240px",
      "--gqd-xl-height:auto",
      "First slide heading",
      "https://example.test/1.svg",
      "https://example.test/2.svg",
      "https://example.test/3.svg",
    ],
  ],
  [
    "typography-static-0",
    [
      "<h3",
      "Authored heading",
      "--gqd-base-fontWeight:var(--gqd-font-weight-bold, 700)",
      "--gqd-base-color:#123456",
    ],
  ],
  [
    "typography-static-2",
    [
      "<ol",
      'start="3"',
      "reversed",
      "Parent item",
      "Nested item",
      "--gqd-base-listStyleType:decimal",
    ],
  ],
  [
    "typography-static-3",
    [
      'href="/shop"',
      'target="_blank"',
      "Go <strong>shopping</strong>",
      "--gqd-lg-flexDirection:row",
    ],
  ],
] as const)("published %s retains source identities and authored presentation", (id, fragments) => {
  const node = blocks.find((entry) => entry.fixture === id)!.node;
  const html = content.renderDesignPattern([strip(node)], supportingContext);
  for (const fragment of fragments) expect(html, `${id}: ${fragment}`).toContain(fragment);
});
