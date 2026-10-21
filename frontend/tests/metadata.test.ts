import { describe, expect, it } from "vite-plus/test";
import {
  resolveMetadata,
  renderMetadataHead,
  type MetadataInput,
} from "@getquick/content/metadata";
import {
  assertMetadataHtml,
  inspectMetadataHtml,
  type MetadataHtmlExpectation,
} from "@getquick/content/metadata/testing";
import {
  contentMetadataText,
  mapPublishedContentMetadata,
} from "@getquick/content/metadata/content";

const image = {
  url: "https://assets.example.com/share.png",
  alt: 'Sea & sky "azul"',
  width: 1200,
  height: 630,
  type: "image/png" as const,
};
const input: MetadataInput = {
  site: {
    origin: "https://example.com",
    name: "Example",
    title: "Home",
    description: "Site summary",
    language: { lang: "pt-PT", locale: "pt_PT_ao90", dir: "ltr" },
    images: [image],
  },
  state: "public",
  status: 200,
  canonical: "https://example.com/about/",
  page: { title: 'Sobre & "nós" — 日本語', description: "Public summary" },
};
// Authored facts, not values read back from resolver output.
const expected: MetadataHtmlExpectation = {
  baseline: "OG-1",
  applicable: true,
  lang: "pt-PT",
  dir: "ltr",
  robots: "index, follow",
  title: 'Sobre & "nós" — 日本語',
  canonical: "https://example.com/about/",
  description: "Public summary",
  siteName: "Example",
  locale: "pt_PT",
  type: "website",
  images: [image],
};
function document(value: MetadataInput) {
  const resolved = resolveMetadata(value);
  return `<!doctype html><html lang="${resolved.htmlAttributes.lang}" dir="${resolved.htmlAttributes.dir}" prefix="${resolved.htmlAttributes.prefix ?? ""}"><head>${renderMetadataHead(resolved)}</head><body>Public page</body></html>`;
}
describe("metadata contract and independent final HTML acceptance", () => {
  it("serializes decoded Unicode text and attributes without losing image association", () => {
    expect(resolveMetadata(input).ready).toBe(true);
    assertMetadataHtml(document(input), expected);
    expect(document(input)).toContain("&quot;");
  });
  it("preserves document basics and robots when the OG image is missing", () => {
    const value = { ...input, site: { ...input.site, images: undefined } };
    const resolved = resolveMetadata(value);
    expect(resolved.ready).toBe(false);
    expect(resolved.documentReady).toBe(true);
    expect(resolved.graphReady).toBe(false);
    expect(resolved.diagnostics.some((d) => d.field === "images")).toBe(true);
    assertMetadataHtml(document(value), { ...expected, graph: false });
    expect(document(value)).not.toContain('property="og:');
    const secret = {
      ...input,
      state: "private" as const,
      statusTitle: "Sign in & continue",
      page: { title: "Private account", description: "Password: secret" },
    };
    assertMetadataHtml(document(secret), {
      baseline: "OG-1",
      applicable: false,
      title: "Sign in & continue",
      lang: "pt-PT",
      dir: "ltr",
      robots: "noindex, nofollow",
    });
    expect(document(secret)).not.toContain("Private account");
    expect(document(secret)).not.toContain("Password");
    expect(document({ ...secret, statusTitle: "<script>secret()</script>" })).toContain(
      "&lt;script&gt;secret()&lt;/script&gt;",
    );
    const attack = {
      ...input,
      page: { title: "<img src=x onerror=secret()>", description: "<script>private()</script>" },
    };
    const head = renderMetadataHead(resolveMetadata(attack));
    expect(head).not.toContain("<img");
    expect(head).not.toContain("<script");
    expect(head).toContain("&lt;img");
    expect(head).toContain("&lt;script");
    expect(head).toContain('rel="canonical"');
  });
  it("preserves literal plain-text HTML vocabulary and metacharacters safely", () => {
    for (const title of [
      "How <meta> works",
      "Sizes < 10 > 2",
      "Literal &amp;",
      '" onload="alert(1)',
    ]) {
      assertMetadataHtml(document({ ...input, page: { ...input.page, title } }), {
        ...expected,
        title,
      });
    }
  });
  it("supports BCP 47 scripts/extensions and diagnoses conflicting configured regions", () => {
    const language = { lang: "zh-Hant-TW-u-ca-chinese", locale: "zh_TW", dir: "ltr" as const };
    assertMetadataHtml(document({ ...input, language }), {
      ...expected,
      lang: language.lang,
      locale: "zh_TW",
    });
    expect(
      resolveMetadata({ ...input, language: { lang: "pt-PT", locale: "pt_BR", dir: "ltr" } }).ready,
    ).toBe(false);
    expect(
      resolveMetadata({ ...input, language: { lang: "pt", locale: "pt_PT_ao90", dir: "ltr" } })
        .ready,
    ).toBe(true);
  });
  it("uses overrides then page facts then site defaults; invalid overrides do not fallback", () => {
    assertMetadataHtml(document({ ...input, page: undefined }), {
      ...expected,
      title: "Home",
      description: "Site summary",
    });
    assertMetadataHtml(
      document({
        ...input,
        overrides: { title: "Editorial", shareTitle: "Share", description: "Chosen" },
      }),
      { ...expected, title: "Editorial", shareTitle: "Share", description: "Chosen" },
    );
    for (const overrides of [{ title: "" }, { description: "" }, { images: [] }]) {
      const result = resolveMetadata({ ...input, overrides });
      expect(result.ready).toBe(false);
      expect(result.diagnostics.length).toBeGreaterThan(0);
      expect(renderMetadataHead(result)).not.toContain("og:");
    }
  });
  it("keeps noindex separate from public sharing eligibility", () => {
    assertMetadataHtml(document({ ...input, noindex: true }), {
      ...expected,
      robots: "noindex, nofollow",
    });
  });
  it("retains ordered image groups, actual published locale links, article facts", () => {
    const second = {
      ...image,
      url: "https://assets.example.com/second.jpg",
      alt: "Second view",
      width: 800,
      height: 600,
      type: "image/jpeg" as const,
    };
    const article = {
      publishedTime: "2026-10-20T12:00:00Z",
      modifiedTime: "2026-10-21T12:00:00+01:00",
      authors: ["https://example.com/authors/a/"],
    };
    const value: MetadataInput = {
      ...input,
      kind: "article",
      article,
      page: { ...input.page, images: [image, second] },
      translations: [
        {
          lang: "en-GB",
          locale: "en_GB",
          dir: "ltr",
          canonical: "https://example.com/en/about/",
          published: true,
        },
        {
          lang: "fr-FR",
          locale: "fr_FR",
          dir: "ltr",
          canonical: "https://example.com/fr/about/",
          published: false,
        },
      ],
    };
    assertMetadataHtml(document(value), {
      ...expected,
      type: "article",
      article,
      images: [image, second],
      localeAlternates: ["en_GB"],
      alternates: [
        { lang: "pt-PT", url: input.canonical! },
        { lang: "en-GB", url: "https://example.com/en/about/" },
      ],
    });
    expect(
      resolveMetadata({ ...value, article: { publishedTime: "2026-10-20T12:00:00" } }).ready,
    ).toBe(false);
  });
  it("rejects forged origins, tracking, credentials, fragments, signatures and unknown locale territories", () => {
    for (const canonical of [
      "http://example.com/",
      "https://evil.example/",
      "https://example.com/#x",
      "https://u:p@example.com/",
      "https://example.com/?utm_source=x",
      "https://example.com/?preview=1",
      "https://example.com/?id=2",
    ])
      expect(resolveMetadata({ ...input, canonical }).ready).toBe(false);
    expect(
      resolveMetadata({
        ...input,
        site: { ...input.site, identityQueryKeys: ["id"] },
        canonical: "https://example.com/?id=2",
      }).ready,
    ).toBe(true);
    expect(
      resolveMetadata({ ...input, language: { lang: "pt", locale: "pt", dir: "ltr" } }).ready,
    ).toBe(false);
    expect(
      resolveMetadata({
        ...input,
        page: { images: [{ ...image, url: "https://assets.example.com/share.png?signature=abc" }] },
      }).ready,
    ).toBe(false);
    expect(
      resolveMetadata({
        ...input,
        site: { ...input.site, origin: "https://localhost" },
        canonical: "https://localhost/",
      }).ready,
    ).toBe(false);
  });
  it("never leaks successful defaults or private facts on excluded states/statuses", () => {
    for (const state of ["private", "preview", "withdrawn", "error", "redirect"] as const) {
      const html = document({
        ...input,
        state,
        page: { title: "Secret", description: "Private facts" },
      });
      expect(html).not.toContain("Secret");
      expect(html).not.toContain("Private facts");
      assertMetadataHtml(html, {
        baseline: "OG-1",
        applicable: false,
        lang: "pt-PT",
        dir: "ltr",
        robots: "noindex, nofollow",
      });
    }
    for (const status of [301, 404, 410, 500, 503])
      expect(resolveMetadata({ ...input, status }).applicable).toBe(false);
  });
  it("catches independently malformed HTML, duplicated emitters and wrong content", () => {
    const html = document(input);
    const corruptions = [
      html.replace("</head>", "<title>Parent</title></head>"),
      html.replace("</head>", '<meta property="og:title" content="Parent"></head>'),
      html.replace('rel="canonical"', 'rel="canonical" href="https://evil.example/"'),
      html.replace(
        'property="og:url" content="https://example.com/about/"',
        'property="og:url" content="https://example.com/other/"',
      ),
      html.replace('property="og:title"', 'name="og:title"'),
      html.replace('og:locale" content="pt_PT"', 'og:locale" content="en_US"'),
      html.replace('content="Sea &amp; sky &quot;azul&quot;"', 'content="Sea " onload="evil()"'),
      html.replace('<meta property="og:image:alt"', '</head><body><meta property="og:image:alt"'),
      html.replace('property="og:image:width"', 'property="og:image:height"'),
      html.replace("og: https://ogp.me/ns#", ""),
    ];
    for (const broken of corruptions)
      expect(inspectMetadataHtml(broken, expected).length).toBeGreaterThan(0);
    const independentInvalid =
      '<!doctype html><html lang="pt-PT" dir="ltr"><head><title>Wrong</title><meta name="og:title" content="Wrong"></head><body><meta property="og:image" content="https://example.com/x.png"></body></html>';
    expect(() => assertMetadataHtml(independentInvalid, expected)).toThrow();
  });
  it("maps existing published excerpts without body discovery, guessed image facts or timezone", () => {
    const mapped = mapPublishedContentMetadata(
      {
        title: "Sobre &amp; nós",
        excerpt: "<p>Public <strong>summary</strong></p><script>secret()</script>",
        date: "2026-10-20T12:00:00",
        featuredImage: { sourceUrl: image.url, altText: image.alt },
      },
      {
        site: input.site,
        route: "/about/",
        kind: "article",
        alternates: [
          {
            language: { lang: "en-GB", locale: "en_GB", dir: "ltr" },
            route: "/en/",
            translation: false,
          },
        ],
      },
    );
    expect(mapped.page).toEqual({ title: "Sobre & nós", description: "Public summary" });
    expect(mapped.article).toBeUndefined();
    expect(mapped.translations).toEqual([]);
    expect(resolveMetadata(mapped).ready).toBe(true);
    expect(contentMetadataText("<p>A &quot;quote&quot; &#x1F30A;</p>")).toBe('A "quote" 🌊');
  });
});
