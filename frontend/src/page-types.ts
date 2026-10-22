import type {
  HomeContent,
  EntryContent,
  SiteChrome,
  CmsFailureReason,
  Found,
  Missing,
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
