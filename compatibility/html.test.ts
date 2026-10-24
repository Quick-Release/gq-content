import { expect, test } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";
import { parseFragment } from "parse5";
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
  expect(html).toContain("muted loop playsinline");
  expect(html).toContain('preload="metadata"');
  expect(html).not.toMatch(/<video[^>]*\sautoplay(?:\s|=|>)/);
  expect(html).toMatch(/<p[^>]*>Accessible overlay<\/p>/);
  expect(content.hasVideoHero([project(node)])).toBe(true);
});

test("every enabled published manifest block resolves to a neutral fixture and survives the HTML boundary", () => {
  expect(manifest.blocks.filter((block) => block.enabled)).toHaveLength(30);
  for (const block of manifest.blocks.filter((block) => block.enabled)) {
    const node = named(block.rendererFixture);
    expect(node.name).toBe(block.name);
    // Deliberately supplied CMS HTML, not HTML invented from contract attributes.
    const shell =
      block.name === "getquick-design/video-hero"
        ? '<section class="cms-output"><div class="gqd-video-hero__media"></div><div class="gqd-video-hero__content">CMS content</div></section>'
        : block.name === "core/image"
          ? '<figure class="cms-output" data-proof="source"><img src="https://example.test/cms.jpg" alt="CMS image"><figcaption>CMS content</figcaption></figure>'
          : '<div class="cms-output" data-proof="source">CMS content</div>';
    const parsed = content.parseWordPressBlocks(JSON.stringify([project(node, shell)]));
    expect(parsed[0].name).toBe(block.name);
    expect(parsed[0].attributes).toEqual(node.attributes);
    const html = content.renderWordPressBlocks(parsed);
    if (block.name === "getquick-design/video-hero") {
      expect(html).toContain("gqd-video-hero__content");
      expect(html).toContain("CMS content");
      expect(content.hasVideoHero(parsed)).toBe(true);
    } else if (block.name === "getquick-design/sliders") {
      // Published empty Carousel composes its required navigation child; the
      // supplied wrapper text is not slide content. Its shell identity survives.
      expect(html).toContain("data-gqd-carousel");
      expect(html).toContain('aria-label="Carousel navigation"');
      expect(html).toContain('data-proof="source"');
      expect(html).toContain("cms-output");
      expect(parsed[0].innerBlocks?.[0].attributes).toEqual(node.children[0].attributes);
    } else {
      expect(html).toContain("CMS content");
      expect(html).toContain('data-proof="source"');
      expect(html).toContain("cms-output");
    }
  }
});

test("published YouTube attributes use a decorative privacy-enhanced looping embed", () => {
  const html = content.renderWordPressBlocks([project(named("getquick-video-hero-youtube"))]);
  expect(html).toContain('data-src="https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?');
  expect(html).not.toMatch(/<iframe[^>]*\ssrc=/);
  expect(html).toContain("playlist=dQw4w9WgXcQ");
  expect(html).toContain('tabindex="-1" aria-hidden="true"');
  expect(html).toContain('class="gqd-video-hero__content"');
  expect(html).toMatch(/<p[^>]*>Accessible overlay<\/p>/);
  expect(html).toContain('title="Video &quot;di&quot; sfondo &amp; musica"');
});

test.each(["empty", "unsafe", "wrong-types", "invalid-youtube"])(
  "published %s Video Hero keeps overlay and omits absent or rejected media",
  (variant) => {
    const html = content.renderWordPressBlocks([project(named(`getquick-video-hero-${variant}`))]);
    expect(html).toMatch(/<p[^>]*>Accessible overlay<\/p>/);
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
    expect(html).toMatch(/<p[^>]*>Contract example<\/p>/);
    expect(html).toContain("<div>Fallback content</div>");
    expect(html).toContain('src="https://example.test/background.mp4"');
    expect(html).toContain("https://www.youtube-nocookie.com/embed/dQw4w9WgXcQ?");
  },
);

test("published bare Container adds canonical classes without implicit centering or padding", () => {
  const node = named("getquick-container");
  const shell = '<div class="wp-block-getquick-design-container"></div>';
  const html = content.renderWordPressBlocks([project(node, shell)]);
  expect(html).toBe(content.containerLayoutHtml(shell, node.attributes));
  expect(html).toContain("wp-block-getquick-design-container gqd-presentation");
  expect(html).not.toMatch(/--gqd-(?:base|parent-layout|layout)-/);
  const css = content.presentationStyleSheet();
  expect(css).toContain("--gqd-container-cap");
  expect(css).toContain("40rem");
  expect(css).toContain("96rem");
});

test("published nested Containers retain independent sizing, explicit centering and upward overrides", () => {
  const { blocks: containers } = fixture<{ blocks: { node: FixtureNode }[] }>(
    "blocks/container-presentation.json",
  );
  const node = containers[0].node;
  // Supporting CMS shells, not claimed as published HTML.
  const shells = (node: FixtureNode): ReturnType<typeof project> => ({
    ...project(node, '<div class="wp-block-getquick-design-container"></div>'),
    innerBlocks: node.children.map(shells),
  });
  const html = content.renderWordPressBlocks([shells(node)]);
  const root = parseFragment(html).childNodes[0];
  if (!("childNodes" in root)) throw new Error("Missing Container root");
  const children = root.childNodes.filter((node) => "tagName" in node && node.tagName === "div");
  expect(children).toHaveLength(2);
  const style = (node: (typeof children)[number]) =>
    "attrs" in node ? (node.attrs.find((attr) => attr.name === "style")?.value ?? "") : "";
  expect(style(children[0])).toBe("");
  expect(style(children[1])).toContain("--gqd-base-width:50.00000000%");
  expect(style(children[1])).toContain("--gqd-base-marginInline:auto");
  expect(style(children[1])).toContain(
    "--gqd-base-paddingInline:calc(var(--gqd-spacing, 0.25rem) * 4)",
  );
  expect(style(children[1])).toContain("--gqd-md-width:100%");
  expect(style(children[1])).toContain("--gqd-lg-maxWidth:var(--gqd-container-lg, 32rem)");
  expect(html).toContain("Bare nested container");
  expect(html).toContain("Authored nested container");
  expect(html).not.toMatch(/gqd-container-layout|--gqd-parent-layout|--gqd-layout-/);
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
