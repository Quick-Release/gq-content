import type { SiteLanguage } from "./site-language";
import type { HomeDelivery, EntryDelivery } from "./page-types";

/**
 * How a published page's or entry's HTML is changed on its way to the
 * Frontend, given the language it is served in. Applied at delivery, never to
 * what the publication store holds: changing the transform (a Site enabling a
 * consent service, say) needs no republication, and stored rows, their
 * ordering and withdrawals are untouched by it. A Site's extension is served
 * as its read made it: the Site renders it, and transforms its HTML itself.
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

  function home(
    delivery: HomeDelivery<X>,
    language: SiteLanguage = defaultLanguage,
  ): HomeDelivery<X> {
    if (!transform || delivery.kind !== "found") return delivery;
    const { home } = delivery.content;
    const served = languageOf(language.slug, defaultLanguage);
    return {
      ...delivery,
      content: {
        ...delivery.content,
        home: { ...home, page: { ...home.page, content: transform(home.page.content, served) } },
      },
    };
  }

  function entry(delivery: EntryDelivery<X>, routeLanguage: SiteLanguage): EntryDelivery<X> {
    if (!transform || delivery.kind !== "found") return delivery;
    const { entry } = delivery.content;
    const served = languageOf(entry.language, routeLanguage);
    return {
      ...delivery,
      content: {
        ...delivery.content,
        entry: { ...entry, content: transform(entry.content, served) },
      },
    };
  }

  return { home, entry };
}
