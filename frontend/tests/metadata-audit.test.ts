import { describe, expect, it } from "vite-plus/test";
import {
  resolveMetadata,
  renderMetadataHead,
  type MetadataInput,
} from "@getquick/content/metadata";
import {
  inspectMetadataHtml,
  assertMetadataHtml,
  type MetadataHtmlExpectation,
} from "@getquick/content/metadata/testing";
import { mapPublishedContentMetadata } from "@getquick/content/metadata/content";
const image = {
  url: "https://assets.example.com/share.png",
  alt: "Image",
  width: 1200,
  height: 630,
  type: "image/png" as const,
};
const language = { lang: "en-US", locale: "en_US", dir: "ltr" as const };
const base: MetadataInput = {
  site: {
    origin: "https://example.com",
    name: "Example",
    title: "Title",
    description: "Summary",
    language,
    images: [image],
  },
  state: "public",
  status: 200,
  canonical: "https://example.com/",
};
const expected: MetadataHtmlExpectation = {
  baseline: "OG-1",
  applicable: true,
  lang: "en-US",
  dir: "ltr",
  robots: "index, follow",
  title: "Title",
  canonical: "https://example.com/",
  description: "Summary",
  siteName: "Example",
  locale: "en_US",
  type: "website",
  images: [image],
};
const document = (input: MetadataInput) => {
  const resolved = resolveMetadata(input);
  return Buffer.from(
    `<!doctype html><html lang="${resolved.htmlAttributes.lang}" dir="${resolved.htmlAttributes.dir}" prefix="${resolved.htmlAttributes.prefix ?? ""}"><head>${renderMetadataHead(resolved)}</head><body></body></html>`,
  ).toString("utf8");
};
describe("independent audit regressions", () => {
  it("R1-1 checks injected attributes on independently authored pending and excluded HTML", () => {
    const pending =
      '<!doctype html><html lang="en-US" dir="ltr"><head><meta name="robots" content="index, follow"><title onmouseover="alert(1)">Title</title><link rel="canonical" href="https://example.com/"><meta name="description" content="Summary"></head><body></body></html>';
    expect(inspectMetadataHtml(pending, { ...expected, graph: false })).toContain(
      "Unexpected attribute on title",
    );
    const excluded =
      '<!doctype html><html lang="en-US" dir="ltr"><head><meta name="robots" content="noindex, nofollow" onclick="alert(1)"><title onmouseover="alert(1)">Sign in</title></head><body></body></html>';
    const issues = inspectMetadataHtml(excluded, {
      baseline: "OG-1",
      applicable: false,
      lang: "en-US",
      dir: "ltr",
      robots: "noindex, nofollow",
      title: "Sign in",
    });
    expect(issues).toContain("Unexpected attribute on title");
    expect(issues).toContain("Unexpected attribute on meta");
  });
  it("R1-2 preserves plain image alt through mapping, escaping and final HTML parsing", () => {
    for (const alt of ["How <meta> works", "<meta>", "Literal &amp; and 🌊"]) {
      const mapped = mapPublishedContentMetadata(
        { title: "Title", featuredImage: { sourceUrl: image.url, altText: alt } },
        {
          site: base.site,
          route: "/",
          featuredImageFacts: { width: 1200, height: 630, type: "image/png" },
        },
      );
      expect(mapped.page?.images?.[0]?.alt).toBe(alt);
      expect(resolveMetadata(mapped).graphReady).toBe(true);
      assertMetadataHtml(document(mapped), { ...expected, images: [{ ...image, alt }] });
    }
  });
  it("R1-3 diagnoses NUL and unpaired surrogates while retaining valid document basics", () => {
    for (const invalid of ["A\u0000B", "A\ud800B", "A\udc00B"]) {
      const input = { ...base, page: { title: invalid } };
      const resolved = resolveMetadata(input);
      expect(resolved.ready).toBe(false);
      expect(resolved.graphReady).toBe(false);
      expect(resolved.documentReady).toBe(false);
      expect(
        resolved.diagnostics.some((d) => d.field === "title" && d.message.includes("UTF")),
      ).toBe(true);
      assertMetadataHtml(document(input), { ...expected, graph: false, title: undefined });
      const badAlt = { ...base, page: { images: [{ ...image, alt: invalid }] } };
      expect(resolveMetadata(badAlt).documentReady).toBe(true);
      expect(resolveMetadata(badAlt).diagnostics.some((d) => d.field === "images.0.alt")).toBe(
        true,
      );
      assertMetadataHtml(document(badAlt), { ...expected, graph: false });
      const excluded = { ...base, state: "private" as const, statusTitle: invalid };
      expect(resolveMetadata(excluded).ready).toBe(false);
      assertMetadataHtml(document(excluded), {
        baseline: "OG-1",
        applicable: false,
        lang: "en-US",
        dir: "ltr",
        robots: "noindex, nofollow",
      });
    }
    assertMetadataHtml(document({ ...base, page: { title: "Valid 🌊 𐐀 <meta> &amp;" } }), {
      ...expected,
      title: "Valid 🌊 𐐀 <meta> &amp;",
    });
  });
  it("adds x-default only for the actual current default or a published default translation", () => {
    const portuguese = { lang: "pt-PT", locale: "pt_PT_ao90", dir: "ltr" as const };
    const translated = { ...portuguese, canonical: "https://example.com/pt/", published: true };
    assertMetadataHtml(document({ ...base, translations: [translated] }), {
      ...expected,
      localeAlternates: ["pt_PT"],
      alternates: [
        { lang: "en-US", url: "https://example.com/" },
        { lang: "pt-PT", url: "https://example.com/pt/" },
        { lang: "x-default", url: "https://example.com/" },
      ],
    });
    const english = { ...language, canonical: "https://example.com/", published: true };
    const page = {
      ...base,
      language: portuguese,
      canonical: "https://example.com/pt/",
      translations: [english],
    };
    const translatedExpected = {
      ...expected,
      lang: "pt-PT",
      locale: "pt_PT",
      canonical: "https://example.com/pt/",
      localeAlternates: ["en_US"],
      alternates: [
        { lang: "pt-PT", url: "https://example.com/pt/" },
        { lang: "en-US", url: "https://example.com/" },
        { lang: "x-default", url: "https://example.com/" },
      ],
    };
    assertMetadataHtml(document(page), translatedExpected);
    assertMetadataHtml(document({ ...page, site: { ...base.site, images: [] } }), {
      ...translatedExpected,
      graph: false,
    });
    assertMetadataHtml(document({ ...page, translations: [{ ...english, published: false }] }), {
      ...translatedExpected,
      localeAlternates: [],
      alternates: [],
    });
    const french = {
      lang: "fr-FR",
      locale: "fr_FR",
      dir: "ltr" as const,
      canonical: "https://example.com/fr/",
      published: true,
    };
    assertMetadataHtml(document({ ...page, translations: [french] }), {
      ...translatedExpected,
      localeAlternates: ["fr_FR"],
      alternates: [
        { lang: "pt-PT", url: "https://example.com/pt/" },
        { lang: "fr-FR", url: "https://example.com/fr/" },
      ],
    });
    assertMetadataHtml(document(base), expected);
    const mapped = mapPublishedContentMetadata(
      { title: "Title" },
      {
        site: base.site,
        route: "/pt/",
        language: portuguese,
        alternates: [{ language, route: "/", translation: false }],
      },
    );
    assertMetadataHtml(document(mapped), {
      ...translatedExpected,
      localeAlternates: [],
      alternates: [],
    });
  });
});
