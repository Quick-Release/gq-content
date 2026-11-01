import { expect, test, vi } from "vite-plus/test";
import { readFileSync } from "node:fs";
import { fileURLToPath } from "node:url";

const consumer = process.env.DESIGN_CONSUMER_MODULE;
const server = process.env.DESIGN_CONSUMER_SERVER_MODULE;
if (!consumer || !server)
  throw new Error("Run vp run design-fixtures to test the packed public consumer");
const content: typeof import("@getquick/content") = await import(consumer);
const { createContentRuntime }: typeof import("@getquick/content/server") = await import(server);

type Tokens = Record<string, unknown> & { contractVersion: string };
const published = JSON.parse(
  readFileSync(
    fileURLToPath(
      import.meta.resolve("@quick-release/design-contract/fixtures/tokens/default.json"),
    ),
    "utf8",
  ),
) as Tokens;
const compatibility = JSON.parse(
  readFileSync(
    fileURLToPath(import.meta.resolve("@quick-release/design-contract/compatibility.json")),
    "utf8",
  ),
) as { contractVersion: string };

/** The same tokens as a 2.0.0 CMS (GQ Design 0.9.x) serves them: no fonts or text styles. */
const { fonts: _fonts, textStyles: _textStyles, ...withoutTypography } = published;
const contract200: Tokens = { ...withoutTypography, contractVersion: "2.0.0" };

/** The design presets the packed runtime reads from WPGraphQL answering with `tokens`. */
async function readPresets(tokens: Tokens, rejectsTypography = false) {
  vi.stubGlobal(
    "fetch",
    vi.fn(async (_url: string, init: RequestInit) => {
      const { query } = JSON.parse(init.body as string) as { query: string };
      if (rejectsTypography && query.includes("fonts {"))
        return Response.json({
          errors: [{ message: 'Cannot query field "fonts" on type "DesignTokens".' }],
        });
      // GraphQL's designTokens is the REST document plus its non-null spacing presets.
      return Response.json({ data: { designTokens: { ...tokens, spacingSizes: [] } } });
    }),
  );
  const warn = vi.spyOn(console, "warn").mockImplementation(() => {});
  try {
    const runtime = createContentRuntime({
      site: "Fixture",
      graphqlEndpoint: "https://cms.example.test/graphql",
      cmsOrigin: "https://cms.example.test",
      isServer: () => true,
      bindings: () => ({}),
    });
    const read = await runtime.wordpress.getDesignPresets();
    if (read.kind !== "found") throw new Error(`Design presets not read: ${JSON.stringify(read)}`);
    return read.content;
  } finally {
    warn.mockRestore();
    vi.unstubAllGlobals();
  }
}

test("the pinned contract is 2.1.0 and its published tokens carry fonts and text styles", () => {
  expect(compatibility.contractVersion).toBe("2.1.0");
  expect(published.contractVersion).toBe("2.1.0");
  expect(published).toHaveProperty("fonts.families");
  expect(published).toHaveProperty("textStyles.heading.sizes.h1");
});

test("published 2.1.0 tokens validate and render the head's fonts and text styles", async () => {
  const presets = await readPresets(published);
  expect(presets.fonts).toEqual(published.fonts);
  expect(presets.textStyles).toEqual(published.textStyles);
  const head = content.designFontsHead(presets);
  // The fixture's families have no faces and no slot is assigned: no faces, no
  // preloads, no slot stacks; only the text styles.
  expect(head).not.toMatch(/@font-face|<link|--gqd-font-sans:/);
  expect(head).toBe(
    `<style data-gqd-text-styles>${content.designTextStyleSheet(presets.textStyles)}</style>`,
  );
});

test("2.0.0 tokens, delivered or rejected by the CMS's schema, validate without fonts", async () => {
  for (const presets of [await readPresets(contract200), await readPresets(contract200, true)]) {
    expect(presets).not.toHaveProperty("fonts");
    expect(presets).not.toHaveProperty("textStyles");
    expect(presets.theme).toEqual(content.resolveDesignTheme(published.theme));
    expect(content.designFontsHead(presets)).toBe("");
  }
});
