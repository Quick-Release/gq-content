import {
  OPTIONAL_CATEGORIES,
  SERVICE_CATALOG,
  isServiceId,
  type OptionalCategory,
  type ServiceId,
} from "./catalog";
import type { ConsentConfiguration } from "./configuration";
import { needsBanner } from "./configuration";

/** The first-party consent cookie: necessary, and the only storage written before a decision. */
export const CONSENT_COOKIE = "gq_consent";
const MONTH_MS = 30.4375 * 24 * 60 * 60 * 1000;
/** A decision, acceptance or rejection, is valid for 6 months (CN-R5). */
export const DECISION_VALIDITY_MS = Math.round(6 * MONTH_MS);
/** The consent cookie lives at most 13 months (CN-R5): kept so a renewal keeps its consent ID. */
export const CONSENT_COOKIE_MAX_AGE_SECONDS = 395 * 24 * 60 * 60;

export type ConsentDecisions = Record<OptionalCategory, boolean>;

/** The record actions of CN-R7. */
export const CONSENT_ACTIONS = ["accept_all", "reject_all", "custom", "withdraw", "renew"] as const;
export type ConsentAction = (typeof CONSENT_ACTIONS)[number];

/** A visitor's decision as the consent cookie holds it. */
export interface ConsentState {
  /** Random (UUID v4); also the record's consent ID, quoted in data-subject requests. */
  consentId: string;
  /** When the visitor decided (ms since the epoch, the browser's clock). */
  decidedAt: number;
  decisions: ConsentDecisions;
  /** The active services when the visitor decided: a later one in a granted category is new. */
  services: ServiceId[];
  /** The controller hash when the visitor decided. */
  controller: string;
  /** The configuration version decided on. */
  version: string;
  /** The decision's record action, resent until the Worker confirms it. */
  action: ConsentAction;
  /** Whether the Worker has confirmed the decision's record. */
  recorded: boolean;
}

export type ConsentChoice =
  | { kind: "accept_all" }
  | { kind: "reject_all" }
  | { kind: "custom"; decisions: Partial<ConsentDecisions> };

const UUID = /^[0-9a-f]{8}-[0-9a-f]{4}-4[0-9a-f]{3}-[89ab][0-9a-f]{3}-[0-9a-f]{12}$/;

export function isConsentId(value: unknown): value is string {
  return typeof value === "string" && UUID.test(value);
}

export const denyAll = (): ConsentDecisions => ({
  preferences: false,
  analytics: false,
  marketing: false,
  external_media: false,
});

function base64url(text: string): string {
  const bytes = new TextEncoder().encode(text);
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function unbase64url(text: string): string {
  const binary = atob(text.replaceAll("-", "+").replaceAll("_", "/"));
  return new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0)));
}

/** The cookie value of a state: base64url JSON, short keys, no characters cookies forbid. */
export function serializeConsentState(state: ConsentState): string {
  const bits = OPTIONAL_CATEGORIES.map((category) => (state.decisions[category] ? "1" : "0"));
  return base64url(
    JSON.stringify({
      v: 1,
      i: state.consentId,
      t: state.decidedAt,
      d: bits.join(""),
      s: state.services,
      c: state.controller,
      h: state.version,
      a: state.action,
      r: state.recorded ? 1 : 0,
    }),
  );
}

/** A cookie value's state, or null for anything malformed: an unreadable cookie is no decision. */
export function parseConsentState(value: string | null | undefined): ConsentState | null {
  if (!value || value.length > 2048) return null;
  try {
    const raw = JSON.parse(unbase64url(value)) as Record<string, unknown>;
    if (raw.v !== 1 || !isConsentId(raw.i)) return null;
    if (typeof raw.t !== "number" || !Number.isFinite(raw.t) || raw.t <= 0) return null;
    if (typeof raw.d !== "string" || !/^[01]{4}$/.test(raw.d)) return null;
    if (!Array.isArray(raw.s) || typeof raw.c !== "string" || typeof raw.h !== "string")
      return null;
    if (!CONSENT_ACTIONS.includes(raw.a as ConsentAction)) return null;
    const decisions = denyAll();
    OPTIONAL_CATEGORIES.forEach((category, index) => {
      decisions[category] = raw.d![index as never] === "1";
    });
    return {
      consentId: raw.i,
      decidedAt: raw.t,
      decisions,
      services: raw.s.filter(isServiceId),
      controller: raw.c,
      version: raw.h,
      action: raw.a as ConsentAction,
      recorded: raw.r === 1,
    };
  } catch {
    return null;
  }
}

/** The consent state in a Cookie header (server side) or `document.cookie` (browser). */
export function readConsentCookie(cookieHeader: string | null | undefined): ConsentState | null {
  for (const part of (cookieHeader ?? "").split(";")) {
    const [name, ...rest] = part.trim().split("=");
    if (name === CONSENT_COOKIE) return parseConsentState(rest.join("="));
  }
  return null;
}

/** The cookie string for a state: first party, the whole Site, Lax, Secure on HTTPS. */
export function consentCookie(state: ConsentState, { secure = true } = {}): string {
  return (
    `${CONSENT_COOKIE}=${serializeConsentState(state)}; Path=/; Max-Age=${CONSENT_COOKIE_MAX_AGE_SECONDS}; SameSite=Lax` +
    (secure ? "; Secure" : "")
  );
}

/** Whether the controller changed: both known and different (an unknown one isn't a change). */
function otherController(state: ConsentState, configuration: ConsentConfiguration) {
  return (
    Boolean(state.controller && configuration.controller) &&
    state.controller !== configuration.controller
  );
}

/**
 * Why the visitor must decide now, or null: no decision (`first`), one older
 * than 6 months (`expired`), or a material change since (`material`): a new
 * category, a new service in a category they granted, or another controller.
 * A Site without optional services never prompts (CN-C1).
 */
export function promptReason(
  configuration: ConsentConfiguration,
  state: ConsentState | null,
  now: number = Date.now(),
): "first" | "expired" | "material" | null {
  if (!needsBanner(configuration)) return null;
  if (!state) return "first";
  if (now - state.decidedAt >= DECISION_VALIDITY_MS || state.decidedAt > now + 60_000)
    return "expired";
  if (otherController(state, configuration)) return "material";
  const known = new Set(state.services);
  const knownCategories = new Set<string>(state.services.map((id) => SERVICE_CATALOG[id].category));
  for (const category of configuration.categories) {
    if (!knownCategories.has(category)) return "material";
  }
  for (const id of configuration.services) {
    const category = SERVICE_CATALOG[id].category;
    if (category !== "necessary" && state.decisions[category] && !known.has(id)) return "material";
  }
  return null;
}

/**
 * Whether a service may load now: necessary ones always; others only on a
 * valid, unexpired grant of their category that already knew the service.
 * Anything else (no decision, an expired one, a newer service) is denied.
 */
export function serviceGranted(
  configuration: ConsentConfiguration,
  state: ConsentState | null,
  id: ServiceId,
  now: number = Date.now(),
): boolean {
  if (!configuration.services.includes(id)) return false;
  const category = SERVICE_CATALOG[id].category;
  if (category === "necessary") return true;
  if (!state) return false;
  if (now - state.decidedAt >= DECISION_VALIDITY_MS || state.decidedAt > now + 60_000) return false;
  if (otherController(state, configuration)) return false;
  return state.decisions[category] && state.services.includes(id);
}

/** The optional categories in force now (see serviceGranted). */
export function grantedCategories(
  configuration: ConsentConfiguration,
  state: ConsentState | null,
  now: number = Date.now(),
): OptionalCategory[] {
  return configuration.categories.filter((category) =>
    configuration.services.some(
      (id) =>
        SERVICE_CATALOG[id].category === category && serviceGranted(configuration, state, id, now),
    ),
  );
}

function randomId(): string {
  return globalThis.crypto.randomUUID();
}

/**
 * A new decision. It keeps the consent ID of an earlier one. Its action: a
 * renewal when the visitor was asked again (expired or material change), a
 * withdrawal when a category in force is no longer granted, else the button.
 * Only active categories can be granted; nothing is granted by default.
 */
export function decide(
  configuration: ConsentConfiguration,
  previous: ConsentState | null,
  choice: ConsentChoice,
  now: number = Date.now(),
): { state: ConsentState; action: ConsentAction } {
  const decisions = denyAll();
  for (const category of configuration.categories) {
    decisions[category] =
      choice.kind === "accept_all" ||
      (choice.kind === "custom" && choice.decisions[category] === true);
  }
  const inForce = grantedCategories(configuration, previous, now);
  const reason = previous ? promptReason(configuration, previous, now) : null;
  const action: ConsentAction =
    reason === "expired" || reason === "material"
      ? "renew"
      : inForce.some((category) => !decisions[category])
        ? "withdraw"
        : choice.kind;
  return {
    action,
    state: {
      consentId: previous?.consentId ?? randomId(),
      decidedAt: now,
      decisions,
      services: [...configuration.services],
      controller: configuration.controller,
      version: configuration.version,
      action,
      recorded: false,
    },
  };
}
