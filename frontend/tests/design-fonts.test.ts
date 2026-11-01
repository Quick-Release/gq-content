import { expect, test } from "vite-plus/test";
import {
  designFontPreloads,
  designFontsHead,
  designThemeStyleSheet,
  presentationModel,
  presentationStyleSheet,
  resolveDesignTheme,
  type DesignFonts,
  type DesignPresets,
  type DesignTextStyles,
} from "@getquick/content";

// The shape the cooldowngaming.com sandbox delivers once Inter is imported and
// assigned to the sans slot: one variable WOFF2 per script subset on the Site's
// media host, GQ Design's metric-matched fallback, and the producer's preload
// flag on the primary Latin face only.
const MEDIA = "https://media.cooldowngaming.com/fonts/inter/4.1";
const inter: DesignFonts = {
  families: [
    {
      slug: "inter",
      name: "Inter",
      fallback: {
        local: "Arial",
        sizeAdjust: "107.06%",
        ascentOverride: "90.49%",
        descentOverride: "22.56%",
        lineGapOverride: "0%",
      },
      faces: [
        {
          src: [`${MEDIA}/inter-latin-ext-variable.woff2`],
          format: "woff2",
          weight: "100 900",
          style: "normal",
          unicodeRange:
            "U+0100-02BA, U+02BD-02C5, U+02C7-02CC, U+02CE-02D7, U+02DD-02FF, U+0304, U+0308, U+0329, U+1D00-1DBF, U+1E00-1E9F, U+1EF2-1EFF, U+2020, U+20A0-20AB, U+20AD-20C0, U+2113, U+2C60-2C7F, U+A720-A7FF",
          display: "swap",
          preload: false,
        },
        {
          src: [`${MEDIA}/inter-latin-variable.woff2`],
          format: "woff2",
          weight: "100 900",
          style: "normal",
          unicodeRange:
            "U+0000-00FF, U+0131, U+0152-0153, U+02BB-02BC, U+02C6, U+02DA, U+02DC, U+0304, U+0308, U+0329, U+2000-206F, U+20AC, U+2122, U+2191, U+2193, U+2212, U+2215, U+FEFF, U+FFFD",
          display: "swap",
          preload: true,
        },
      ],
    },
  ],
  slots: { sans: "inter", serif: null, mono: null },
};
const textStyles: DesignTextStyles = {
  heading: {
    slot: "sans",
    weight: "700",
    lineHeight: "1.2",
    letterSpacing: "-0.02em",
    sizes: { h1: "5xl", h2: "4xl", h3: "3xl", h4: "2xl", h5: "xl", h6: "lg" },
  },
  paragraph: { slot: "sans", weight: "400", lineHeight: "1.6", letterSpacing: "0em" },
};
const theme = resolveDesignTheme(undefined);
const presets20: DesignPresets = { theme, colors: [], spacingSizes: [] };
const sandbox: DesignPresets = { ...presets20, fonts: inter, textStyles };

/** The head the blueprint Layout writes: theme first, then the fonts. */
const head = (design: DesignPresets | null) =>
  `<style>${designThemeStyleSheet(theme)}</style>${designFontsHead(design)}`;

test("without fonts or text styles (a 2.0.0 CMS, or presets stored before them) the head is unchanged", () => {
  expect(designFontsHead(null)).toBe("");
  expect(designFontsHead(undefined)).toBe("");
  expect(designFontsHead(presets20)).toBe("");
  expect(head(presets20)).toBe(`<style>${designThemeStyleSheet(theme)}</style>`);
  expect(head(presets20)).not.toMatch(/@font-face|rel="preload"/);
});

test("an empty families list emits no faces, preloads or slot stacks", () => {
  const empty: DesignFonts = { families: [], slots: { sans: null, serif: null, mono: null } };
  expect(designFontsHead({ ...presets20, fonts: empty })).toBe("");
  // Text styles still apply, on the system stacks the theme declares.
  const html = designFontsHead({ ...presets20, fonts: empty, textStyles });
  expect(html).not.toMatch(/@font-face|<link|--gqd-font-sans:/);
  expect(html).toContain("<style data-gqd-text-styles>");
  expect(html).toContain(".gqd-content.gqd-content h1{font-size:var(--gqd-text-5xl);}");
});

test("the sandbox's Inter on sans renders its faces, one crossorigin preload, slot stacks and text styles", () => {
  const html = head(sandbox);
  const fonts = designFontsHead(sandbox);

  // Exactly one preload: the flagged Latin face, as the HTML parser needs it
  // (a font preload without crossorigin is fetched twice).
  expect(fonts.match(/<link [^>]*>/g)).toEqual([
    `<link rel="preload" as="font" type="font/woff2" href="${MEDIA}/inter-latin-variable.woff2" crossorigin>`,
  ]);
  // The preloads come first, then the faces and stacks, then the text styles.
  expect(fonts.indexOf("<link")).toBe(0);
  expect(fonts.indexOf("<style data-gqd-fonts>")).toBeLessThan(
    fonts.indexOf("<style data-gqd-text-styles>"),
  );

  // Both subsets, swap display and their unicode ranges.
  for (const subset of ["latin", "latin-ext"]) {
    expect(fonts).toContain(
      `@font-face{font-family:"Inter";src:url("${MEDIA}/inter-${subset}-variable.woff2") format("woff2");font-weight:100 900;font-style:normal;font-display:swap;unicode-range:`,
    );
  }
  expect(fonts.match(/@font-face\{font-family:"Inter";/g)).toHaveLength(2);
  // The local metric-matched fallback needs no network request.
  expect(fonts).toContain(
    '@font-face{font-family:"Inter Fallback";src:local("Arial");size-adjust:107.06%;ascent-override:90.49%;descent-override:22.56%;line-gap-override:0%;}',
  );

  // The sans stack is assigned on :root and on the content root, after (and
  // more specific than) the theme's system stack there.
  const stack = '--gqd-font-sans:"Inter", "Inter Fallback", sans-serif;';
  expect(fonts).toContain(`:root,.gqd-content.gqd-content{${stack}}`);
  expect(fonts.match(/--gqd-font-sans:/g)).toHaveLength(1);
  expect(fonts).not.toContain("--gqd-font-serif:");
  const themeStack = html.indexOf(".gqd-content{--gqd-spacing");
  expect(themeStack).toBeGreaterThan(-1);
  expect(html.lastIndexOf(`.gqd-content.gqd-content{${stack}}`)).toBeGreaterThan(themeStack);

  // Heading and Paragraph on sans, the heading sizes from the size scale.
  expect(fonts).toContain(
    ".gqd-content.gqd-content{font-family:var(--gqd-font-sans);font-weight:400;line-height:1.6;letter-spacing:0em;}",
  );
  expect(fonts).toContain(
    ".gqd-content.gqd-content h6{font-family:var(--gqd-font-sans);font-weight:700;line-height:1.2;letter-spacing:-0.02em;}",
  );
  expect(fonts).toContain(".gqd-content.gqd-content h1{font-size:var(--gqd-text-5xl);}");
  // The text styles follow the theme's Preflight, which resets headings.
  expect(html.indexOf("<style data-gqd-text-styles>")).toBeGreaterThan(
    html.indexOf("font-family: var(--gqd-font-sans)"),
  );

  expect(html).not.toMatch(/google/i);
});

test("font URLs only come from the presets, never from Google", () => {
  const google: DesignFonts = {
    ...inter,
    families: [
      {
        ...inter.families[0]!,
        faces: [
          {
            ...inter.families[0]!.faces[1]!,
            src: ["https://fonts.gstatic.com/s/inter/v18/latin.woff2"],
          },
          ...inter.families[0]!.faces,
          { ...inter.families[0]!.faces[1]!, src: ["/fonts/relative.woff2"] },
        ],
      },
    ],
  };
  const html = designFontsHead({ ...presets20, fonts: google, textStyles });
  expect(html).not.toMatch(/gstatic|googleapis|relative\.woff2/);
  expect(html.match(/@font-face\{font-family:"Inter";/g)).toHaveLength(2);
  expect(designFontPreloads(google).map((link) => link.href)).toEqual([
    `${MEDIA}/inter-latin-variable.woff2`,
  ]);
});

test("preloads are capped at two and escaped as attributes", () => {
  const face = inter.families[0]!.faces[1]!;
  const many: DesignFonts = {
    families: [
      {
        ...inter.families[0]!,
        faces: ["a", "b", 'c"><script>'].map((name) => ({
          ...face,
          src: [`${MEDIA}/${name}.woff2`] as [string],
        })),
      },
    ],
    slots: inter.slots,
  };
  const links = designFontsHead({ ...presets20, fonts: many }).match(/<link [^>]*>/g);
  expect(links).toHaveLength(2);
  expect(
    designFontsHead({
      ...presets20,
      fonts: {
        ...many,
        families: [{ ...many.families[0]!, faces: [many.families[0]!.faces[2]!] }],
      },
    }),
  ).not.toContain("<script>");
});

test("a Site's own content root scopes the stacks and text styles", () => {
  const html = designFontsHead(sandbox, { root: ".site" });
  expect(html).toContain(':root,.site.site{--gqd-font-sans:"Inter"');
  expect(html).not.toContain(".gqd-content");
  expect(html).toContain(".site.site h1{font-size:var(--gqd-text-5xl);}");
  const global = designFontsHead(sandbox, { root: ":root" });
  expect(global).toContain(':root{--gqd-font-sans:"Inter"');
  expect(global).not.toMatch(/:root:root|:root,:root/);
  expect(() => designFontsHead(sandbox, { root: "body > main" })).toThrow();
});

test("a bad stored text style value is dropped without breaking the head", () => {
  const html = designFontsHead({
    ...sandbox,
    textStyles: { ...textStyles, paragraph: { ...textStyles.paragraph, weight: "400;}body{" } },
  });
  expect(html).toContain("<style data-gqd-fonts>");
  expect(html).not.toContain("body{");
  expect(html).toContain(".gqd-content.gqd-content h1{font-size:var(--gqd-text-5xl);}");
});

/** Each `selector{declarations}` of a style sheet, @media preludes stripped. */
const rules = (css: string) =>
  [...css.matchAll(/([^{}]+)\{([^{}]*)\}/g)].map(([, selector, body]) => ({
    selectors: selector!.replace(/^\s*@media[^{]*$/, "").split(/,(?![^()]*\))/),
    body: body!,
  }));

test("a plain heading's presentation leaves typography to the text styles", () => {
  // GQ Design 0.10.2 (gq-design#121) has no core/heading typography defaults,
  // so the canonical presentation no longer forces `inherit !important` over
  // the text styles' heading sizes on headings without authored values.
  const defaults = presentationModel.defaults["core/heading"] ?? {};
  for (const property of ["fontFamily", "fontSize", "fontWeight", "lineHeight", "letterSpacing"])
    expect(defaults).not.toHaveProperty(property);

  const typography = /(?:^|;)\s*(?:font-size|font-family|font-weight|line-height|letter-spacing):/;
  const heading = rules(presentationStyleSheet(theme)).filter(({ selectors }) =>
    selectors.some((selector) => selector.includes(".wp-block-heading.gqd-presentation")),
  );
  const forced = heading.filter(
    ({ selectors, body }) =>
      typography.test(body) &&
      body.includes("!important") &&
      selectors.some(
        (selector) =>
          selector.includes(".wp-block-heading.gqd-presentation") &&
          !/\[style\*="--gqd-[\w-]*-(?:fontSize|fontFamily|fontWeight|lineHeight|letterSpacing)/.test(
            selector,
          ),
      ),
  );
  expect(forced).toEqual([]);
  // Authored heading sizes still apply, behind their own variable.
  expect(
    heading.some(
      ({ selectors, body }) =>
        /(?:^|;)font-size:var\(--gqd-resolved-fontSize\) !important/.test(body) &&
        selectors.every((selector) => selector.includes('[style*="--gqd-')),
    ),
  ).toBe(true);
});
