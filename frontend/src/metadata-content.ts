import { parseFragment, type DefaultTreeAdapterMap } from "parse5";
import type { MetadataInput, MetadataSite, MetadataLocale, MetadataImage } from "./metadata";
import { normalizeMetadataText } from "./metadata";

/** Minimal structural slice of existing HomePublication/EntryPublication; no CMS reads. */
export interface PublishedContentMetadata {
  title: string;
  excerpt?: string;
  date?: string;
  featuredImage?: { sourceUrl: string; altText: string } | null;
}
export interface ContentMetadataOptions {
  site: MetadataSite;
  route: string;
  language?: MetadataLocale;
  kind?: "website" | "article";
  /** Existing Alternate records: language-home fallbacks are deliberately excluded. */
  alternates?: readonly { language: MetadataLocale; route: string; translation: boolean }[];
  /** Verified dimensions/MIME unavailable in the existing CMS image contract; supplied by asset evidence. */
  featuredImageFacts?: { width: number; height: number; type?: MetadataImage["type"] };
}
/** Decodes entities and extracts authored text without executing HTML or reading body markup. */
export function contentMetadataText(html: string): string {
  const walk = (node: DefaultTreeAdapterMap["node"]): string => {
    if ("tagName" in node && ["script", "style", "template"].includes(node.tagName)) return "";
    if ("value" in node) return node.value;
    if (!("childNodes" in node)) return "";
    const text = node.childNodes.map(walk).join("");
    return "tagName" in node &&
      /^(?:p|div|br|li|h[1-6]|blockquote|section|article)$/u.test(node.tagName)
      ? ` ${text} `
      : text;
  };
  return normalizeMetadataText(walk(parseFragment(html)));
}
/** Call only for the same published snapshot being served, including a retained snapshot. */
export function mapPublishedContentMetadata(
  content: PublishedContentMetadata,
  options: ContentMetadataOptions,
): MetadataInput {
  const absolute = (route: string) => new URL(route, options.site.origin).href;
  const title = contentMetadataText(content.title);
  const description =
    content.excerpt === undefined ? undefined : contentMetadataText(content.excerpt);
  const image = content.featuredImage;
  const facts = options.featuredImageFacts;
  return {
    site: options.site,
    state: "public",
    status: 200,
    canonical: absolute(options.route),
    language: options.language,
    kind: options.kind,
    page: {
      ...(title ? { title } : {}),
      ...(description ? { description } : {}),
      ...(image && facts
        ? { images: [{ url: image.sourceUrl, alt: contentMetadataText(image.altText), ...facts }] }
        : {}),
    },
    translations: options.alternates
      ?.filter((a) => a.translation)
      .map((a) => ({ ...a.language, canonical: absolute(a.route), published: true })),
    // WordPress's existing unzoned `date` cannot establish a timezone; never guess one.
    ...(options.kind === "article" && content.date && /(?:Z|[+-]\d\d:\d\d)$/u.test(content.date)
      ? { article: { publishedTime: content.date } }
      : {}),
  };
}
