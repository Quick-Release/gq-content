/** Scoped OG-1 candidate contract; adoption and public asset verification are separate gates. */
export const metadataBaseline = "OG-1" as const;
export interface MetadataImage {
  url: string;
  alt: string;
  width: number;
  height: number;
  /** Verified asset MIME, never inferred from the URL extension. */
  type?: "image/jpeg" | "image/png";
}
export interface MetadataLocale {
  /** BCP 47 HTML language. */
  lang: string;
  /** WordPress regional locale or an explicitly configured OG regional locale. */
  locale: string;
  dir: "ltr" | "rtl";
}
export interface MetadataFacts {
  title?: string;
  description?: string;
  images?: readonly MetadataImage[];
}
export interface MetadataSite extends MetadataFacts {
  /** Reviewed configuration, never an incoming Host header. One HTTPS origin, no path. */
  origin: string;
  name: string;
  language: MetadataLocale;
  /** Only these query keys may participate in canonical identity. */
  identityQueryKeys?: readonly string[];
}
export interface MetadataTranslation extends MetadataLocale {
  canonical: string;
  published: boolean;
}
export interface MetadataArticle {
  publishedTime?: string;
  modifiedTime?: string;
  /** Verified public author profile URLs, not names or private account URLs. */
  authors?: readonly string[];
}
export interface MetadataInput {
  site: MetadataSite;
  state: "public" | "private" | "preview" | "withdrawn" | "error" | "redirect";
  /** A successful graph applies only to status 200. */
  status: number;
  /** Explicit safe public status copy for excluded routes; never selected from page/site facts. */
  statusTitle?: string;
  canonical?: string;
  kind?: "website" | "article" | "product" | "listing";
  language?: MetadataLocale;
  page?: MetadataFacts;
  overrides?: MetadataFacts & { shareTitle?: string };
  translations?: readonly MetadataTranslation[];
  article?: MetadataArticle;
  /** A public page may intentionally opt out of indexing. This is not access control. */
  noindex?: boolean;
}
export type HeadDescriptor =
  | { tag: "title"; text: string }
  | { tag: "meta" | "link"; attrs: Record<string, string> };
export interface MetadataDiagnostic {
  code: string;
  field: string;
  message: string;
}
export interface ResolvedMetadata {
  baseline: typeof metadataBaseline;
  /** Overall applicable metadata readiness; an OG gap does not remove valid document basics. */
  ready: boolean;
  documentReady: boolean;
  graphReady: boolean;
  applicable: boolean;
  htmlAttributes: { lang: string; dir: "ltr" | "rtl"; prefix?: string };
  head: HeadDescriptor[];
  diagnostics: MetadataDiagnostic[];
}
/** Inputs are plain text. Source-specific HTML/entity decoding belongs in the mapper. */
export function normalizeMetadataText(value: string): string {
  return value.replace(/\s+/gu, " ").trim();
}
export function resolveMetadata(input: MetadataInput): ResolvedMetadata {
  const diagnostics: MetadataDiagnostic[] = [];
  const fail = (field: string, message: string) =>
    diagnostics.push({ code: "invalid-metadata", field, message });
  const language = input.language ?? input.site.language;
  const text = (value: string | undefined, field: string) => {
    const result = normalizeMetadataText(value ?? "");
    if (!result) fail(field, "Expected nonempty decoded plain text");
    return result;
  };
  const locale = (value: MetadataLocale, field: string) => {
    let htmlLocale: Intl.Locale | undefined;
    try {
      htmlLocale = new Intl.Locale(value.lang);
    } catch {
      fail(field, "Invalid BCP 47 HTML language");
    }
    if (!["ltr", "rtl"].includes(value.dir)) fail(field, "Invalid HTML direction");
    const match = /^([a-z]{2,3})[_-]([a-z]{2})(?:_[a-z0-9]+)*$/iu.exec(value.locale);
    if (!match) {
      fail(field, "Explicit regional locale required; no territory is inferred");
      return "";
    }
    if (
      htmlLocale &&
      (htmlLocale.language.toLowerCase() !== match[1]!.toLowerCase() ||
        (htmlLocale.region && htmlLocale.region.toUpperCase() !== match[2]!.toUpperCase()))
    )
      fail(field, "HTML and OG locales disagree");
    return `${match[1]!.toLowerCase()}_${match[2]!.toUpperCase()}`;
  };
  const ogLocale = locale(language, "language");
  const head: HeadDescriptor[] = [];
  const meta = (name: string, content: string, property = true) =>
    head.push({ tag: "meta", attrs: { [property ? "property" : "name"]: name, content } });
  const applicable = input.state === "public" && input.status === 200;
  meta("robots", applicable && !input.noindex ? "index, follow" : "noindex, nofollow", false);
  const result: ResolvedMetadata = {
    baseline: metadataBaseline,
    ready: false,
    documentReady: false,
    graphReady: false,
    applicable,
    htmlAttributes: { lang: language.lang, dir: language.dir },
    head,
    diagnostics,
  };
  // Never inspect private facts, inherit defaults, or emit a success identity on excluded routes.
  if (!applicable) {
    if (input.statusTitle !== undefined) {
      const title = text(input.statusTitle, "statusTitle");
      if (!diagnostics.some((d) => d.field === "statusTitle"))
        head.push({ tag: "title", text: title });
    }
    result.ready = diagnostics.length === 0;
    result.documentReady = result.ready && head.some((node) => node.tag === "title");
    return result;
  }
  let origin = "";
  try {
    const parsed = new URL(input.site.origin);
    if (
      parsed.href !== `${parsed.origin}/` ||
      parsed.protocol !== "https:" ||
      parsed.username ||
      parsed.password ||
      /^(localhost|.*\.localhost|.*\.local|.*\.invalid|127\..*|0\.0\.0\.0|\[::1\])$/iu.test(
        parsed.hostname,
      )
    )
      throw new Error();
    origin = parsed.origin;
  } catch {
    fail("site.origin", "Expected reviewed public HTTPS origin");
  }
  const url = (value: string | undefined, field: string, identity: boolean) => {
    try {
      const parsed = new URL(value ?? "");
      if (
        parsed.protocol !== "https:" ||
        parsed.username ||
        parsed.password ||
        parsed.hash ||
        /^(localhost|.*\.localhost|.*\.local|.*\.invalid|127\..*|0\.0\.0\.0|\[::1\])$/iu.test(
          parsed.hostname,
        )
      )
        throw new Error();
      if (identity && parsed.origin !== origin) throw new Error();
      for (const key of parsed.searchParams.keys()) {
        if (
          /^(utm_|fbclid$|gclid$|token$|sig$|signature$|expires$|x-amz-|x-goog-|awsaccesskeyid$|preview)/iu.test(
            key,
          ) ||
          (identity && !input.site.identityQueryKeys?.includes(key))
        )
          throw new Error();
      }
      return parsed.href;
    } catch {
      fail(field, "Invalid public HTTPS URL or unreviewed canonical identity/query");
      return "";
    }
  };
  const selected = <K extends keyof MetadataFacts>(key: K) =>
    input.overrides?.[key] ?? input.page?.[key] ?? input.site[key];
  const title = text(selected("title"), "title");
  const shareTitle = text(input.overrides?.shareTitle ?? title, "shareTitle");
  const description = text(selected("description"), "description");
  const name = text(input.site.name, "site.name");
  const canonical = url(input.canonical, "canonical", true);
  head.push(
    { tag: "title", text: title },
    { tag: "link", attrs: { rel: "canonical", href: canonical } },
  );
  meta("description", description, false);
  for (const [key, value] of Object.entries({
    title: shareTitle,
    type: input.kind === "article" ? "article" : "website",
    url: canonical,
    description,
    site_name: name,
    locale: ogLocale,
  }))
    meta(`og:${key}`, value);
  const images = selected("images");
  if (!images?.length) fail("images", "At least one reviewed share image required");
  images?.forEach((image, index) => {
    const field = `images.${index}`;
    const src = url(image.url, `${field}.url`, false);
    const alt = text(image.alt, `${field}.alt`);
    if (![image.width, image.height].every((n) => Number.isSafeInteger(n) && n > 0))
      fail(field, "Known positive integer dimensions required");
    if (image.type && !["image/jpeg", "image/png"].includes(image.type))
      fail(field, "OG-1 supports verified JPEG/PNG MIME only");
    meta("og:image", src);
    meta("og:image:alt", alt);
    meta("og:image:width", String(image.width));
    meta("og:image:height", String(image.height));
    if (image.type) meta("og:image:type", image.type);
  });
  const locales = new Set([ogLocale]);
  const langs = new Set([language.lang.toLowerCase()]);
  if (input.translations?.some((t) => t.published))
    head.push({
      tag: "link",
      attrs: { rel: "alternate", hreflang: language.lang, href: canonical },
    });
  input.translations
    ?.filter((t) => t.published)
    .forEach((translation, index) => {
      const field = `translations.${index}`;
      const translatedLocale = locale(translation, field);
      const href = url(translation.canonical, field, true);
      if (langs.has(translation.lang.toLowerCase())) {
        fail(field, "Duplicate/current translation language");
        return;
      }
      langs.add(translation.lang.toLowerCase());
      head.push({ tag: "link", attrs: { rel: "alternate", hreflang: translation.lang, href } });
      if (!locales.has(translatedLocale)) {
        meta("og:locale:alternate", translatedLocale);
        locales.add(translatedLocale);
      }
    });
  if (input.kind === "article" && input.article) {
    for (const [key, value] of [
      ["published_time", input.article.publishedTime],
      ["modified_time", input.article.modifiedTime],
    ] as const) {
      if (value === undefined) continue;
      if (
        !/^\d{4}-\d\d-\d\dT\d\d:\d\d(?::\d\d(?:\.\d+)?)?(?:Z|[+-]\d\d:\d\d)$/u.test(value) ||
        !Number.isFinite(Date.parse(value)) ||
        Number(value.slice(8, 10)) >
          new Date(Date.UTC(Number(value.slice(0, 4)), Number(value.slice(5, 7)), 0)).getUTCDate()
      )
        fail(`article.${key}`, "Timestamp must include a timezone");
      else meta(`article:${key}`, value);
    }
    input.article.authors?.forEach((author) =>
      meta("article:author", url(author, "article.authors", false)),
    );
  }
  result.ready = diagnostics.length === 0;
  result.graphReady = result.ready;
  result.documentReady = !diagnostics.some(
    (d) =>
      ["title", "description", "canonical", "site.origin"].includes(d.field) ||
      (d.field === "language" && /HTML|BCP/u.test(d.message)),
  );
  // Suppress the incomplete graph, preserving independently valid document basics and indexing policy.
  if (!result.ready) {
    const invalid = (field: string) => diagnostics.some((d) => d.field === field);
    result.head = head.filter((node) => {
      if (node.tag === "title") return !invalid("title");
      if (node.tag === "meta")
        return (
          node.attrs.name === "robots" ||
          (node.attrs.name === "description" && !invalid("description"))
        );
      if (node.attrs.rel === "canonical") return !invalid("canonical");
      return (
        node.attrs.rel === "alternate" &&
        !invalid("canonical") &&
        !diagnostics.some((d) => d.field.startsWith("translations."))
      );
    });
  } else result.htmlAttributes.prefix = "og: https://ogp.me/ns#";
  return result;
}
const escape = (value: string) =>
  value
    .replaceAll("&", "&amp;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;");
/** Safe HTML fragment for Astro set:html or other server serialization; preserves repeated image groups. */
export function renderMetadataHead(metadata: ResolvedMetadata): string {
  return metadata.head
    .map((node) =>
      node.tag === "title"
        ? `<title>${escape(node.text)}</title>`
        : `<${node.tag} ${Object.entries(node.attrs)
            .map(([key, value]) => `${key}="${escape(value)}"`)
            .join(" ")}>`,
    )
    .join("\n");
}
