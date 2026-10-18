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
  return {
    languages,
    defaultLanguage: languages[0]!,
    multilingual: languages.length > 1,
    routeLanguage: (route: string) => routeLanguage(route, languages),
    isLanguageHome: (route: string) => isLanguageHome(route, languages),
    wordpress,
    ...configuredDelivery(config, languages, wordpress),
  };
}
export type ContentRuntime = ReturnType<typeof createContentRuntime>;
