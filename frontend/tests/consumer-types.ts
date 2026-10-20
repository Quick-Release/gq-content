import {
  parseWordPressBlocks,
  renderWordPressBlocks,
  hasVideoHero,
  blockPresetStyles,
  containerLayoutHtml,
  containerChildLayoutHtml,
  htmlLang,
  siteLanguages,
  languageSubject,
  routeOf,
  responseStatus,
  formatDate,
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
  DESIGN_ROUTE_KEYS,
  designRouteKey,
  isDesignRouteKey,
  chromeForRoute,
  parseDesignBlocks,
  renderSiteHeader,
  renderSiteFooter,
  designMenuItems,
  type DesignRouteKey,
  type DesignRouteContent,
  type DesignPattern,
  type DesignPatterns,
  type BlockRenderer,
  type BlockRenderContext,
  type BlockRenderOptions,
  type WordPressMenuItem,
} from "@getquick/content";
import { createContentRuntime, type ContentConfig as ServerConfig } from "@getquick/content/server";
const bindings: ContentBindings = {};
const config: ContentConfig = {
  site: "Consumer / 1",
  graphqlEndpoint: "https://cms.test/graphql",
  cmsOrigin: "https://cms.test",
  isServer: () => true,
  bindings: async () => bindings,
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
containerChildLayoutHtml("<div></div>", "<div></div>");
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
const archiveChrome: Promise<SiteChrome | null> = runtime.pageChrome(
  "https://site.test",
  "archive",
);
void [publishedHome, publishedEntry, pageChrome, archiveChrome];

// GQ Design's Header & Footer: a page's route, its patterns and their rendering.
const routeContent: DesignRouteContent = { kind: "entry", postType: "post" };
const route: DesignRouteKey = designRouteKey(routeContent);
const routes: readonly DesignRouteKey[] = DESIGN_ROUTE_KEYS;
const pattern: DesignPattern = { title: "Header", blocks: parseDesignBlocks("[]")?.blocks ?? [] };
const patterns: DesignPatterns = { [route]: { header: pattern } };
const designed: SiteChrome = chromeForRoute(
  { menuItems: [], siteIcon: null, siteLogo: null, designPatterns: patterns },
  route,
);
const navigation: BlockRenderer = (block, context: BlockRenderContext) =>
  `<nav>${designMenuItems(block.attributes?.menuItems).length}${context.children}</nav>`;
const renderOptions: BlockRenderOptions = {
  renderers: { "getquick/header-navigation": navigation },
};
const header: string | null = renderSiteHeader(designed, renderOptions);
const footer: string | null = renderSiteFooter(null);
const menu: WordPressMenuItem[] = designMenuItems([]);
const content: string = renderWordPressBlocks(blocks, renderOptions);
void [routes, header, footer, menu, content, isDesignRouteKey("page")];

const eventResponse: Promise<Response> = runtime.handleEvent(
  new Request("https://site.test/gq/events"),
  { siteOrigin: "https://site.test" },
);
const refreshResponse: Promise<Response> = runtime.handleRefresh(
  new Request("https://site.test/gq/refresh"),
);
void [eventResponse, refreshResponse];
