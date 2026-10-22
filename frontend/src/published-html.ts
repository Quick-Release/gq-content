import type { SiteLanguage } from "./site-language";
import type { HomeDelivery, EntryDelivery } from "./page-types";
import type { SiteChrome } from "./content-types";
import type { DesignBlock, DesignPattern } from "./design-patterns";

/**
 * How a published page's or entry's HTML is changed on its way to the
 * Frontend, given the language it is served in. Applied at delivery, never to
 * what the publication store holds: changing the transform (a Site enabling a
 * consent service, say) needs no republication, and stored rows, their
 * ordering and withdrawals are untouched by it. The chrome's header and footer
 * patterns pass through it too: each block's saved HTML is transformed, so an
 * embed a pattern holds is treated as one in the page's body. What a Site's
 * block renderer makes from attributes, and a Site's extension, are served as
 * read: the Site renders them, and transforms their HTML itself.
 */
export type PublishedHtmlTransform = (html: string, language: SiteLanguage) => string;

/** The one step every published body passes through: the identity unless configured. */
export function publishedHtml<X = unknown>(
  languages: SiteLanguage[],
  transform?: PublishedHtmlTransform,
) {
  const defaultLanguage = languages[0]!;
  const languageOf = (slug: string | undefined, fallback: SiteLanguage) =>
    languages.find((language) => language.slug === slug) ?? fallback;

  const blocks = (list: DesignBlock[], language: SiteLanguage): DesignBlock[] =>
    list.map((block) => ({
      ...block,
      content: block.content === null ? null : transform!(block.content, language),
      children: blocks(block.children, language),
    }));
  const pattern = (value: DesignPattern | null | undefined, language: SiteLanguage) =>
    value ? { ...value, blocks: blocks(value.blocks, language) } : value;

  /** A language's chrome, its header and footer patterns' HTML transformed. */
  function chrome<C extends SiteChrome | null>(
    value: C,
    language: SiteLanguage = defaultLanguage,
  ): C {
    if (!transform || !value || (!value.header && !value.footer)) return value;
    return {
      ...value,
      header: pattern(value.header, language) ?? null,
      footer: pattern(value.footer, language) ?? null,
    };
  }

  function home(
    delivery: HomeDelivery<X>,
    language: SiteLanguage = defaultLanguage,
  ): HomeDelivery<X> {
    const served = languageOf(language.slug, defaultLanguage);
    if (transform && delivery.kind === "missing")
      return { ...delivery, chrome: chrome(delivery.chrome, served) };
    if (!transform || delivery.kind !== "found") return delivery;
    const { home } = delivery.content;
    return {
      ...delivery,
      content: {
        ...delivery.content,
        home: { ...home, page: { ...home.page, content: transform(home.page.content, served) } },
        chrome: chrome(delivery.content.chrome, served),
      },
    };
  }

  function entry(delivery: EntryDelivery<X>, routeLanguage: SiteLanguage): EntryDelivery<X> {
    if (transform && delivery.kind === "missing")
      return { ...delivery, chrome: chrome(delivery.chrome, routeLanguage) };
    if (!transform || delivery.kind !== "found") return delivery;
    const { entry } = delivery.content;
    const served = languageOf(entry.language, routeLanguage);
    return {
      ...delivery,
      content: {
        ...delivery.content,
        entry: { ...entry, content: transform(entry.content, served) },
        chrome: chrome(delivery.content.chrome, served),
      },
    };
  }

  return { home, entry, chrome };
}
