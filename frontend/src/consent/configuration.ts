import {
  OPTIONAL_CATEGORIES,
  SERVICE_CATALOG,
  isServiceId,
  type OptionalCategory,
  type ServiceId,
} from "./catalog";
import { sha256Hex } from "./hash";

/**
 * The revision of the Runtime's banner copy that counts as material. Copy edits
 * keep it (CN-R5); only a reviewed change of what the visitor is told about
 * processing bumps it.
 */
export const CONSENT_COPY_REVISION = 1;

/** gq-config's GA4 settings: the toggle and the measurement ID (GraphQL `googleAnalytics`). */
export interface AnalyticsSettings {
  enabled: boolean;
  measurementId: string | null;
}

/** A GA4 measurement ID. Anything else leaves GA4 inactive. */
export const MEASUREMENT_ID = /^G-[A-Z0-9]{4,16}$/;

export interface ConsentConfigurationInput {
  /** The catalog services the Site declares in code. */
  services?: readonly string[];
  /** gq-config's analytics settings: GA4 is active only when its toggle is on (ticket 08). */
  analytics?: AnalyticsSettings | null;
  /** The data controller's legal name (LEGAL-1); changing it is material. */
  controller?: string | null;
}

export interface ConsentConfiguration {
  schemaVersion: 1;
  /** Every active service, necessary ones included, sorted. */
  services: ServiceId[];
  /** The optional categories at least one active service is in, in category order. */
  categories: OptionalCategory[];
  /** GA4's measurement ID, when GA4 is active. */
  measurementId: string | null;
  /** A short hash of the controller's name, empty when unknown; a change between known ones is material. */
  controller: string;
  /** The consent configuration version: categories, services, controller and copy revision. */
  version: string;
}

/**
 * A Site's consent configuration: the union of services it declares in code and
 * those its settings switch on. Unknown services are refused: the set is closed.
 */
export function consentConfiguration(input: ConsentConfigurationInput = {}): ConsentConfiguration {
  const active = new Set<ServiceId>(["consent"]);
  for (const id of input.services ?? []) {
    if (!isServiceId(id)) throw new Error(`"${id}" isn't a consent catalog service`);
    if (id === "ga4") throw new Error("GA4 is switched on by gq-config's analytics settings");
    active.add(id);
  }
  const measurementId =
    input.analytics?.enabled && MEASUREMENT_ID.test(input.analytics.measurementId ?? "")
      ? input.analytics.measurementId!
      : null;
  if (measurementId) active.add("ga4");
  const services = [...active].sort();
  const categories = OPTIONAL_CATEGORIES.filter((category) =>
    services.some((id) => SERVICE_CATALOG[id].category === category),
  );
  // Empty while the Legal Contract hasn't named one: an unknown controller is
  // no change of controller.
  const name = input.controller?.trim() ?? "";
  const controller = name ? sha256Hex(`controller:${name}`).slice(0, 12) : "";
  const version = sha256Hex(
    JSON.stringify({ categories, services, controller, copy: CONSENT_COPY_REVISION }),
  ).slice(0, 16);
  return { schemaVersion: 1, services, categories, measurementId, controller, version };
}

/** CN-C1: a Site with no active service outside `necessary` shows no banner and records nothing. */
export function needsBanner(configuration: ConsentConfiguration): boolean {
  return configuration.categories.length > 0;
}
