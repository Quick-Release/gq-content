import { OPTIONAL_CATEGORIES } from "./catalog";
import {
  CONSENT_ACTIONS,
  isConsentId,
  type ConsentAction,
  type ConsentDecisions,
  type ConsentState,
} from "./state";

/**
 * A stored consent record (CN-R7), as the read endpoint returns it. No IP
 * address, user agent or account link exists in it.
 */
export interface ConsentRecord {
  consentId: string;
  siteId: string;
  /** Server UTC timestamp (ISO 8601). */
  recordedAt: string;
  configVersion: string;
  /** LEGAL-1 page revisions in force: role → revision. */
  legalRevisions: Record<string, string>;
  decisions: ConsentDecisions;
  action: ConsentAction;
  /** The banner language (BCP 47). */
  language: string;
  uiVersion: string;
}

/**
 * What the browser posts to `POST /gq/consent`. The server adds the Site ID and
 * its own timestamp. `decidedAt` identifies the decision, so a retried post
 * appends nothing twice.
 */
export interface ConsentRecordRequest {
  consentId: string;
  decidedAt: string;
  configVersion: string;
  legalRevisions: Record<string, string>;
  decisions: ConsentDecisions;
  action: ConsentAction;
  language: string;
  uiVersion: string;
}

/** The largest record body the endpoint accepts (CN-R9). */
export const MAX_RECORD_BYTES = 2048;

export function consentRecordRequest(
  state: ConsentState,
  action: ConsentAction,
  context: { language: string; uiVersion: string; legalRevisions?: Record<string, string> },
): ConsentRecordRequest {
  return {
    consentId: state.consentId,
    decidedAt: new Date(state.decidedAt).toISOString(),
    configVersion: state.version,
    legalRevisions: context.legalRevisions ?? {},
    decisions: { ...state.decisions },
    action,
    language: context.language,
    uiVersion: context.uiVersion,
  };
}

const KEYS = [
  "consentId",
  "decidedAt",
  "configVersion",
  "legalRevisions",
  "decisions",
  "action",
  "language",
  "uiVersion",
];
const TOKEN = /^[A-Za-z0-9._:@/+-]{1,64}$/;
const LANGUAGE = /^[A-Za-z]{2,3}(?:-[A-Za-z0-9]{2,8}){0,2}$/;
const ISO = /^\d{4}-\d{2}-\d{2}T\d{2}:\d{2}:\d{2}(?:\.\d{1,3})?Z$/;

/** A strict parse of a record request: exactly its fields, each bounded. */
export function parseConsentRecordRequest(
  value: unknown,
): { ok: true; request: ConsentRecordRequest } | { ok: false; error: string } {
  const fail = (error: string) => ({ ok: false as const, error });
  if (!value || typeof value !== "object" || Array.isArray(value)) return fail("not an object");
  const body = value as Record<string, unknown>;
  const extra = Object.keys(body).filter((key) => !KEYS.includes(key));
  if (extra.length) return fail(`unexpected fields: ${extra.join(", ")}`);
  if (!isConsentId(body.consentId)) return fail("consentId must be a UUID v4");
  if (typeof body.decidedAt !== "string" || !ISO.test(body.decidedAt))
    return fail("decidedAt must be an ISO 8601 UTC time");
  if (typeof body.configVersion !== "string" || !/^[0-9a-f]{8,64}$/.test(body.configVersion))
    return fail("configVersion must be a hex hash");
  if (typeof body.action !== "string" || !CONSENT_ACTIONS.includes(body.action as ConsentAction))
    return fail("action is not a consent action");
  if (typeof body.language !== "string" || !LANGUAGE.test(body.language))
    return fail("language must be a BCP 47 tag");
  if (typeof body.uiVersion !== "string" || !TOKEN.test(body.uiVersion))
    return fail("uiVersion must be a short token");
  const decisions = body.decisions as Record<string, unknown> | null;
  if (!decisions || typeof decisions !== "object" || Array.isArray(decisions))
    return fail("decisions must be an object");
  const decisionKeys = Object.keys(decisions);
  if (
    decisionKeys.length !== OPTIONAL_CATEGORIES.length ||
    !OPTIONAL_CATEGORIES.every((category) => typeof decisions[category] === "boolean")
  )
    return fail("decisions must have exactly the four optional categories, as booleans");
  const revisions = body.legalRevisions as Record<string, unknown> | null;
  if (!revisions || typeof revisions !== "object" || Array.isArray(revisions))
    return fail("legalRevisions must be an object");
  const roles = Object.entries(revisions);
  if (roles.length > 16) return fail("too many legal revisions");
  for (const [role, revision] of roles) {
    if (!/^[a-z_]{1,32}$/.test(role) || typeof revision !== "string" || !TOKEN.test(revision))
      return fail("legalRevisions must map roles to short revision tokens");
  }
  return {
    ok: true,
    request: {
      consentId: body.consentId,
      decidedAt: body.decidedAt,
      configVersion: body.configVersion,
      legalRevisions: Object.fromEntries(roles) as Record<string, string>,
      decisions: Object.fromEntries(
        OPTIONAL_CATEGORIES.map((category) => [category, decisions[category] as boolean]),
      ) as ConsentDecisions,
      action: body.action as ConsentAction,
      language: body.language,
      uiVersion: body.uiVersion,
    },
  };
}
