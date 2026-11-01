import { z } from "zod";
import { fontPreloads, fontStyleSheet, textStyleSheet } from "@quick-release/design-renderer";
import type { DesignFonts, DesignTextStyles } from "@quick-release/design-contract";
import { escapeAttribute } from "./html";

export type { DesignFonts, DesignTextStyles } from "@quick-release/design-contract";

/**
 * GQ Design's Site fonts and Heading/Paragraph text styles (wire contract
 * 2.1.0, `designTokens { fonts textStyles }`). Both are optional: a CMS whose
 * GQ Design predates them (contract 2.0.0) delivers neither, and so does a
 * design publication stored before them.
 */
export interface DesignTypography {
  fonts?: DesignFonts;
  textStyles?: DesignTextStyles;
}

const slot = z.enum(["sans", "serif", "mono"]);
const size = z.enum([
  "xs",
  "sm",
  "base",
  "lg",
  "xl",
  "2xl",
  "3xl",
  "4xl",
  "5xl",
  "6xl",
  "7xl",
  "8xl",
  "9xl",
]);
const textStyle = {
  slot,
  weight: z.string(),
  lineHeight: z.string(),
  letterSpacing: z.string(),
};

/** The contract's `fonts`; GraphQL's null (no fonts delivered) reads as absent. */
export const designFontsSchema = z
  .object({
    families: z.array(
      z.object({
        slug: z.string(),
        name: z.string(),
        fallback: z
          .object({
            local: z.string(),
            sizeAdjust: z.string(),
            ascentOverride: z.string(),
            descentOverride: z.string(),
            lineGapOverride: z.string(),
          })
          .nullable(),
        faces: z.array(
          z.object({
            src: z.array(z.string()).nonempty(),
            format: z.enum(["woff2", "woff", "truetype", "opentype"]),
            weight: z.string(),
            style: z.enum(["normal", "italic", "oblique"]),
            unicodeRange: z.string(),
            display: z.enum(["auto", "block", "swap", "fallback", "optional"]),
            preload: z.boolean(),
          }),
        ),
      }),
    ),
    slots: z.object({
      sans: z.string().nullable(),
      serif: z.string().nullable(),
      mono: z.string().nullable(),
    }),
  })
  .nullish()
  .transform((fonts) => (fonts ?? undefined) as DesignFonts | undefined);

/** The contract's `textStyles`; GraphQL's null reads as absent. */
export const designTextStylesSchema = z
  .object({
    heading: z.object({
      ...textStyle,
      sizes: z.object({ h1: size, h2: size, h3: size, h4: size, h5: size, h6: size }),
    }),
    paragraph: z.object(textStyle),
  })
  .nullish()
  .transform((styles) => (styles ?? undefined) as DesignTextStyles | undefined);

/** Hosts a Site's fonts must never come from (ADR 0006 in gq-design). */
const GOOGLE = /(?:^|\.)(?:googleapis\.com|gstatic\.com|google\.com)$/i;

function selfHosted(src: string): boolean {
  try {
    const url = new URL(src);
    return (url.protocol === "https:" || url.protocol === "http:") && !GOOGLE.test(url.hostname);
  } catch {
    return false;
  }
}

/**
 * The fonts with only faces whose every file is an absolute URL off Google's
 * hosts. GQ Design already rejects any other host; this keeps a visitor's
 * browser from ever contacting Google even if a stored publication says otherwise.
 */
function selfHostedFonts(fonts: DesignFonts | undefined): DesignFonts | undefined {
  if (!fonts) return undefined;
  return {
    ...fonts,
    families: fonts.families.map((family) => ({
      ...family,
      faces: family.faces.filter((face) => face.src.every(selfHosted)),
    })),
  };
}

/**
 * The `@font-face` rules (Site faces with `font-display` as delivered, and the
 * metric-matched fallback faces) and the assigned slots' `--gqd-font-*` stacks.
 * GQ Design sets the stacks on `:root` and, with doubled specificity, on the
 * content root: the theme stylesheet declares the system stacks on that root,
 * which would otherwise shadow the assignment inside Design content.
 */
export function designFontStyleSheet(fonts?: DesignFonts | null, root = ".gqd-content"): string {
  return fontStyleSheet(selfHostedFonts(fonts ?? undefined), root);
}

/** At most two WOFF2 preloads GQ Design marks (the text styles' primary Latin faces). */
export function designFontPreloads(fonts?: DesignFonts | null) {
  return fontPreloads(selfHostedFonts(fonts ?? undefined));
}

/** The Heading and Paragraph text styles for Design content under `root`. */
export function designTextStyleSheet(
  textStyles?: DesignTextStyles | null,
  root = ".gqd-content",
): string {
  return textStyleSheet(textStyles ?? undefined, root);
}

/**
 * The document head's font markup for the delivered design presets: the font
 * preloads (`<link rel="preload" as="font" type="font/woff2" crossorigin>`),
 * then the font and text style sheets. Emit it once per response, after
 * `designThemeStyleSheet(theme)`. Without fonts or text styles (an older CMS
 * or design publication) it is empty; font URLs only ever come from the presets.
 */
export function designFontsHead(
  design?: DesignTypography | null,
  options: { root?: string } = {},
): string {
  const root = options.root ?? ".gqd-content";
  const links = designFontPreloads(design?.fonts).map(
    (link) =>
      `<link rel="preload" as="font" type="${escapeAttribute(link.type)}" href="${escapeAttribute(link.href)}" crossorigin>`,
  );
  const fonts = designFontStyleSheet(design?.fonts, root);
  const text = designTextStyleSheet(design?.textStyles, root);
  return [
    ...links,
    ...(fonts ? [`<style data-gqd-fonts>${fonts}</style>`] : []),
    ...(text ? [`<style data-gqd-text-styles>${text}</style>`] : []),
  ].join("");
}
