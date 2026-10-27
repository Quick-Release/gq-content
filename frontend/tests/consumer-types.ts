import {
  parseWordPressBlocks,
  renderWordPressBlocks,
  hasVideoHero,
  blockPresetStyles,
  presetRootStyle,
  menuItemHref,
  containerLayoutHtml,
  htmlLang,
  siteLanguages,
  languageSubject,
  routeOf,
  responseStatus,
  formatDate,
  renderDesignPattern,
  parseDesignBlocks,
  designMenuItems,
  escapeHtml,
  type DesignBlock,
  type DesignPattern,
  type DesignBlockRenderer,
  type DesignRenderContext,
  type DesignRenderOptions,
  type WordPressBlock,
  type ContentConfig,
  type ContentRuntime,
  type ContentBindings,
  type WordPressClient,
  type SiteLanguage,
  type SiteChrome,
  type Alternate,
  type Delivery,
  type HomeDelivery,
  type EntryDelivery,
  type SqlDatabase,
  type SqlStatement,
  type HomeContent,
  type EntryContent,
  type DesignPresets,
  type Found,
  type Missing,
  type Unavailable,
  type BlockPresetStyles,
  type ColorPreset,
  type SpacingPreset,
  type ContainerAttributes,
  type ContentExtension,
  type ExtensionNode,
  type SearchQuery,
  type SearchDelivery,
  type SearchPage,
  type SearchItem,
} from "@getquick/content";
import { createContentRuntime, type ContentConfig as ServerConfig } from "@getquick/content/server";
const bindings: ContentBindings = {};
const config: ContentConfig = {
  site: "Consumer / 1",
  graphqlEndpoint: "https://cms.test/graphql",
  cmsOrigin: "https://cms.test",
  isServer: () => true,
  bindings: async () => bindings,
  designTemplate: "page",
};
const serverConfig: ServerConfig = config;
const runtime: ContentRuntime = createContentRuntime(serverConfig);
const client: WordPressClient = runtime.wordpress;
const language: SiteLanguage = runtime.defaultLanguage;
const home: Promise<Delivery<HomeContent>> = client.getHomeContent(language);
const entry: Promise<Delivery<EntryContent>> = client.getEntryByUri("/about/");
const chrome: Promise<Found<SiteChrome> | Unavailable> = client.getSiteChrome("https://site.test", {
  location: "PRIMARY",
  language,
});
const presets: Promise<Found<DesignPresets> | Unavailable> = client.getDesignPresets();
const blocks: WordPressBlock[] = parseWordPressBlocks("[]");
const alternate: Alternate = { language, route: "/", translation: false };
const missing: Missing = { kind: "missing" };
const homeDelivery: HomeDelivery = { ...missing, chrome: null };
const entryDelivery: EntryDelivery = { kind: "moved", uri: "/new/" };
// Structural bindings need no Cloudflare or Node type dependency.
function databaseTypes(db: SqlDatabase, statement: SqlStatement) {
  return db.batch([statement.bind("value")]);
}
void [home, entry, chrome, presets, alternate, homeDelivery, entryDelivery, databaseTypes];
renderWordPressBlocks(blocks);
hasVideoHero(blocks);
const spacing: SpacingPreset[] = [];
const colors: ColorPreset[] = [];
const styles: BlockPresetStyles = blockPresetStyles(spacing, colors);
const attributes: ContainerAttributes = {};
void styles;
containerLayoutHtml("<div></div>", attributes);
htmlLang("pt_PT_ao90");
siteLanguages({ languages: [{ locale: "en_US", slug: "en" }] });
languageSubject(language, "front page");
routeOf("about");
responseStatus(missing);
formatDate("2026-01-01");

const publishedHome: Promise<HomeDelivery> = runtime.publishedHome("https://site.test", language);
const publishedEntry: Promise<EntryDelivery> = runtime.publishedEntry(
  "/about/",
  "https://site.test",
);
const pageChrome: Promise<SiteChrome | null> = runtime.pageChrome("https://site.test");
const searchQuery: SearchQuery = {
  search: "bioeconomia",
  page: "2",
  perPage: 12,
  language: language.slug,
};
const searchDelivery: Promise<SearchDelivery> = runtime.search(searchQuery);
const searchItem: SearchItem = {
  uri: "/about/",
  title: "About",
  excerpt: "About us",
  language: language.slug,
};
const searchPage: SearchPage = {
  items: [searchItem],
  total: 1,
  page: 1,
  perPage: 12,
  totalPages: 1,
};
void [searchDelivery, searchPage];
void [publishedHome, publishedEntry, pageChrome];

// The Site block seam: the chrome's header and footer, by the Site's renderers.
const navigation: DesignBlockRenderer = (block: DesignBlock, context: DesignRenderContext) =>
  `<nav>${designMenuItems(block.attributes.menuItems, context.href)
    .map((item) => `<a href="${escapeHtml(item.href)}">${escapeHtml(item.label)}</a>`)
    .join("")}${context.children}</nav>`;
const renderOptions: DesignRenderOptions = { blocks: { "getquick/header-navigation": navigation } };
const header: DesignPattern | null = { title: "Header", blocks: parseDesignBlocks("[]") ?? [] };
const headerHtml: string = renderDesignPattern(header, renderOptions);
const servedHeader: string = runtime.renderDesignPattern(header, {
  ...renderOptions,
  siteOrigin: "https://site.test",
});
void [headerHtml, servedHeader];

const eventResponse: Promise<Response> = runtime.handleEvent(
  new Request("https://site.test/gq/events"),
  { siteOrigin: "https://site.test" },
);
const refreshResponse: Promise<Response> = runtime.handleRefresh(
  new Request("https://site.test/gq/refresh"),
);
void [eventResponse, refreshResponse];

// A Site's own content, typed from its extension through every delivery.
interface SiteDesign {
  blocks: unknown[];
  background: string | null;
}
const extension: ContentExtension<SiteDesign> = {
  fields: { page: "wpBlocksJson siteBackground", post: "wpBlocksJson" },
  read: ({ kind, fields }: ExtensionNode) =>
    typeof fields.wpBlocksJson === "string"
      ? {
          blocks: JSON.parse(fields.wpBlocksJson) as unknown[],
          background:
            kind === "page"
              ? typeof fields.siteBackground === "string"
                ? fields.siteBackground
                : null
              : null,
        }
      : undefined,
  parse: (stored: unknown) =>
    typeof stored === "object" && stored !== null ? (stored as SiteDesign) : undefined,
};
const extended: ContentRuntime<SiteDesign> = createContentRuntime({ ...config, extension });
const extendedConfig: ServerConfig<SiteDesign> = { ...config, extension };
void extendedConfig;
const extendedHome: Promise<HomeDelivery<SiteDesign>> = extended.publishedHome();
const extendedEntry: Promise<EntryDelivery<SiteDesign>> = extended.publishedEntry("/about/");
const extendedRead: Promise<Delivery<EntryContent<SiteDesign>>> =
  extended.wordpress.getEntryByUri("/about/");
async function siteDesign(delivery: EntryDelivery<SiteDesign>): Promise<SiteDesign | undefined> {
  return delivery.kind === "found" ? delivery.content.entry.extension : undefined;
}
async function frontDesign(delivery: HomeDelivery<SiteDesign>): Promise<string | null | undefined> {
  return delivery.kind === "found" ? delivery.content.home.page.extension?.background : undefined;
}
// A Site without an extension still assigns its deliveries to the plain types.
const plainEntry: Promise<EntryDelivery> = extended.publishedEntry("/about/");
const design: Promise<DesignPresets | null> = runtime.designPresets();
const origins: string[] = runtime.internalOrigins("https://site.test");
const scoped: BlockPresetStyles = blockPresetStyles(spacing, colors, ".site-blocks");
const root: string = presetRootStyle(spacing, colors);
void [extendedHome, extendedEntry, extendedRead, siteDesign, frontDesign, plainEntry];
void [design, origins, scoped, root, menuItemHref("https://cms.test/a/", origins)];

import {
  consentPage as neutralConsentPage,
  type ConsentPageInput,
  type ConsentPage,
} from "@getquick/content/consent/html";
import { consentPage as astroConsentPage } from "@getquick/content/consent/astro";
const compatibleConsent: (input: ConsentPageInput) => ConsentPage = astroConsentPage;
void [compatibleConsent, neutralConsentPage];
