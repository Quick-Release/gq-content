import type {
  HomeContent,
  EntryContent,
  SiteChrome,
  CmsFailureReason,
  CollectionTerm,
  Found,
  Missing,
  WordPressImage,
} from "./content-types";
import type { SiteLanguage } from "./site-language";
/** The front page as stored: what WordPress delivered, without read details. */
export type HomePublication<X = unknown> = Omit<HomeContent<X>, "blocksOmitted" | "nodeId">;

/** A published page or post as stored, with the design presets it was read with. */
export type EntryPublication<X = unknown> = Omit<EntryContent<X>, "blocksOmitted" | "modifiedAt">;

/**
 * A page in another language that a visitor of this one may switch to: its
 * published translation (`translation`), or else that language's home.
 */
export interface Alternate {
  language: SiteLanguage;
  route: string;
  translation: boolean;
}

export interface HomePage<X = unknown> {
  home: HomePublication<X>;
  chrome: SiteChrome;
  /** The other languages' homes that are served; none on a monolingual Site. */
  alternates: Alternate[];
}

export interface EntryPage<X = unknown> {
  entry: EntryPublication<X>;
  chrome: SiteChrome;
  /** Where its readers may switch language; none on a monolingual Site. */
  alternates: Alternate[];
}

/** The entry a route served is published at another URI now: the route redirects there. */
export interface Moved {
  kind: "moved";
  uri: string;
}

/**
 * Why there is nothing to serve: the CMS failed (live reads, in explicit development),
 * the store couldn't be read (`store`), or the Site has never been refreshed,
 * or holds only state this Frontend can't read (`not-ready`).
 */
export type DeliveryFailureReason = CmsFailureReason | "store" | "not-ready";

export interface NotServed {
  kind: "unavailable";
  failure: { reason: DeliveryFailureReason; message: string };
}

export type HomeDelivery<X = unknown> =
  | Found<HomePage<X>>
  | (Missing & { chrome: SiteChrome | null })
  | NotServed;

export type EntryDelivery<X = unknown> =
  | Found<EntryPage<X>>
  | (Missing & { chrome: SiteChrome | null })
  | Moved
  | NotServed;

/** Which of a collection's items to list, from the publication store. */
export interface CollectionQuery {
  /** The collection's name, as ContentConfig's `collections` declares it. */
  collection: string;
  /**
   * Only items with one of these terms (slugs) in each of these taxonomies:
   * any slug of a taxonomy, and every taxonomy given.
   */
  terms?: Record<string, readonly string[]>;
  /** Only items whose title or excerpt contains this text (ignoring case and accents). */
  search?: string;
  /** The page of items, from 1 (the default). */
  page?: number;
  /** Items per page, 1 to 100; 12 by default. */
  perPage?: number;
  /** A multilingual Site's language (its slug); the default language's by default. */
  language?: string;
}

/** An item as a collection lists it. */
export interface CollectionItem<X = unknown> {
  uri: string;
  title: string;
  /** When it was published, as WordPress gives it (its date, without a zone). */
  date: string;
  /** When WordPress last modified it (ms, the CMS's clock), if it said. */
  modifiedAt: number | null;
  excerpt: string;
  featuredImage: WordPressImage | null;
  /** Its terms in each of the collection's taxonomies. */
  terms: Record<string, CollectionTerm[]>;
  /** The Site's own content on it (ContentConfig's `extension`), when it has one. */
  extension?: X;
  /** Its language's slug, on a multilingual Site. */
  language?: string;
}

/** A page of a collection's items, newest first, and how many there are in all. */
export interface CollectionPage<X = unknown> {
  items: CollectionItem<X>[];
  /** Items matching the query, on every page. */
  total: number;
  page: number;
  /** Pages of items matching the query (0 when none does). */
  pages: number;
}

export type CollectionListing<X = unknown> = ({ kind: "found" } & CollectionPage<X>) | NotServed;

/** A term of a collection's taxonomy, and how many of its stored items have it. */
export interface CollectionTermCount extends CollectionTerm {
  count: number;
}

export type CollectionTermListing = { kind: "found"; terms: CollectionTermCount[] } | NotServed;
