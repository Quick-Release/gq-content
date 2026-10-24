import type { DesignTheme } from "./presentation";
import type { LegalLanguage } from "./consent/legal";
import type { AnalyticsSettings } from "./consent/configuration";

import type { DesignBlock, DesignPattern } from "./design-patterns";
export interface WordPressImage {
  sourceUrl: string;
  altText: string;
}

export interface WordPressPost {
  databaseId?: number;
  designBlocks?: DesignBlock[];
  id: string;
  title: string;
  excerpt: string;
  content: string;
  uri: string;
  date: string;
  featuredImage: WordPressImage | null;
  hasVideoHero: boolean;
}

export interface WordPressMenuItem {
  id: string;
  label: string;
  href: string;
  target: string | null;
  children: WordPressMenuItem[];
}

export interface WordPressSettings {
  title: string;
  description: string;
}

export interface DesignPresets {
  /** Resolved CMS theme; absent in publications written before theme delivery. */
  theme?: DesignTheme;
  spacingSizes: Array<{ slug: string; size: string }>;
  colors: Array<{ slug: string; color: string }>;
}

/**
 * A page or post's own content as the Site's extension read it
 * (ContentConfig's `extension`): present only when the Site declares one and
 * its read returned a value for that page or post.
 */
export interface Extended<X = unknown> {
  extension?: X;
}

export interface HomeContent<X = unknown> extends DesignPresets {
  /** The front page's WordPress entry (WPGraphQL's global id), if WordPress gave it. */
  nodeId: string | null;
  settings: WordPressSettings;
  page: {
    title: string;
    content: string;
    hasVideoHero: boolean;
    databaseId?: number;
    designBlocks?: DesignBlock[];
  } & Extended<X>;
  /** WordPress failed on the blocks, so this is the page without them. */
  blocksOmitted: boolean;
}

/** A term of one of a collection's taxonomies, as an item carries it. */
export interface CollectionTerm {
  slug: string;
  name: string;
}

/**
 * The collection an entry is an item of (ContentConfig's `collections`): its
 * name, and its terms in each of the collection's taxonomies.
 */
export interface CollectionMembership {
  name: string;
  terms: Record<string, CollectionTerm[]>;
}

/** A published translation of an entry: its URI and its language's slug. */
export interface Translation {
  uri: string;
  language: string;
}

export interface EntryContent<X = unknown> extends WordPressPost, DesignPresets, Extended<X> {
  /** Its language's slug, on a multilingual Site. */
  language?: string;
  /** Its published translations into the site's other languages, on a multilingual Site. */
  translations?: Translation[];
  /** WordPress failed on the blocks, so this is the entry without them. */
  blocksOmitted: boolean;
  /** When WordPress last modified it (ms, the CMS's clock), if it said. */
  modifiedAt: number | null;
  /** The collection it is an item of, when it is one (not a page or post). */
  collection?: CollectionMembership;
}

/** A published page or post as WordPress lists it: its id, URI and last modification. */
export interface PublishedEntry {
  /** WPGraphQL's global id, when WordPress gives it. */
  id: string | null;
  uri: string;
  /** When WordPress last modified it (ms, the CMS's clock), if it said. */
  modifiedAt: number | null;
}

/** Where each collection's archive is (a path), by its post type. */
export type Archives = Record<string, string>;

export interface SiteChrome {
  menuItems: WordPressMenuItem[];
  siteIcon: WordPressImage | null;
  siteLogo: WordPressImage | null;
  /**
   * The patterns GQ Design's Header & Footer selects for the Site's header and
   * footer (render them with `renderDesignPattern`). Null when the region uses
   * an ordinary template part, or nothing published is selected: the Site
   * keeps its own header or footer then.
   */
  header: DesignPattern | null;
  footer: DesignPattern | null;
  /**
   * This language's LEGAL-1 Contract from gq-config, on a Site with consent
   * CMS settings enabled (null when gq-config has none for it).
   */
  legal?: LegalLanguage | null;
  /** gq-config's GA4 settings, on a Site with consent CMS settings enabled. */
  analytics?: AnalyticsSettings;
}

/**
 * Why WordPress couldn't deliver: it didn't answer in time (`timeout`), couldn't
 * be reached (`network`), answered with an HTTP error (`http`) or GraphQL errors
 * (`graphql`), or answered with data missing the fields the Frontend requires
 * (`schema`).
 */
export type CmsFailureReason = "timeout" | "network" | "http" | "graphql" | "schema";

export interface CmsFailure {
  reason: CmsFailureReason;
  message: string;
  httpStatus?: number;
}

export interface Found<T> {
  kind: "found";
  content: T;
}

/** WordPress answered with valid data, and has nothing published there. */
export interface Missing {
  kind: "missing";
}

/** The content couldn't be read. This says nothing about whether it exists. */
export interface Unavailable {
  kind: "unavailable";
  failure: CmsFailure;
}

export type Delivery<T> = Found<T> | Missing | Unavailable;
