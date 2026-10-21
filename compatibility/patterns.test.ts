import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
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
const dynamicLeaves = (nodes: FixtureNode[]): string[] =>
  nodes.flatMap((node) =>
    node.children.length > 0
      ? dynamicLeaves(node.children)
      : node.content === null && node.name !== "core/site-logo"
        ? [node.name]
        : [],
  );

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
        { onUnrendered: (block) => unrendered.push(block.name) },
      );
      for (const leaf of JSON.stringify(region.blocks).matchAll(/"content":"((?:[^"\\]|\\.)*)"/g)) {
        expect(html).toContain(JSON.parse(`"${leaf[1]}"`) as string);
      }
      // Every leaf without HTML or a built-in renderer is reported, none silently lost.
      expect(unrendered).toEqual(dynamicLeaves(region.blocks));
    }
  },
);

test("every published neutral block fixture parses and renders, or is reported", () => {
  for (const { fixture: id, node } of blocks) {
    const parsed = content.parseDesignBlocks([node]);
    expect(parsed, id).toEqual([strip(node)]);
    const unrendered: string[] = [];
    const html = content.renderDesignPattern(parsed, {
      onUnrendered: (block) => unrendered.push(block.name),
    });
    if (node.content !== null) expect(html, id).toContain(node.content);
    else if (node.children.length > 0) expect(html, id).toMatch(/^<div class="wp-block-/);
    else if (node.name !== "core/site-logo") expect(unrendered, id).toEqual([node.name]);
  }
});

test("published Site Logo without a logo renders nothing, so the Site shows its title", () => {
  const unrendered: string[] = [];
  const logo = blocks.find((entry) => entry.fixture === "core-site-logo")!.node;
  expect(
    content.renderDesignPattern([strip(logo)], {
      onUnrendered: (block) => unrendered.push(block.name),
    }),
  ).toBe("");
  expect(unrendered).toEqual([]);
});
