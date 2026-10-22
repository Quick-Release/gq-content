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
import { configuredWordPress } from "./wordpress";
import type { SiteChrome } from "./content-types";
import { consentConfiguration, type ConsentConfiguration } from "./consent/configuration";
import { rewriteEmbeds } from "./consent/embeds";
export type { ContentBindings } from "./bindings";
export type { WordPressClient } from "./wordpress";
export interface ContentConfig {
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
export function createContentRuntime(input: ContentConfig) {
  const site = input.site.trim();
  if (!site) throw new Error("A nonempty Site identity is required");
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
    pageChrome: delivery.pageChrome,
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
export type ContentRuntime = ReturnType<typeof createContentRuntime>;
