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
}
export function createContentRuntime(input: ContentConfig) {
  const site = input.site.trim();
  if (!site) throw new Error("A nonempty Site identity is required");
  const config = { ...input, site, development: input.development ?? false };
  const languages = siteLanguages(config.wordpress);
  const wordpress = configuredWordPress(config, languages);
  const delivery = configuredDelivery(config, languages, wordpress);
  const events = configuredEvents(config, languages, delivery);
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
  };
}
export type ContentRuntime = ReturnType<typeof createContentRuntime>;
