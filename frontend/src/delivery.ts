import { z } from "zod";
import {
  publicationStore,
  StoreFailure,
  type PublicationStore,
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
import { routeOf } from "./formatting";
import type { ContentConfig } from "./server";
import type { WordPressClient } from "./wordpress";
import type {
  Delivery,
  DesignPresets,
  EntryContent,
  SiteChrome,
  Translation,
} from "./content-types";
import type {
  HomePublication,
  EntryPublication,
  Alternate,
  HomeDelivery,
  EntryDelivery,
  DeliveryFailureReason,
  NotServed,
} from "./page-types";

export function configuredDelivery(
  config: ContentConfig,
  languages: SiteLanguage[],
  wordpress: WordPressClient,
) {
  const defaultLanguage = languages[0]!;
  const multilingual = languages.length > 1;
  const routeLanguage = (route: string) => languageAt(route, languages);
  const isLanguageHome = (route: string) => homeAt(route, languages);
  const { getHomeContent, getEntryByUri, getSiteChrome } = wordpress;
  type RefreshFailure = {
    reason: import("./content-types").CmsFailureReason | "partial" | "store";
    message: string;
  };
  type RecordOutcome =
    | { outcome: "promoted" | "superseded"; state: "published" | "missing" | "moved"; uri?: string }
    | { outcome: "withdrawn" }
    | { outcome: "kept"; failure: RefreshFailure };
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
  /** Entries are stored at "entry:<route>". */
  const ENTRY = "entry:";
  const entryKey = (route: string) => `${ENTRY}${route}`;
  /** The row a route is served from: its language's home, or its entry. */
  const routeKey = (route: string) =>
    isLanguageHome(route) ? homeKey(routeLanguage(route)) : entryKey(route);
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
  const homePublication = z.object({
    settings: z.object({ title: z.string(), description: z.string() }),
    page: z.object({ title: z.string(), content: z.string(), hasVideoHero: z.boolean() }),
    spacingSizes,
    colors,
  });
  const translation = z.object({ uri: z.string(), language: z.string() });
  const entryPublication = z.object({
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
  });
  const siteChrome = z.object({ menuItems: z.array(menuItem), siteIcon: image, siteLogo: image });
  const designPresets = z.object({ spacingSizes, colors });

  const parseWith = (schema: z.ZodType) => (body: unknown) => {
    const parsed = schema.safeParse(body);
    return parsed.success ? parsed.data : undefined;
  };
  const parseHome = parseWith(homePublication) as (body: unknown) => HomePublication | undefined;
  const parseChrome = parseWith(siteChrome) as (body: unknown) => SiteChrome | undefined;
  const parseEntry = parseWith(entryPublication) as (body: unknown) => EntryPublication | undefined;
  const parseDesign = parseWith(designPresets) as (body: unknown) => DesignPresets | undefined;

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
      content: entry,
      nodeId: entry.id,
      modifiedAt,
    }));
    if (outcome.outcome === "kept" || outcome.outcome === "withdrawn") return { outcome };
    const found = { nodeId: entry.id, route: canonical };
    if (canonical === route) return { outcome, found };
    if (!recordAlias) return { outcome: { ...outcome, uri: canonical }, found };
    return { outcome: await promote(route, () => moved), found };
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

  const safely = async <T>(read: () => Promise<T>, fallback: () => T): Promise<T> => {
    try {
      return await read();
    } catch {
      return fallback();
    }
  };
  return {
    publishedHome: (siteOrigin?: string, language?: SiteLanguage): Promise<HomeDelivery> =>
      safely(
        () => publishedHome(siteOrigin, language),
        () => notServed("the front page", "store", "The publication store couldn't be loaded"),
      ),
    publishedEntry: (path: string, siteOrigin?: string): Promise<EntryDelivery> =>
      safely(
        () => publishedEntry(path, siteOrigin),
        () => notServed("the entry", "store", "The publication store couldn't be loaded"),
      ),
    pageChrome: (siteOrigin?: string): Promise<SiteChrome | null> =>
      safely(
        () => pageChrome(siteOrigin),
        () => null,
      ),
  };
}
