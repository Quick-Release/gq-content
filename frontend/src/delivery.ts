import { z } from "zod";
import {
  publicationStore,
  StoreFailure,
  type PublicationStore,
  type PublicationEvent,
  type Promotion,
  type StoredPublication,
  type Unusable,
} from "./publications";
import {
  languageSubject,
  routeLanguage as languageAt,
  isLanguageHome as homeAt,
  type SiteLanguage,
} from "./site-language";
import { decodeEntities, routeOf, stripHtml } from "./formatting";
import type { ContentConfig } from "./server";
import type { WordPressClient } from "./wordpress";
import { publishedHtml, type PublishedHtmlTransform } from "./published-html";
import { bearerMatches } from "./bearer";
import type {
  Delivery,
  CmsFailureReason,
  Found,
  HomeContent as HomeContentOf,
  DesignPresets,
  EntryContent as EntryContentOf,
  SiteChrome,
  Translation,
  Archives,
} from "./content-types";
import type {
  HomePublication as HomePublicationOf,
  EntryPublication as EntryPublicationOf,
  Alternate,
  HomeDelivery as HomeDeliveryOf,
  EntryDelivery as EntryDeliveryOf,
  DeliveryFailureReason,
  NotServed,
  CollectionQuery,
  CollectionListing as CollectionListingOf,
  CollectionItem as CollectionItemOf,
  CollectionTermListing,
} from "./page-types";

export function configuredDelivery<X>(
  config: ContentConfig<X>,
  languages: SiteLanguage[],
  wordpress: WordPressClient<X>,
  transformHtml?: PublishedHtmlTransform,
) {
  type HomePublication = HomePublicationOf<X>;
  type EntryPublication = EntryPublicationOf<X>;
  type HomeContent = HomeContentOf<X>;
  type EntryContent = EntryContentOf<X>;
  type HomeDelivery = HomeDeliveryOf<X>;
  type EntryDelivery = EntryDeliveryOf<X>;
  type CollectionListing = CollectionListingOf<X>;
  type CollectionItem = CollectionItemOf<X>;
  const defaultLanguage = languages[0]!;
  const collections = config.collections ?? {};
  const hasCollections = Object.keys(collections).length > 0;
  const html = publishedHtml<X>(languages, transformHtml);
  const multilingual = languages.length > 1;
  const routeLanguage = (route: string) => languageAt(route, languages);
  const isLanguageHome = (route: string) => homeAt(route, languages);
  const {
    getHomeContent,
    getEntryByUri,
    getSiteChrome,
    getDesignPresets,
    getPublishedRoutes,
    getArchives,
  } = wordpress;
  const HOME = "home";
  const CHROME = "chrome";
  /**
   * A language's front page (with the site's title and tagline in it) and its
   * chrome: "home" and "chrome" for the default language, "home:<slug>" and
   * "chrome:<slug>" for the others.
   */
  const homeKey = (language: SiteLanguage) =>
    language.isDefault ? HOME : `${HOME}:${language.slug}`;
  const chromeKey = (language: SiteLanguage) =>
    language.isDefault ? CHROME : `${CHROME}:${language.slug}`;
  /** The design presets every page is served with, once a refresh has stored them. */
  const DESIGN = "design";
  /** Where each collection's archive is, on a Site with collections. */
  const ARCHIVES = "archives";
  /** Entries are stored at "entry:<route>". */
  const ENTRY = "entry:";
  const entryKey = (route: string) => `${ENTRY}${route}`;
  /** The row a route is served from: its language's home, or its entry. */
  const routeKey = (route: string) =>
    isLanguageHome(route) ? homeKey(routeLanguage(route)) : entryKey(route);
  const keyRoute = (key: string) =>
    key.startsWith(ENTRY)
      ? key.slice(ENTRY.length)
      : (languages.find((language) => homeKey(language) === key)?.home ?? key);
  // The stored shapes. A body that doesn't parse is unusable, not served.
  const image = z.object({ sourceUrl: z.string(), altText: z.string() }).nullable();
  interface StoredMenuItem {
    id: string;
    label: string;
    href: string;
    target: string | null;
    children: StoredMenuItem[];
  }
  const menuItem: z.ZodType<StoredMenuItem> = z.lazy(() =>
    z.object({
      id: z.string(),
      label: z.string(),
      href: z.string(),
      target: z.string().nullable(),
      children: z.array(menuItem),
    }),
  );
  const spacingSizes = z.array(z.object({ slug: z.string(), size: z.string() }));
  const colors = z.array(z.object({ slug: z.string(), color: z.string() }));
  /**
   * The Site's extension of a page or post, as its `parse` reads it back. A
   * row stored without one (before the Site declared it) still serves; an
   * extension stored without the Site declaring one now is left out.
   */
  const extension = config.extension;
  const extended: z.ZodRawShape = extension
    ? {
        extension: z
          .unknown()
          .optional()
          .transform((value, context) => {
            if (value === undefined) return undefined;
            let parsed: X | undefined;
            try {
              parsed = extension.parse(value);
            } catch {
              parsed = undefined;
            }
            if (parsed === undefined) {
              context.addIssue({ code: "custom", message: "the Site can't serve this extension" });
              return z.NEVER;
            }
            return parsed;
          }),
      }
    : {};
  const homePublication = z.object({
    settings: z.object({ title: z.string(), description: z.string() }),
    page: z.object({
      title: z.string(),
      content: z.string(),
      hasVideoHero: z.boolean(),
      ...extended,
    }),
    spacingSizes,
    colors,
  });
  const translation = z.object({ uri: z.string(), language: z.string() });
  const term = z.object({ slug: z.string(), name: z.string() });
  /**
   * The collection an item is in, with its terms; stored with the text a
   * search matches (`search`), which isn't served.
   */
  const membership = z
    .object({
      name: z.string(),
      terms: z.record(z.array(term)),
      search: z.string().optional(),
    })
    .transform(({ name, terms }) => ({ name, terms }));
  const entryPublication = z.object({
    // A collection's items only.
    collection: membership.optional(),
    // A multilingual Site's entries only.
    language: z.string().optional(),
    translations: z.array(translation).optional(),
    id: z.string(),
    title: z.string(),
    excerpt: z.string(),
    content: z.string(),
    uri: z.string(),
    date: z.string(),
    featuredImage: image,
    hasVideoHero: z.boolean(),
    spacingSizes,
    colors,
    ...extended,
  });
  const legalRole = z.object({
    role: z.string(),
    url: z.string(),
    title: z.string().nullable(),
    revision: z.string().nullable(),
    isFallback: z.boolean(),
  });
  const legal = z
    .object({
      controller: z.object({
        name: z.string().nullable(),
        privacyEmail: z.string().nullable(),
        dpoContact: z.string().nullable(),
      }),
      roles: z.array(legalRole),
      missingRequired: z.array(z.string()),
    })
    .nullable();
  const siteChrome = z.object({
    menuItems: z.array(menuItem),
    siteIcon: image,
    siteLogo: image,
    // Present once a Site with consent CMS settings has refreshed its chrome.
    legal: legal.optional(),
    analytics: z.object({ enabled: z.boolean(), measurementId: z.string().nullable() }).optional(),
  });
  const designPresets = z.object({ spacingSizes, colors });
  const archives = z.record(z.string());

  const parseWith = (schema: z.ZodType) => (body: unknown) => {
    const parsed = schema.safeParse(body);
    return parsed.success ? parsed.data : undefined;
  };
  const parseHome = parseWith(homePublication) as (body: unknown) => HomePublication | undefined;
  const parseChrome = parseWith(siteChrome) as (body: unknown) => SiteChrome | undefined;
  const parseEntry = parseWith(entryPublication) as (body: unknown) => EntryPublication | undefined;
  const parseDesign = parseWith(designPresets) as (body: unknown) => DesignPresets | undefined;
  const parseArchives = parseWith(archives) as (body: unknown) => Archives | undefined;

  const emptyChrome: SiteChrome = { menuItems: [], siteIcon: null, siteLogo: null };

  async function boundStore(): Promise<PublicationStore | null> {
    const { PUBLICATION_DB } = await config.bindings();
    return PUBLICATION_DB ? publicationStore(PUBLICATION_DB) : null;
  }

  function notServed(subject: string, reason: DeliveryFailureReason, message: string): NotServed {
    console.error(`Delivery: ${subject} can't be served (${reason}): ${message}`);
    return { kind: "unavailable", failure: { reason, message } };
  }

  function usable<T>(stored: StoredPublication<T> | Unusable | null) {
    return stored && stored.state !== "unusable" ? stored : null;
  }

  /**
   * The stored shared design presets, or null without them: a Site last
   * refreshed before they were stored apart serves each page with the presets
   * it was read with, as does one whose stored presets this Frontend can't read.
   */
  function sharedDesign(stored: StoredPublication<DesignPresets> | Unusable | null) {
    if (stored?.state === "unusable") {
      console.error(`Delivery: the shared design presets can't be served: ${stored.message}`);
    }
    return stored?.state === "published" ? stored.content : null;
  }

  /** A page's content with the shared design presets, when they are stored. */
  function withDesign<T extends DesignPresets>(content: T, design: DesignPresets | null): T {
    return design
      ? { ...content, spacingSizes: design.spacingSizes, colors: design.colors }
      : content;
  }

  /**
   * A language's front page and its chrome, from the store. Outside the
   * deployed Worker there is no store: explicit development reads the CMS live, and a
   * production build without one is not ready rather than a CMS reader for
   * every visitor. A language other than the default whose home the store has
   * never held isn't served: a 404.
   */
  async function publishedHome(
    siteOrigin?: string,
    language: SiteLanguage = defaultLanguage,
  ): Promise<HomeDelivery> {
    language = languages.find((each) => each.slug === language.slug) ?? defaultLanguage;
    const subject = languageSubject(language, "front page");
    if (!config.isServer())
      return notServed(subject, "not-ready", "Content delivery requires a server context");
    const store = await boundStore();
    if (!store) {
      if (config.development) return liveHome(siteOrigin, language);
      return notServed(
        subject,
        "not-ready",
        "this Frontend has no publication store bound (PUBLICATION_DB)",
      );
    }

    let home, chrome, design;
    try {
      [home, chrome, design] = await Promise.all([
        store.read(homeKey(language), parseHome),
        store.read(chromeKey(language), parseChrome),
        store.read(DESIGN, parseDesign),
      ]);
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      return notServed(subject, "store", error.message);
    }

    if (home?.state === "unusable") return notServed(subject, "not-ready", home.message);
    if (chrome?.state === "unusable") return notServed(subject, "not-ready", chrome.message);
    const storedChrome = chrome?.state === "published" ? chrome.content : null;
    if (
      home?.state === "missing" ||
      home?.state === "withdrawn" ||
      (!home && !language.isDefault)
    ) {
      return { kind: "missing", chrome: storedChrome };
    }
    if (home?.state !== "published" || !storedChrome) {
      return notServed(
        subject,
        "not-ready",
        "the front page and its chrome haven't been refreshed into the publication store yet",
      );
    }
    return {
      kind: "found",
      content: {
        home: withDesign(home.content, sharedDesign(design)),
        chrome: storedChrome,
        alternates: await storedAlternates(store, language, homesOf(languages)),
      },
    };
  }

  async function liveHome(
    siteOrigin: string | undefined,
    language: SiteLanguage,
  ): Promise<HomeDelivery> {
    const [home, chrome] = await Promise.all([
      getHomeContent(language),
      getSiteChrome(siteOrigin, { language }),
    ]);
    const liveChrome = chrome.kind === "found" ? chrome.content : null;
    if (home.kind === "unavailable") return home;
    if (home.kind === "missing") return { kind: "missing", chrome: liveChrome };
    const { blocksOmitted: _, nodeId: __, ...content } = home.content;
    return {
      kind: "found",
      content: {
        home: content,
        chrome: liveChrome ?? emptyChrome,
        alternates: liveAlternates(language, homesOf(languages)),
      },
    };
  }

  /** Each language's home, as the translations of a home. */
  const homesOf = (among: SiteLanguage[]): Translation[] =>
    among.map((language) => ({ uri: language.home, language: language.slug }));

  /**
   * Where a page's readers may switch language, from the store: for each other
   * language, the page's translation into it when the store serves it, else
   * that language's home when the store serves that. A language whose home the
   * store has never held offers neither. A store that can't be read offers
   * none, and the page is still served.
   */
  async function storedAlternates(
    store: PublicationStore,
    language: SiteLanguage,
    translations: Translation[],
  ): Promise<Alternate[]> {
    if (!multilingual) return [];
    const others = languages.filter((other) => other !== language);
    const translated = new Map(
      others.map((other) => {
        const found = translations.find((translation) => translation.language === other.slug);
        return [other, found ? routeOf(found.uri) : null];
      }),
    );
    let states: Map<string, string>;
    try {
      states = await store.states([
        ...others.map(homeKey),
        ...[...translated.values()].flatMap((route) => (route ? [routeKey(route)] : [])),
      ]);
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      console.error(`Delivery: the page's other languages can't be offered: ${error.message}`);
      return [];
    }
    return others.flatMap((other): Alternate[] => {
      const home = states.get(homeKey(other));
      if (!home) return [];
      const route = translated.get(other);
      if (route && states.get(routeKey(route)) === "published") {
        return [{ language: other, route, translation: true }];
      }
      return home === "published"
        ? [{ language: other, route: other.home, translation: false }]
        : [];
    });
  }

  /** Where a page read live, in explicit development, offers to switch language: WordPress's word for it. */
  function liveAlternates(language: SiteLanguage, translations: Translation[]): Alternate[] {
    if (!multilingual) return [];
    return languages
      .filter((other) => other !== language)
      .map((other) => {
        const found = translations.find((translation) => translation.language === other.slug);
        return found
          ? { language: other, route: routeOf(found.uri), translation: true }
          : { language: other, route: other.home, translation: false };
      });
  }

  /**
   * The published page or post at a path, with its language's chrome, from the
   * store. A stored entry is served without reading the CMS, through outages of
   * any length; one confirmed missing is a 404, one moved redirects. An entry
   * the store has never held is looked up (lookUpEntry). The store holds
   * nothing to serve entries with until a refresh has stored the chrome: not
   * ready. On a multilingual Site an entry is served only in its own language,
   * and a language whose home the store has never held serves nothing: a 404.
   */
  async function publishedEntry(path: string, siteOrigin?: string): Promise<EntryDelivery> {
    const route = routeOf(path);
    const language = routeLanguage(route);
    const subject = `the entry ${route}`;
    if (!config.isServer())
      return notServed(subject, "not-ready", "Content delivery requires a server context");
    const store = await boundStore();
    if (!store) {
      if (config.development) return liveEntry(route, language, siteOrigin);
      return notServed(
        subject,
        "not-ready",
        "this Frontend has no publication store bound (PUBLICATION_DB)",
      );
    }

    let entry, chrome, design, languageHome;
    try {
      [entry, chrome, design, languageHome] = await Promise.all([
        store.read(entryKey(route), parseEntry),
        store.read(chromeKey(language), parseChrome),
        store.read(DESIGN, parseDesign),
        language.isDefault ? null : store.states([homeKey(language)]),
      ]);
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      return notServed(subject, "store", error.message);
    }

    if (languageHome && !languageHome.has(homeKey(language))) {
      return { kind: "missing", chrome: chrome?.state === "published" ? chrome.content : null };
    }
    if (chrome?.state === "unusable") return notServed(subject, "not-ready", chrome.message);
    if (chrome?.state !== "published") {
      return notServed(
        subject,
        "not-ready",
        "the site chrome hasn't been refreshed into the publication store yet",
      );
    }
    const found = async (content: EntryPublication): Promise<EntryDelivery> => ({
      kind: "found",
      content: {
        entry: withDesign(content, sharedDesign(design)),
        chrome: chrome.content,
        alternates: await storedAlternates(store, language, content.translations ?? []),
      },
    });
    if (!entry) {
      const looked = await lookUpEntry(store, route, language, chrome.content);
      return looked.kind === "found" ? found(looked.content.entry) : looked;
    }
    switch (entry.state) {
      case "unusable":
        return notServed(subject, "not-ready", entry.message);
      case "missing":
      case "withdrawn":
        return { kind: "missing", chrome: chrome.content };
      case "moved":
        return { kind: "moved", uri: entry.uri };
      case "published":
        if (!inLanguage(entry.content, language))
          return { kind: "missing", chrome: chrome.content };
        return found(entry.content);
    }
  }

  /**
   * Whether an entry is in a language: always on a monolingual Site. An entry
   * stored before the Site listed its languages has none: it is the default
   * language's, until a refresh stores it with its own.
   */
  function inLanguage(entry: { language?: string }, language: SiteLanguage) {
    return !multilingual || (entry.language ?? defaultLanguage.slug) === language.slug;
  }

  /**
   * The cold path: an entry the store has never held is read from the CMS, the
   * one read a visit makes. Published and complete, it is promoted and served.
   * Confirmed missing is a 404 and stores nothing, since anyone can make up a
   * URL. A CMS failure is a 503: an empty store says nothing about whether the
   * entry exists. An entry WordPress keeps at another URI redirects there. One
   * whose withdrawal is in force is a 404, whatever WordPress still returns.
   */
  async function lookUpEntry(
    store: PublicationStore,
    route: string,
    language: SiteLanguage,
    chrome: SiteChrome,
  ): Promise<EntryDelivery> {
    const readStartedAt = Date.now();
    const read = await getEntryByUri(encodeURI(route));
    if (read.kind === "unavailable") return read;
    if (read.kind === "missing" || !inLanguage(read.content, language)) {
      return { kind: "missing", chrome };
    }
    const canonical = routeOf(read.content.uri);
    if (canonical !== route) return { kind: "moved", uri: canonical };

    const promoted = await promoteEntry(store, route, read, readStartedAt);
    if (promoted.outcome.outcome === "withdrawn") return { kind: "missing", chrome };
    await supersedeMoved(store, promoted.found ? [promoted.found] : [], readStartedAt);
    const { blocksOmitted: _, modifiedAt: __, ...entry } = read.content;
    return { kind: "found", content: { entry, chrome, alternates: [] } };
  }

  async function liveEntry(
    route: string,
    language: SiteLanguage,
    siteOrigin?: string,
  ): Promise<EntryDelivery> {
    const [read, chrome] = await Promise.all([
      getEntryByUri(encodeURI(route)),
      getSiteChrome(siteOrigin, { language }),
    ]);
    const liveChrome = chrome.kind === "found" ? chrome.content : null;
    if (read.kind === "unavailable") return read;
    if (read.kind === "missing" || !inLanguage(read.content, language)) {
      return { kind: "missing", chrome: liveChrome };
    }
    const { blocksOmitted: _, modifiedAt: __, ...entry } = read.content;
    return {
      kind: "found",
      content: {
        entry,
        chrome: liveChrome ?? emptyChrome,
        alternates: liveAlternates(language, entry.translations ?? []),
      },
    };
  }

  /**
   * The menu, logo and icon for a page that isn't a publication (one the site
   * adds itself): the stored chrome when there is a store, else a live read.
   * Null when neither has them; the page is then served without them.
   */
  async function pageChrome(siteOrigin?: string): Promise<SiteChrome | null> {
    if (!config.isServer()) return null;
    const store = await boundStore();
    if (!store) {
      if (!config.development) return null;
      const chrome = await getSiteChrome(siteOrigin);
      return chrome.kind === "found" ? chrome.content : null;
    }
    try {
      const stored = usable(await store.read(CHROME, parseChrome));
      return stored?.state === "published" ? stored.content : null;
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      console.error(`Delivery: the site chrome can't be served (store): ${error.message}`);
      return null;
    }
  }

  /**
   * The design presets for a page that isn't a publication: the stored ones
   * when there is a store, else a live read in explicit development. Null
   * when neither has them; the page is then served without them.
   */
  async function pageDesign(): Promise<DesignPresets | null> {
    if (!config.isServer()) return null;
    const store = await boundStore();
    if (!store) {
      if (!config.development) return null;
      const design = await getDesignPresets();
      return design.kind === "found" ? design.content : null;
    }
    try {
      return sharedDesign(await store.read(DESIGN, parseDesign));
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      console.error(`Delivery: the design presets can't be served (store): ${error.message}`);
      return null;
    }
  }

  type RefreshFailureReason = CmsFailureReason | "partial" | "store";

  interface RefreshFailure {
    reason: RefreshFailureReason;
    message: string;
  }

  /**
   * What a refresh did with one row. `uri` is where a moved row now points, or
   * where WordPress keeps an entry requested at another route. "withdrawn": the
   * read found an entry whose withdrawal is in force, so nothing was promoted.
   */
  type RecordOutcome =
    | { outcome: "promoted" | "superseded"; state: "published" | "missing" | "moved"; uri?: string }
    | { outcome: "withdrawn" }
    | { outcome: "kept"; failure: RefreshFailure };

  /** Whether WordPress listed every published route, and how many. */
  type RoutesOutcome =
    | { outcome: "listed"; count: number }
    | { outcome: "failed"; failure: RefreshFailure };

  interface EntriesRefreshReport {
    /** Whether every read was promoted (or superseded by a newer one). */
    refreshed: boolean;
    /** Each refreshed route's outcome. */
    entries: Record<string, RecordOutcome>;
    /** Routes whose entry was found at another URI, and that URI. */
    moved: Record<string, string>;
  }

  interface RefreshReport extends EntriesRefreshReport {
    /** Whether every language's front page can be served from the store after this refresh. */
    ready: boolean;
    home: RecordOutcome;
    chrome: RecordOutcome;
    design: RecordOutcome;
    /** Where each collection's archive is, on a Site with collections. */
    archives?: RecordOutcome;
    routes: RoutesOutcome;
    /** A multilingual Site's other languages, by slug: their front page and chrome. */
    languages?: Record<string, { home: RecordOutcome; chrome: RecordOutcome }>;
  }

  /**
   * Refreshes the whole Site, the explicit preparation of its store: each
   * language's front page and chrome, the shared design presets, and every
   * entry WordPress lists as published or the store already holds (so one
   * deleted or moved since is reconciled). Each read that
   * is complete and valid is promoted; a failed one keeps what is stored, so a
   * failed chrome read doesn't touch the front page or the entries, nor the
   * reverse. Reads are anonymous, as a visitor's would be, so only published
   * content can enter the store.
   */
  async function refreshSite(store: PublicationStore, siteOrigin?: string): Promise<RefreshReport> {
    const readStartedAt = Date.now();
    const others = languages.filter((language) => !language.isDefault);
    const [home, chrome, design, archiveRead, listing, ...otherReads] = await Promise.all([
      getHomeContent(),
      getSiteChrome(siteOrigin),
      getDesignPresets(),
      hasCollections ? getArchives() : undefined,
      getPublishedRoutes(),
      ...others.map((language) =>
        Promise.all([getHomeContent(language), getSiteChrome(siteOrigin, { language })]),
      ),
    ]);

    const homeOutcome = await promoteHome(store, home, readStartedAt);
    const chromeOutcome = await promoteChrome(store, chrome, readStartedAt);
    const designOutcome = await promoteDesign(store, design, readStartedAt);
    const archivesOutcome = archiveRead
      ? await promoteArchives(store, archiveRead, readStartedAt)
      : undefined;
    const languageOutcomes: NonNullable<RefreshReport["languages"]> = {};
    for (const [index, language] of others.entries()) {
      const [languageHome, languageChrome] = otherReads[index]!;
      languageOutcomes[language.slug] = {
        home: await promoteHome(store, languageHome, readStartedAt, language),
        chrome: await promoteChrome(store, languageChrome, readStartedAt, language),
      };
    }

    let stored: string[] = [];
    let routes: RoutesOutcome =
      listing.kind === "found"
        ? { outcome: "listed", count: listing.content.length }
        : { outcome: "failed", failure: listing.failure };
    try {
      stored = (await store.keys(ENTRY)).map((key) => key.slice(ENTRY.length));
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      if (routes.outcome === "listed") {
        routes = { outcome: "failed", failure: { reason: "store", message: error.message } };
      }
    }
    if (routes.outcome === "failed") {
      console.error(
        `Refresh: the published routes couldn't be listed (${routes.failure.reason}): ${routes.failure.message}`,
      );
    }
    const listed = listing.kind === "found" ? listing.content.map(routeOf) : [];
    // Each language's front page is its home's, never an entry.
    const wanted = [...new Set([...listed, ...stored])].filter((route) => !isLanguageHome(route));
    const entries = await refreshRoutes(store, wanted, readStartedAt);

    let ready = false;
    try {
      const stored = await Promise.all(
        languages.map((language) =>
          Promise.all([
            store.read(homeKey(language), parseHome),
            store.read(chromeKey(language), parseChrome),
          ]),
        ),
      );
      ready = stored.every(
        ([storedHome, storedChrome]) =>
          usable(storedHome) !== null &&
          (storedHome?.state === "missing" ||
            storedHome?.state === "withdrawn" ||
            usable(storedChrome)?.state === "published"),
      );
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
    }
    return {
      ready,
      refreshed:
        homeOutcome.outcome !== "kept" &&
        chromeOutcome.outcome !== "kept" &&
        designOutcome.outcome !== "kept" &&
        archivesOutcome?.outcome !== "kept" &&
        Object.values(languageOutcomes).every(
          (outcomes) => outcomes.home.outcome !== "kept" && outcomes.chrome.outcome !== "kept",
        ) &&
        routes.outcome === "listed" &&
        entries.refreshed,
      home: homeOutcome,
      chrome: chromeOutcome,
      design: designOutcome,
      ...(archivesOutcome ? { archives: archivesOutcome } : {}),
      routes,
      entries: entries.entries,
      moved: entries.moved,
      ...(multilingual ? { languages: languageOutcomes } : {}),
    };
  }

  /** What a shared setting's change refreshes: the rows every affected page is served with. */
  type SharedPart = "home" | "chrome" | "design" | "archives";

  /**
   * A report of the shared rows: the default language's front page and chrome,
   * the design presets, and a multilingual Site's other languages' front page
   * and chrome, by slug.
   */
  interface SharedRows<T> {
    home?: T;
    chrome?: T;
    design?: T;
    archives?: T;
    languages?: Record<string, { home?: T; chrome?: T }>;
  }

  /** Every outcome in a report of shared rows, each language's included. */
  function sharedOutcomes<T>(rows: SharedRows<T>): T[] {
    return [
      rows.home,
      rows.chrome,
      rows.design,
      rows.archives,
      ...Object.values(rows.languages ?? {}).flatMap((language) => [
        language.home,
        language.chrome,
      ]),
    ].filter((outcome): outcome is T => outcome !== undefined);
  }

  interface SharedRefreshReport extends SharedRows<RecordOutcome> {
    /** Whether every part was promoted (or superseded by a newer read). */
    refreshed: boolean;
    /** The archive addresses read again with the archives, and each one's outcome. */
    entries?: Record<string, RecordOutcome>;
  }

  /**
   * Refreshes shared settings: the chrome (menu, logo, icon), the shared design
   * presets, or the front page (which holds the site's title and tagline).
   * Every page is served with the stored chrome and design, so promoting them
   * reaches every page at once, without reading the entries again. With
   * `language`, only that language's front page and chrome: its title, tagline
   * and menus are its own. Without, every language's, since what changed (the
   * logo, the icon, the title a language doesn't translate) is shared by them
   * all. Each part is promoted only from a complete, valid read; a failed one
   * keeps what is stored, so a failed read never erases navigation, branding or
   * design.
   */
  async function refreshShared(
    store: PublicationStore,
    parts: SharedPart[],
    siteOrigin?: string,
    language?: SiteLanguage,
  ): Promise<SharedRefreshReport> {
    const readStartedAt = Date.now();
    const wanted = new Set(parts);
    const scope = language ? [language] : languages;
    const [reads, design, archiveRead] = await Promise.all([
      Promise.all(
        scope.map((each) =>
          Promise.all([
            wanted.has("home") ? getHomeContent(each) : undefined,
            wanted.has("chrome") ? getSiteChrome(siteOrigin, { language: each }) : undefined,
          ]),
        ),
      ),
      wanted.has("design") && !language ? getDesignPresets() : undefined,
      wanted.has("archives") && !language && hasCollections ? getArchives() : undefined,
    ]);
    const report: SharedRefreshReport = { refreshed: true };
    for (const [index, each] of scope.entries()) {
      const [home, chrome] = reads[index]!;
      const rows: { home?: RecordOutcome; chrome?: RecordOutcome } = each.isDefault
        ? report
        : ((report.languages ??= {})[each.slug] = {});
      if (home) rows.home = await promoteHome(store, home, readStartedAt, each);
      if (chrome) rows.chrome = await promoteChrome(store, chrome, readStartedAt, each);
    }
    if (design) report.design = await promoteDesign(store, design, readStartedAt);
    if (archiveRead) {
      // Saving the Archives mapping can give an address to a Page, or take it
      // back for the type's own archive, without modifying the Page or
      // changing the address: every archive address, old and new, is read
      // again, so a Page stored missing behind an archive is served at once,
      // and one that lost its address isn't served there any longer.
      const before = archiveRead.kind === "found" ? await storedArchives(store) : undefined;
      report.archives = await promoteArchives(store, archiveRead, readStartedAt);
      if (archiveRead.kind === "found" && report.archives.outcome !== "kept") {
        const routes = archiveRoutes(before, archiveRead.content, "all");
        if (routes.length > 0) report.entries = (await refreshEntries(store, routes)).entries;
      }
    }
    report.refreshed = [...sharedOutcomes(report), ...Object.values(report.entries ?? {})].every(
      (outcome) => outcome.outcome !== "kept",
    );
    return report;
  }

  /**
   * The state of each other language's front page and chrome in the store, by
   * slug ("unusable" in a format this Worker doesn't serve, null when nothing
   * was ever stored); undefined on a monolingual Site.
   */
  async function languageRowStates(
    store: PublicationStore,
  ): Promise<Record<string, { home: string | null; chrome: string | null }> | undefined> {
    if (!multilingual) return undefined;
    const others = languages.filter((language) => !language.isDefault);
    const states = await store.states(
      others.flatMap((other) => [homeKey(other), chromeKey(other)]),
    );
    return Object.fromEntries(
      others.map((other) => [
        other.slug,
        {
          home: states.get(homeKey(other)) ?? null,
          chrome: states.get(chromeKey(other)) ?? null,
        },
      ]),
    );
  }

  type SharedOutcome = RecordOutcome | { outcome: "unchanged" };
  interface SharedReconciliation {
    home: SharedOutcome;
    chrome: SharedOutcome;
    design: SharedOutcome;
    archives?: SharedOutcome;
    /**
     * When the archives row was promoted with a change: the addresses of the
     * post types whose archive moved, old and new, for reconciliation to read
     * again within its budget.
     */
    archiveRoutes?: string[];
    languages?: Record<string, { home: SharedOutcome; chrome: SharedOutcome }>;
  }
  /**
   * Reconciles the shared rows with WordPress: reads each language's front page
   * (with its title and tagline) and chrome, and the design presets, compares
   * each read with what is stored, and promotes the ones that differ, by the
   * same rules as any refresh. A failed read keeps what is stored. Comparing
   * what WordPress returns, rather than asking it what changed, catches a change
   * to any shared setting, in any language, whatever saved it.
   */
  async function reconcileShared(
    store: PublicationStore,
    siteOrigin?: string,
  ): Promise<SharedReconciliation> {
    const readStartedAt = Date.now();
    const [reads, design, archiveRead] = await Promise.all([
      Promise.all(
        languages.map((language) =>
          Promise.all([getHomeContent(language), getSiteChrome(siteOrigin, { language })]),
        ),
      ),
      getDesignPresets(),
      hasCollections ? getArchives() : undefined,
    ]);
    const unchanged = async <T>(
      key: string,
      parse: (body: unknown) => T | undefined,
      read: { state: "published"; content: unknown } | { state: "missing" } | null,
    ) => {
      if (!read) return false;
      try {
        const stored = await store.read(key, parse);
        if (!stored || stored.state !== read.state) return false;
        return (
          stored.state !== "published" ||
          ("content" in read && canonicalJson(stored.content) === canonicalJson(read.content))
        );
      } catch (error) {
        if (!(error instanceof StoreFailure)) throw error;
        return false;
      }
    };

    const homeRead = (
      home: Delivery<HomeContent>,
    ): { state: "published"; content: HomePublication } | { state: "missing" } | null => {
      if (home.kind === "missing") return { state: "missing" };
      if (home.kind !== "found" || home.content.blocksOmitted) return null;
      const { blocksOmitted: _, nodeId: __, ...content } = home.content;
      return { state: "published", content };
    };
    const sharedRead = (
      read: SharedRead<SiteChrome> | SharedRead<DesignPresets> | SharedRead<Archives>,
    ) => (read.kind === "found" ? ({ state: "published", content: read.content } as const) : null);

    const outcomes: Array<{ home: SharedOutcome; chrome: SharedOutcome }> = [];
    for (const [index, language] of languages.entries()) {
      const [home, chrome] = reads[index]!;
      outcomes.push({
        home: (await unchanged(homeKey(language), parseHome, homeRead(home)))
          ? { outcome: "unchanged" }
          : await promoteHome(store, home, readStartedAt, language),
        chrome: (await unchanged(chromeKey(language), parseChrome, sharedRead(chrome)))
          ? { outcome: "unchanged" }
          : await promoteChrome(store, chrome, readStartedAt, language),
      });
    }
    let archives: SharedOutcome | undefined;
    let changedArchives: string[] = [];
    if (archiveRead) {
      const before = await storedArchives(store);
      if (await unchanged(ARCHIVES, parseArchives, sharedRead(archiveRead))) {
        archives = { outcome: "unchanged" };
      } else {
        archives = await promoteArchives(store, archiveRead, readStartedAt);
        if (archiveRead.kind === "found" && archives.outcome === "promoted") {
          changedArchives = archiveRoutes(before, archiveRead.content, "changed");
        }
      }
    }
    const [own, ...others] = outcomes;
    return {
      ...own!,
      design: (await unchanged(DESIGN, parseDesign, sharedRead(design)))
        ? { outcome: "unchanged" }
        : await promoteDesign(store, design, readStartedAt),
      ...(archives ? { archives } : {}),
      ...(changedArchives.length > 0 ? { archiveRoutes: changedArchives } : {}),
      ...(multilingual
        ? {
            languages: Object.fromEntries(
              others.map((outcome, index) => [languages[index + 1]!.slug, outcome]),
            ),
          }
        : {}),
    };
  }

  /** JSON with its object keys sorted, so two equal values compare equal. */
  function canonicalJson(value: unknown): string {
    return JSON.stringify(value, (_key, item: unknown) =>
      item && typeof item === "object" && !Array.isArray(item)
        ? Object.fromEntries(
            Object.entries(item as Record<string, unknown>).sort(([a], [b]) => (a < b ? -1 : 1)),
          )
        : item,
    );
  }

  type SharedRead<T> = Found<T> | { kind: "unavailable"; failure: RefreshFailure };

  /** Promotes a read of a shared row. */
  function promoteShared<T>(
    store: PublicationStore,
    key: string,
    subject: string,
    parse: (body: unknown) => T | undefined,
    read: SharedRead<T>,
    readStartedAt: number,
  ) {
    return promoteRead(store, key, subject, readStartedAt, parse, () =>
      read.kind === "found" ? { state: "published", content: read.content } : read.failure,
    );
  }

  /** Promotes a read of a language's chrome. */
  function promoteChrome(
    store: PublicationStore,
    read: SharedRead<SiteChrome>,
    readStartedAt: number,
    language: SiteLanguage = defaultLanguage,
  ) {
    const subject = languageSubject(language, "site chrome");
    return promoteShared(store, chromeKey(language), subject, parseChrome, read, readStartedAt);
  }

  /** Promotes a read of the shared design presets. */
  function promoteDesign(
    store: PublicationStore,
    read: SharedRead<DesignPresets>,
    readStartedAt: number,
  ) {
    const subject = "the shared design presets";
    return promoteShared(store, DESIGN, subject, parseDesign, read, readStartedAt);
  }

  /** Where each collection's archive is, as stored; undefined when it can't be read. */
  async function storedArchives(store: PublicationStore): Promise<Archives | undefined> {
    try {
      const stored = await store.read(ARCHIVES, parseArchives);
      return stored?.state === "published" ? stored.content : undefined;
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      return undefined;
    }
  }

  /**
   * The archive addresses to read again after a read of where the archives
   * are: every address before or after it ("all"), or only the old and new
   * address of each post type whose archive moved ("changed"). A language's
   * front page is its home's, never an entry.
   */
  function archiveRoutes(
    before: Archives | undefined,
    after: Archives,
    which: "all" | "changed",
  ): string[] {
    const routes = new Set<string>();
    for (const type of new Set([...Object.keys(before ?? {}), ...Object.keys(after)])) {
      const old = before?.[type];
      const now = after[type];
      if (which === "changed" && old === now) continue;
      for (const uri of [old, now]) if (uri) routes.add(routeOf(uri));
    }
    return [...routes].filter((route) => !isLanguageHome(route));
  }

  /** Promotes a read of where each collection's archive is. */
  function promoteArchives(
    store: PublicationStore,
    read: SharedRead<Archives>,
    readStartedAt: number,
  ) {
    return promoteShared(store, ARCHIVES, "the archives", parseArchives, read, readStartedAt);
  }

  /**
   * Refreshes a language's front page only (not its chrome or the entries): the
   * front page itself was published or changed.
   */
  async function refreshHome(
    store: PublicationStore,
    language: SiteLanguage = defaultLanguage,
  ): Promise<RecordOutcome> {
    const readStartedAt = Date.now();
    return promoteHome(store, await getHomeContent(language), readStartedAt, language);
  }

  function promoteHome(
    store: PublicationStore,
    home: Delivery<HomeContent>,
    readStartedAt: number,
    language: SiteLanguage = defaultLanguage,
  ) {
    const subject = languageSubject(language, "front page");
    return promoteRead(store, homeKey(language), subject, readStartedAt, parseHome, () => {
      if (home.kind === "unavailable") return home.failure;
      if (home.kind === "missing") return { state: "missing" };
      const { blocksOmitted, nodeId, ...content } = home.content;
      if (blocksOmitted) {
        return {
          reason: "partial",
          message: `WordPress could only return ${subject} without its blocks`,
        };
      }
      return { state: "published", content, ...(nodeId ? { nodeId } : {}) };
    });
  }

  /**
   * Refreshes the entries at these paths only: a new publication, a changed
   * one, or the route one left. An entry found at another URI than before is
   * promoted there, and the routes that served it redirect to it.
   */
  async function refreshEntries(
    store: PublicationStore,
    paths: string[],
  ): Promise<EntriesRefreshReport> {
    const readStartedAt = Date.now();
    return refreshRoutes(store, [...new Set(paths.map(routeOf))], readStartedAt);
  }

  async function refreshRoutes(
    store: PublicationStore,
    routes: string[],
    refreshStartedAt: number,
  ): Promise<EntriesRefreshReport> {
    const reads = await eachLimited(routes, 4, async (route) => {
      const readStartedAt = Date.now();
      return { route, readStartedAt, read: await getEntryByUri(encodeURI(route)) };
    });

    // Found and failed reads first. Then the routes still serving an entry
    // found elsewhere are marked moved, including one WordPress now confirms
    // missing: its visitors are redirected rather than shown a 404. Only then
    // is the rest that is confirmed missing promoted.
    const outcomes = new Map<string, RecordOutcome>();
    const found: Array<{ nodeId: string; route: string }> = [];
    for (const { route, readStartedAt, read } of reads) {
      if (read.kind === "missing") continue;
      const promoted = await promoteEntry(store, route, read, readStartedAt, true);
      outcomes.set(route, promoted.outcome);
      if (promoted.found) found.push(promoted.found);
    }
    const { moved, failed } = await supersedeMoved(store, found, refreshStartedAt);
    for (const { route, readStartedAt, read } of reads) {
      if (read.kind !== "missing") continue;
      outcomes.set(
        route,
        moved[route]
          ? { outcome: "promoted", state: "moved", uri: moved[route] }
          : (await promoteEntry(store, route, read, readStartedAt)).outcome,
      );
    }

    const entries = Object.fromEntries(routes.map((route) => [route, outcomes.get(route)!]));
    return {
      refreshed: !failed && Object.values(entries).every((outcome) => outcome.outcome !== "kept"),
      entries,
      moved,
    };
  }

  interface EntryPromotion {
    outcome: RecordOutcome;
    /** The entry the read found, at its own route, when it was stored there. */
    found?: { nodeId: string; route: string };
  }

  /**
   * Promotes one entry read. A found entry is stored at the route WordPress
   * gives it, never at a route it was only requested at: with `recordAlias`
   * (an explicit refresh of that route), the requested route is stored as
   * moved to it. A language's front page is its home's, so a route that
   * resolves to it moves to that home (`/`, `/en/`).
   */
  async function promoteEntry(
    store: PublicationStore,
    route: string,
    read: Delivery<EntryContent>,
    readStartedAt: number,
    recordAlias = false,
  ): Promise<EntryPromotion> {
    const promote = (at: string, result: () => ReadResult<EntryPublication>) =>
      promoteRead(store, entryKey(at), `the entry ${at}`, readStartedAt, parseEntry, result);

    if (read.kind !== "found") {
      return {
        outcome: await promote(route, () =>
          read.kind === "missing" ? { state: "missing" } : read.failure,
        ),
      };
    }
    const { blocksOmitted, modifiedAt, ...entry } = read.content;
    if (blocksOmitted) {
      return {
        outcome: await promote(route, () => ({
          reason: "partial",
          message: `WordPress could only return the entry ${route} without its blocks`,
        })),
      };
    }

    const canonical = routeOf(entry.uri);
    const moved = { state: "moved" as const, uri: canonical, nodeId: entry.id };
    if (isLanguageHome(canonical)) {
      const outcome = await promote(route, () => moved);
      if (outcome.outcome === "withdrawn") return { outcome };
      return { outcome, found: { nodeId: entry.id, route: canonical } };
    }
    const outcome = await promote(canonical, () => ({
      state: "published",
      content: stored(entry),
      nodeId: entry.id,
      modifiedAt,
    }));
    if (outcome.outcome === "kept" || outcome.outcome === "withdrawn") return { outcome };
    const found = { nodeId: entry.id, route: canonical };
    if (canonical === route) return { outcome, found };
    if (!recordAlias) return { outcome: { ...outcome, uri: canonical }, found };
    return { outcome: await promote(route, () => moved), found };
  }

  /** An entry as stored: a collection's item with the text its search matches. */
  function stored(entry: EntryPublication): EntryPublication {
    if (!entry.collection) return entry;
    const search = searchText(decodeEntities(`${entry.title} ${stripHtml(entry.excerpt)}`));
    return { ...entry, collection: { ...entry.collection, search } as typeof entry.collection };
  }

  /**
   * Every other route still serving an entry that was just found at its own
   * route is marked moved there, unless it was read since `readBefore`: a
   * renamed page's old route stops presenting its superseded copy.
   */
  async function supersedeMoved(
    store: PublicationStore,
    found: Array<{ nodeId: string; route: string }>,
    readBefore: number,
  ) {
    const moved: Record<string, string> = {};
    let failed = false;
    for (const { nodeId, route } of found) {
      try {
        const keys = await store.supersede(nodeId, route, entryKey(route), readBefore);
        for (const key of keys) {
          const from = key.slice(ENTRY.length);
          moved[from] = route;
          console.info(`Refresh: the entry ${from} moved to ${route}`);
        }
      } catch (error) {
        if (!(error instanceof StoreFailure)) throw error;
        failed = true;
        console.error(
          `Refresh: the routes the entry ${route} left couldn't be reconciled: ${error.message}`,
        );
      }
    }
    return { moved, failed };
  }

  async function eachLimited<T, R>(items: T[], limit: number, work: (item: T) => Promise<R>) {
    const results: R[] = [];
    let next = 0;
    const worker = async () => {
      while (next < items.length) {
        const index = next;
        next += 1;
        results[index] = await work(items[index]!);
      }
    };
    await Promise.all(Array.from({ length: Math.min(limit, items.length) }, worker));
    return results;
  }

  type ReadResult<T> = Promotion<T> | RefreshFailure;

  /**
   * Promotes a read unless it failed, or its content wouldn't be readable back
   * from the store by this Frontend (so nothing the renderer can't serve is
   * accepted), and records the outcome.
   */
  async function promoteRead<T>(
    store: PublicationStore,
    key: string,
    subject: string,
    readStartedAt: number,
    parse: (body: unknown) => T | undefined,
    read: () => ReadResult<T>,
  ): Promise<RecordOutcome> {
    let result = read();
    if (
      "state" in result &&
      result.state === "published" &&
      parse(JSON.parse(JSON.stringify(result.content))) === undefined
    ) {
      result = { reason: "schema", message: `${subject} isn't in a shape this Frontend can serve` };
    }
    let outcome: RecordOutcome;
    if ("reason" in result) {
      outcome = { outcome: "kept", failure: { reason: result.reason, message: result.message } };
    } else {
      try {
        const promoted = await store.promote(key, result, readStartedAt);
        outcome =
          promoted === "withdrawn"
            ? { outcome: "withdrawn" }
            : result.state === "moved"
              ? { outcome: promoted, state: "moved", uri: result.uri }
              : { outcome: promoted, state: result.state };
      } catch (error) {
        if (!(error instanceof StoreFailure)) throw error;
        outcome = { outcome: "kept", failure: { reason: "store", message: error.message } };
      }
    }

    if (outcome.outcome === "kept") {
      console.error(
        `Refresh: ${subject} kept its last stored version (${outcome.failure.reason}): ${outcome.failure.message}`,
      );
    } else if (outcome.outcome === "withdrawn") {
      console.info(`Refresh: ${subject} isn't promoted: its entry is withdrawn`);
    } else {
      console.info(
        `Refresh: ${subject} ${outcome.outcome} (${outcome.state}${outcome.uri ? ` to ${outcome.uri}` : ""})`,
      );
    }
    try {
      await store.recordAttempt(
        key,
        outcome.outcome === "kept"
          ? { outcome: "kept", reason: outcome.failure.reason, message: outcome.failure.message }
          : outcome.outcome === "withdrawn"
            ? { outcome: "superseded", reason: "withdrawn" }
            : { outcome: outcome.outcome },
      );
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      console.error(`Refresh: ${subject}'s outcome couldn't be recorded: ${error.message}`);
    }
    return outcome;
  }

  interface WithdrawalReport {
    status: "withdrawn" | "superseded";
    /** The routes now withdrawn (`/` or `/en/` for a language's front page). */
    withdrawn: string[];
    /** The later event that already won, when it is known. */
    by?: string;
  }

  /**
   * Withdraws a page or post the CMS unpublished, made private or
   * password-protected, trashed or deleted, without reading the CMS: every
   * route the store holds it at (served or redirecting) and the URI it was
   * withdrawn at become a 404 at once, and stay one through outages, restarts,
   * fallbacks, delayed or duplicate events and older in-flight reads, since no
   * read promotes it again while the withdrawal is in force. A route holding
   * another entry is left alone. A publication that happened later wins over
   * it, before or after.
   */
  async function withdrawEntry(
    store: PublicationStore,
    event: PublicationEvent,
  ): Promise<WithdrawalReport> {
    const route = routeOf(event.uri);
    const outcome = await store.withdraw(event, routeKey(route), Date.now());
    if (outcome.status === "superseded") {
      console.info(
        `Withdrawal: ${event.id} for ${route} is superseded${outcome.by ? ` by the later ${outcome.by}` : ""}`,
      );
      return { status: "superseded", withdrawn: [], ...(outcome.by ? { by: outcome.by } : {}) };
    }
    const withdrawn = outcome.keys.map(keyRoute);
    console.info(`Withdrawal: ${event.id} withdrew ${withdrawn.join(", ") || "nothing stored"}`);
    return { status: "withdrawn", withdrawn };
  }

  /** The collection's config, or an error: a Site only lists what it declares. */
  function collectionNamed(name: string) {
    if (!Object.hasOwn(collections, name)) throw new Error(`${name} isn't a collection`);
    return collections[name]!;
  }

  /** A taxonomy's terms in an item's stored body, as a JSON path. */
  const termsPath = (taxonomy: string) => `$.collection.terms."${taxonomy}"`;

  /** The language a listing is in: a multilingual Site's (by slug), else none. */
  function listingLanguage(slug: string | undefined) {
    if (!multilingual) return null;
    if (slug === undefined) return defaultLanguage.slug;
    if (!languages.some((language) => language.slug === slug))
      throw new Error(`${slug} isn't one of the Site's languages`);
    return slug;
  }

  /**
   * A page of a collection's items, from the store alone: never WordPress,
   * so a listing is served through outages as its items are. Items whose
   * stored body this Frontend can't serve are left out.
   */
  async function list(query: CollectionQuery): Promise<CollectionListing> {
    const collection = collectionNamed(query.collection);
    const subject = `the ${query.collection} collection`;
    const page = Math.max(1, whole("page", query.page, 1));
    const perPage = Math.min(100, Math.max(1, whole("perPage", query.perPage, 12)));
    const taxonomies = collection.taxonomies ?? [];
    // A taxonomy given no slugs doesn't filter.
    const terms = Object.entries(query.terms ?? {}).flatMap(([taxonomy, slugs]) => {
      if (!taxonomies.includes(taxonomy))
        throw new Error(`${taxonomy} isn't one of the ${query.collection} collection's taxonomies`);
      return slugs.length > 0 ? [{ path: termsPath(taxonomy), slugs: [...slugs] }] : [];
    });
    const search = searchText(query.search ?? "");
    const filter = {
      collection: query.collection,
      language: listingLanguage(query.language),
      defaultLanguage: defaultLanguage.slug,
      terms,
      search: search || null,
    };
    const store = await listingStore(subject);
    if ("kind" in store) return store;
    let found;
    try {
      found = await store.listItems(filter, perPage, (page - 1) * perPage);
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      return notServed(subject, "store", error.message);
    }
    const items = found.items.flatMap((row): CollectionItem[] => {
      let entry: EntryPublication | undefined;
      try {
        entry = parseEntry(JSON.parse(row.body));
      } catch {
        entry = undefined;
      }
      if (!entry) {
        console.error(`Delivery: ${row.key} is stored with a body this Frontend can't read`);
        return [];
      }
      return [
        {
          uri: entry.uri,
          title: entry.title,
          date: entry.date,
          modifiedAt: row.modifiedAt,
          excerpt: entry.excerpt,
          featuredImage: entry.featuredImage,
          terms: Object.fromEntries(
            taxonomies.map((taxonomy) => [taxonomy, entry.collection?.terms[taxonomy] ?? []]),
          ),
          ...(entry.extension !== undefined ? { extension: entry.extension } : {}),
          ...(entry.language !== undefined ? { language: entry.language } : {}),
        },
      ];
    });
    return {
      kind: "found",
      items,
      total: found.total,
      page,
      pages: Math.ceil(found.total / perPage),
    };
  }

  /** A listing's whole-number option (as a number, or a string of one, from a URL), else its default. */
  function whole(option: string, value: unknown, fallback: number): number {
    if (value === undefined || value === null || value === "") return fallback;
    const number = Number(value);
    if (!Number.isFinite(number))
      throw new Error(`${option} must be a number, not ${JSON.stringify(value)}`);
    return Math.floor(number);
  }

  /** The terms of a collection's taxonomy its stored items have, with how many have each. */
  async function terms(
    name: string,
    taxonomy: string,
    options: { language?: string } = {},
  ): Promise<CollectionTermListing> {
    const collection = collectionNamed(name);
    if (!(collection.taxonomies ?? []).includes(taxonomy))
      throw new Error(`${taxonomy} isn't one of the ${name} collection's taxonomies`);
    const subject = `the ${name} collection's ${taxonomy}`;
    const filter = {
      collection: name,
      language: listingLanguage(options.language),
      defaultLanguage: defaultLanguage.slug,
      terms: [],
      search: null,
    };
    const store = await listingStore(subject);
    if ("kind" in store) return store;
    try {
      return { kind: "found", terms: await store.itemTerms(filter, termsPath(taxonomy)) };
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      return notServed(subject, "store", error.message);
    }
  }

  /** The store a listing reads, or why there is none: a listing is never read live. */
  async function listingStore(subject: string): Promise<PublicationStore | NotServed> {
    if (!config.isServer())
      return notServed(subject, "not-ready", "Content delivery requires a server context");
    let store;
    try {
      store = await boundStore();
    } catch {
      return notServed(subject, "store", "The publication store couldn't be loaded");
    }
    if (!store) {
      return notServed(
        subject,
        "not-ready",
        "this Frontend has no publication store bound (PUBLICATION_DB); collections are only listed from one",
      );
    }
    return store;
  }

  /**
   * Where a collection's archive is: the stored archives when there is a
   * store, else (in explicit development) a live read. Null when it has none,
   * or neither can be read.
   */
  async function archiveUri(name: string): Promise<string | null> {
    const { postType } = collectionNamed(name);
    if (!config.isServer()) return null;
    const store = await boundStore();
    if (!store) {
      if (!config.development) return null;
      const read = await getArchives();
      return read.kind === "found" ? (read.content[postType] ?? null) : null;
    }
    try {
      const stored = await store.read(ARCHIVES, parseArchives);
      if (stored?.state === "unusable") {
        console.error(`Delivery: the archives can't be served: ${stored.message}`);
      }
      return stored?.state === "published" ? (stored.content[postType] ?? null) : null;
    } catch (error) {
      if (!(error instanceof StoreFailure)) throw error;
      console.error(`Delivery: the archives can't be served (store): ${error.message}`);
      return null;
    }
  }

  /** The refresh's credential when the Worker has one bound, and it is strong enough. */
  async function refreshAuthority(): Promise<
    { store: PublicationStore; token: string } | { refused: string }
  > {
    const { PUBLICATION_DB, FRONTEND_REFRESH_TOKEN: token } = await config.bindings();
    if (!PUBLICATION_DB) return { refused: "this Frontend has no publication store bound" };
    if (!token || token.length < 32) {
      return { refused: "this Frontend has no refresh token of 32 characters or more bound" };
    }
    return { store: publicationStore(PUBLICATION_DB), token };
  }

  /** Compares a request's bearer token with the bound one, in constant time. */
  const isAuthorized = bearerMatches;

  const safely = async <T>(read: () => Promise<T>, fallback: () => T): Promise<T> => {
    try {
      return await read();
    } catch {
      return fallback();
    }
  };
  return {
    reconcileShared,
    eachLimited,
    refreshSite,
    refreshEntries,
    refreshHome,
    refreshShared,
    sharedOutcomes,
    withdrawEntry,
    languageRowStates,
    refreshAuthority,
    isAuthorized,
    publishedHome: (siteOrigin?: string, language?: SiteLanguage): Promise<HomeDelivery> =>
      safely(
        async () => html.home(await publishedHome(siteOrigin, language), language),
        () => notServed("the front page", "store", "The publication store couldn't be loaded"),
      ),
    publishedEntry: (path: string, siteOrigin?: string): Promise<EntryDelivery> =>
      safely(
        async () =>
          html.entry(await publishedEntry(path, siteOrigin), routeLanguage(routeOf(path))),
        () => notServed("the entry", "store", "The publication store couldn't be loaded"),
      ),
    pageChrome: (siteOrigin?: string): Promise<SiteChrome | null> =>
      safely(
        () => pageChrome(siteOrigin),
        () => null,
      ),
    designPresets: (): Promise<DesignPresets | null> =>
      safely(
        () => pageDesign(),
        () => null,
      ),
    list,
    terms,
    archiveUri: (collection: string): Promise<string | null> => {
      collectionNamed(collection);
      return safely(
        () => archiveUri(collection),
        () => null,
      );
    },
  };
}

/** Text as a search compares it: lowercase, without accents, its spaces collapsed. */
export function searchText(text: string) {
  return text
    .normalize("NFD")
    .replace(/\p{M}/gu, "")
    .replace(/[\u2018\u2019\u201A\u201B\u2032]/g, "'")
    .replace(/[\u201C\u201D\u201E\u2033]/g, '"')
    .toLowerCase()
    .replace(/\s+/g, " ")
    .trim();
}
