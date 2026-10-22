import { configuredEvents } from "./events";
import { configuredRefresh } from "./refresh";
import {
  siteLanguages,
  routeLanguage,
  isLanguageHome,
  type WordPressLanguages,
} from "./site-language";
import type { ContentBindings } from "./bindings";
import { configuredDelivery } from "./delivery";
import { configuredWordPress, internalOrigins } from "./wordpress";
import type { SiteChrome } from "./content-types";
import { consentConfiguration, type ConsentConfiguration } from "./consent/configuration";
import { rewriteEmbeds } from "./consent/embeds";
export type { ContentBindings } from "./bindings";
export type { WordPressClient } from "./wordpress";
export interface ContentConfig<X = never> {
  site: string;
  graphqlEndpoint: string;
  cmsOrigin: string;
  wordpress?: WordPressLanguages;
  /** Live delivery without a publication store is opt-in; false by default. */
  development?: boolean;
  isServer: () => boolean;
  bindings: () => ContentBindings | Promise<ContentBindings>;
  fetch?: typeof globalThis.fetch;
  /**
   * CONSENT-1 for this Site. Present, every published body's third-party
   * embeds are rewritten into consent placeholders (unknown hosts blocked) on
   * delivery; absent, bodies are delivered as published.
   */
  consent?: ContentConsentConfig;
  /**
   * The Site's own content on its pages and posts: GraphQL fields the runtime
   * reads with each of them, and the value the Site makes of them, stored with
   * the publication and served as its `extension`.
   */
  extension?: ContentExtension<X>;
  /**
   * The content types the runtime stores besides pages and posts, by the
   * Site's name for each (`biblioteca`). Their items are stored, refreshed,
   * withdrawn and reconciled as pages and posts are, served by
   * `publishedEntry`, and listed from the store by `list`.
   */
  collections?: Record<string, CollectionConfig>;
}

/** A content type (a WordPress custom post type) whose items the runtime stores. */
export interface CollectionConfig {
  /** WordPress's name for the post type (register_post_type's), e.g. `biblioteca`. */
  postType: string;
  /** Its WPGraphQL type (its `graphql_single_name`), e.g. `Biblioteca`. */
  graphqlType: string;
  /**
   * The taxonomies (WordPress's names) whose terms are stored with each item,
   * for filtering and showing them. Each must be shown in WPGraphQL.
   */
  taxonomies?: readonly string[];
}

/**
 * A Site's own content on its pages and posts, beyond what the runtime reads:
 * fields a plugin adds to WPGraphQL (a block tree, a page setting), read with
 * every front page, page and post, stored with it, and served with it through
 * outages, as the rest of it is.
 */
export interface ContentExtension<X> {
  /**
   * GraphQL selections added to each kind of node the runtime reads: `page`
   * to front pages and pages, `post` to posts (e.g. `wpBlocksJson`). They are
   * read with the blocks: a read WordPress can only complete without its
   * blocks leaves them out too, and isn't stored. A kind without fields has
   * no extension. `collections`: each collection's items' fields, by its name.
   */
  fields: { page?: string; post?: string; collections?: Partial<Record<string, string>> };
  /**
   * The Site's value for a node WordPress returned (its fields, the runtime's
   * among them), or undefined when it has none (`extension` is then left
   * out). It is stored as JSON, so it must survive JSON. Throwing fails the
   * read as WordPress answering with the wrong schema: what is stored stays
   * served.
   */
  read(node: ExtensionNode): X | undefined;
  /**
   * The value read back from the store, or from a read about to be stored
   * (JSON), or undefined when the Site can't serve it. A stored row whose
   * extension doesn't parse is unusable, as any body that doesn't; one stored
   * without an extension (before the Site declared it) still serves, without.
   * Return a valid value as it is: reconciliation compares it with new reads.
   */
  parse(stored: unknown): X | undefined;
}

/** A front page, page, post or collection item as WordPress returned it, for a Site's extension. */
export interface ExtensionNode {
  kind: "page" | "post" | "item";
  /** The collection's name, for an item. */
  collection?: string;
  fields: Readonly<Record<string, unknown>>;
}

export interface ContentConsentConfig {
  /** The catalog services the Site declares in code (e.g. "youtube", "google_maps"). */
  services?: readonly string[];
  /**
   * Hosts that are the Site itself besides relative URLs: its Frontend and its
   * CMS/media origin. The CMS origin is included by default.
   */
  firstPartyHosts?: readonly string[];
  /**
   * Read gq-config's Legal Contract and GA4 settings into each language's
   * chrome (requires gq-config with the `getquickLegal` field). Their changes
   * arrive as `legal` and `analytics` settings events.
   */
  cmsSettings?: boolean;
}
export function createContentRuntime<X = never>(input: ContentConfig<X>) {
  const site = input.site.trim();
  if (!site) throw new Error("A nonempty Site identity is required");
  const { collections: collectionFields, ...kindFields } = input.extension?.fields ?? {};
  for (const [kind, fields] of Object.entries(kindFields)) {
    if (fields !== undefined && !fields.trim())
      throw new Error(`The extension's ${kind} fields are empty; leave them out instead`);
  }
  validateCollections(input.collections ?? {}, collectionFields ?? {});
  const config = { ...input, site, development: input.development ?? false };
  const languages = siteLanguages(config.wordpress);
  const wordpress = configuredWordPress(config, languages);
  const consent = config.consent;
  // Embeds depend only on the declared services; GA4 never appears in HTML.
  const embedConfiguration = consent ? consentConfiguration({ services: consent.services }) : null;
  const firstPartyHosts = consent
    ? [
        new URL(config.cmsOrigin).hostname,
        new URL(config.graphqlEndpoint).hostname,
        ...(consent.firstPartyHosts ?? []),
      ]
    : [];
  const delivery = configuredDelivery(
    config,
    languages,
    wordpress,
    embedConfiguration
      ? (html, language) =>
          rewriteEmbeds(html, {
            configuration: embedConfiguration,
            language: language.lang,
            firstPartyHosts,
          }).html
      : undefined,
  );
  const events = configuredEvents(config, languages, delivery, wordpress);
  const refresh = configuredRefresh(languages, delivery);
  const answer = (status: number, error: string, headers: Record<string, string> = {}) =>
    Response.json({ error }, { status, headers: { "Cache-Control": "no-store", ...headers } });
  const guarded =
    (
      kind: "Events" | "Refresh",
      message: string,
      run: (request: Request, context: { siteOrigin?: string }) => Promise<Response>,
    ) =>
    async (request: Request, context: { siteOrigin?: string } = {}): Promise<Response> => {
      if (request.method !== "POST") return answer(405, message, { Allow: "POST" });
      if (!config.isServer())
        return answer(403, `${kind} are disabled: Content delivery requires a server context.`);
      try {
        return await run(request, context);
      } catch {
        return answer(503, "The publication store is unavailable; try again later.");
      }
    };
  return {
    languages,
    defaultLanguage: languages[0]!,
    multilingual: languages.length > 1,
    routeLanguage: (route: string) => routeLanguage(route, languages),
    isLanguageHome: (route: string) => isLanguageHome(route, languages),
    wordpress,
    handleEvent: guarded("Events", "Deliver events with POST.", async (request, context) => {
      const { status, body } = await events.receiveEvent(request, context);
      return Response.json(body, { status, headers: { "Cache-Control": "no-store" } });
    }),
    handleRefresh: guarded("Refresh", "Refresh with POST.", refresh.handleRefresh),
    publishedHome: delivery.publishedHome,
    publishedEntry: delivery.publishedEntry,
    /**
     * A page of a collection's items, from the publication store alone (never
     * WordPress), newest first: those with the given terms and text, in the
     * language. Unavailable when the store can't be read, or there is none.
     */
    list: delivery.list,
    /**
     * The terms of a collection's taxonomy that its stored items have, with how
     * many of them have each, by name: for filters.
     */
    terms: delivery.terms,
    /**
     * Where a collection's archive is: the Page assigned to it in GETQUICK →
     * Archives, else its post type's own archive. Null when it has neither, or
     * the store can't be read.
     */
    archiveUri: delivery.archiveUri,
    pageChrome: delivery.pageChrome,
    /**
     * The design presets every page shares (GQ Design's spacing sizes and
     * colors), for a page that isn't a publication: the stored ones when there
     * is a store, else (in explicit development) a live read. Null when
     * neither has them.
     */
    designPresets: delivery.designPresets,
    /**
     * The origins a link into this Site may use: WordPress's, and the
     * Frontend's when given. `menuItemHref` turns links at them into paths.
     */
    internalOrigins: (siteOrigin?: string) => internalOrigins(config, siteOrigin),
    /**
     * The Site's consent configuration for a page served with this chrome:
     * declared services, GA4 when gq-config's toggle is on, and the
     * controller from the Legal Contract. Null when consent isn't configured.
     */
    consentConfiguration: (chrome?: SiteChrome | null): ConsentConfiguration | null =>
      consent
        ? consentConfiguration({
            services: consent.services,
            analytics: chrome?.analytics ?? null,
            controller: chrome?.legal?.controller.name ?? null,
          })
        : null,
  };
}
export type ContentRuntime<X = never> = ReturnType<typeof createContentRuntime<X>>;

/** A collection's names are paths in the store's JSON, and the post type and taxonomies GraphQL names. */
function validateCollections(
  collections: Record<string, CollectionConfig>,
  fields: Partial<Record<string, string>>,
) {
  const name = /^[a-z0-9][a-z0-9_-]*$/;
  const postTypes = new Set<string>();
  for (const [collection, { postType, graphqlType, taxonomies = [] }] of Object.entries(
    collections,
  )) {
    if (!name.test(collection))
      throw new Error(
        `The collection ${JSON.stringify(collection)} needs a name such as biblioteca`,
      );
    if (!/^[a-z0-9_-]{1,20}$/.test(postType))
      throw new Error(`The collection ${collection}'s postType isn't a WordPress post type name`);
    if (["page", "post", "attachment"].includes(postType))
      throw new Error(`The collection ${collection} can't be WordPress's ${postType}s`);
    if (postTypes.has(postType))
      throw new Error(`The collection ${collection}'s post type is another collection's`);
    postTypes.add(postType);
    if (!/^[A-Za-z_][A-Za-z0-9_]*$/.test(graphqlType))
      throw new Error(`The collection ${collection}'s graphqlType isn't a GraphQL type name`);
    for (const taxonomy of taxonomies) {
      if (!/^[a-z0-9_-]{1,32}$/.test(taxonomy))
        throw new Error(
          `The collection ${collection}'s taxonomy ${taxonomy} isn't a taxonomy name`,
        );
    }
  }
  for (const [collection, value] of Object.entries(fields)) {
    if (!Object.hasOwn(collections, collection))
      throw new Error(`The extension has fields for ${collection}, which isn't a collection`);
    if (value !== undefined && !value.trim())
      throw new Error(`The extension's ${collection} fields are empty; leave them out instead`);
  }
}
