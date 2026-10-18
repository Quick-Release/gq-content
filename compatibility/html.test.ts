import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { project, type FixtureNode } from "./projection";

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
const manifest = fixture<{
  blocks: {
    name: string;
    enabled: boolean;
    rendererFixture: string;
    attributes: Record<string, string>;
    supports: Record<string, unknown>;
  }[];
}>("manifest/default.json");
const named = (id: string) => {
  const entry = blocks.find((entry) => entry.fixture === id);
  if (!entry) throw new Error(`Missing published fixture: ${id}`);
  return entry.node;
};

test("published self-hosted Video Hero attributes render media and accessible overlay", () => {
  const node = named("getquick-video-hero-self-hosted");
  const html = content.renderWordPressBlocks(content.parseWordPressBlocks([project(node)]));
  expect(html).toContain('src="https://example.test/background.mp4"');
  expect(html).toContain('poster="https://example.test/poster.jpg"');
  expect(html).toContain("autoplay muted loop playsinline");
  expect(html).toContain("<p>Accessible overlay</p>");
  expect(content.hasVideoHero([project(node)])).toBe(true);
});

test("every enabled published manifest block resolves to a neutral fixture and survives the HTML boundary", () => {
  expect(manifest.blocks.filter((block) => block.enabled)).toHaveLength(30);
  for (const block of manifest.blocks.filter((block) => block.enabled)) {
    const node = named(block.rendererFixture);
    expect(node.name).toBe(block.name);
    // Deliberately supplied CMS HTML, not HTML invented from contract attributes.
    const shell = '<div class="cms-output">CMS content</div>';
    const parsed = content.parseWordPressBlocks(JSON.stringify([project(node, shell)]));
    expect(parsed[0].name).toBe(block.name);
    expect(parsed[0].attributes).toEqual(node.attributes);
    const html = content.renderWordPressBlocks(parsed);
    if (block.name === "getquick-design/video-hero") {
      expect(html).toContain("wp-block-getquick-design-video-hero__content");
      expect(content.hasVideoHero(parsed)).toBe(true);
    } else {
      expect(html).toBe(shell);
    }
  }
});

test("published YouTube attributes use a decorative privacy-enhanced looping embed", () => {
  const html = content.renderWordPressBlocks([project(named("getquick-video-hero-youtube"))]);
  expect(html).toContain('src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?');
  expect(html).toContain("playlist=dQw4w9WgXcQ");
  expect(html).toContain('tabindex="-1" aria-hidden="true"');
  expect(html).toContain(
    '<div class="wp-block-getquick-design-video-hero__content"><p>Accessible overlay</p></div>',
  );
  // Content's existing decorative-media policy retains its fixed title.
  expect(html).toContain('title="Decorative background video"');
});

test.each(["empty", "unsafe", "wrong-types", "invalid-youtube"])(
  "published %s Video Hero keeps overlay and omits absent or rejected media",
  (variant) => {
    const html = content.renderWordPressBlocks([project(named(`getquick-video-hero-${variant}`))]);
    expect(html).toContain("<p>Accessible overlay</p>");
    expect(html).not.toMatch(/<video\b|<iframe\b/);
    if (variant === "invalid-youtube") {
      expect(html).toContain('src="https://example.test/poster.jpg"');
    } else {
      expect(html).not.toContain("<img");
    }
  },
);

test.each(["default-ltr", "rtl", "fallback"])(
  "published %s layout retains nested content, unsupported HTML and media",
  (variant) => {
    const layout = fixture<{ regions: { slot: string; blocks: FixtureNode[] }[] }>(
      `layout/${variant}.json`,
    );
    const region = layout.regions.find((region) => region.slot === "content");
    expect(region).toBeDefined();
    const html = content.renderWordPressBlocks(
      content.parseWordPressBlocks(region!.blocks.map((node) => project(node))),
    );
    expect(html).toContain("<p>Contract example</p>");
    expect(html).toContain("<div>Fallback content</div>");
    expect(html).toContain('src="https://example.test/background.mp4"');
    expect(html).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?");
  },
);

test("published container default preserves CMS HTML without inventing layout defaults", () => {
  const node = named("getquick-container");
  const shell = '<div class="wp-block-getquick-design-container"></div>';
  expect(content.renderWordPressBlocks([project(node, shell)])).toBe(shell);
  expect(content.containerLayoutHtml(shell, node.attributes)).toBe(shell);
});

test("manifest-advertised container layout and spacing support the HTML helper's constrained layout", () => {
  const block = manifest.blocks.find((block) => block.name === "getquick-design/container")!;
  expect(block.attributes).toMatchObject({ layout: "object", style: "object" });
  expect(block.supports).toMatchObject({
    layout: { allowInheriting: true },
    spacing: { blockGap: true, padding: true },
  });
  // The published node has no populated layout. These are explicit Content
  // contract cases for manifest-advertised attributes, not published examples.
  const node = named("getquick-container");
  const parent = project(
    {
      ...node,
      attributes: {
        ...node.attributes,
        layout: {
          type: "constrained",
          contentSize: "48rem",
          wideSize: "72rem",
          justifyContent: "left",
        },
        style: {
          spacing: { blockGap: "var:preset|spacing|40", padding: { left: "2rem", right: "3rem" } },
        },
      },
    },
    '<div class="wp-block-getquick-design-container"></div>',
  );
  parent.innerBlocks = [
    project(node, '<div class="wp-block-getquick-design-container">Nested</div>'),
  ];
  const html = content.renderWordPressBlocks([parent]);
  expect(html).toContain("gqd-container-layout--constrained");
  expect(html).toContain("--gqd-layout-content:48rem;--gqd-layout-wide:72rem");
  expect(html).toContain("--gqd-layout-gap:var(--wp--preset--spacing--40)");
  expect(html).toContain("--gqd-layout-padding-left:2rem;--gqd-layout-padding-right:3rem");
  expect(html).toContain("--gqd-parent-layout-content:48rem");
  expect(html).toContain("--gqd-parent-layout-left:0;--gqd-parent-layout-right:auto");
  expect(html).toContain(">Nested</div></div>");
  const presets = content.blockPresetStyles(
    [{ slug: "40", size: "1.5rem" }],
    [{ slug: "brand", color: "#123456" }],
  );
  expect(presets.vars).toEqual({
    "--wp--preset--spacing--40": "1.5rem",
    "--wp--preset--color--brand": "#123456",
  });
  expect(presets.colorRules).toContain(
    ".prose-wp .has-brand-color{color:var(--wp--preset--color--brand)}",
  );
});
