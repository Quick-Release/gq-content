/**
 * LEGAL-1's Legal Contract, as gq-config publishes it (fixed in the consent
 * execution record): per language, each assigned role's public URL, title and
 * revision, plus the controller's identity.
 */
export const LEGAL_ROLES = [
  "privacy_policy",
  "cookie_policy",
  "terms_of_use",
  "legal_notice",
  "terms_of_sale",
  "returns_policy",
  "shipping_policy",
  "complaints_book",
  "dispute_resolution",
] as const;

/** The roles every Site needs; commerce and Portuguese-consumer roles come from gq-config's `missingRequired`. */
export const REQUIRED_LEGAL_ROLES = ["privacy_policy", "cookie_policy"] as const;

export interface LegalRole {
  role: string;
  url: string;
  title: string | null;
  revision: string | null;
  isFallback: boolean;
}

export interface LegalController {
  name: string | null;
  privacyEmail: string | null;
  dpoContact: string | null;
}

/** One language's part of the Contract: what a content Site stores in that language's chrome. */
export interface LegalLanguage {
  controller: LegalController;
  roles: LegalRole[];
  missingRequired: string[];
}

export interface LegalContract {
  schemaVersion: 1;
  controller: LegalController;
  languages: Record<string, { roles: LegalRole[] }>;
  missingRequired: string[];
}

const text = (value: unknown) => (typeof value === "string" && value.trim() ? value : null);

function safeUrl(value: unknown): string | null {
  if (typeof value !== "string") return null;
  if (value.startsWith("/") && !value.startsWith("//")) return value;
  try {
    const url = new URL(value);
    return url.protocol === "https:" || url.protocol === "http:" ? url.href : null;
  } catch {
    return null;
  }
}

/**
 * One language's Contract from untrusted input (GraphQL or the storefront
 * payload): unknown roles, unsafe URLs and malformed entries are dropped.
 */
export function parseLegalLanguage(value: unknown): LegalLanguage | null {
  if (!value || typeof value !== "object") return null;
  const raw = value as Record<string, unknown>;
  const controller = (raw.controller ?? {}) as Record<string, unknown>;
  const roles: LegalRole[] = [];
  for (const entry of Array.isArray(raw.roles) ? raw.roles : []) {
    if (!entry || typeof entry !== "object") continue;
    const role = entry as Record<string, unknown>;
    const url = safeUrl(role.url);
    if (typeof role.role !== "string" || !(LEGAL_ROLES as readonly string[]).includes(role.role))
      continue;
    if (!url || roles.some((each) => each.role === role.role)) continue;
    roles.push({
      role: role.role,
      url,
      title: text(role.title),
      revision: text(role.revision),
      isFallback: role.isFallback === true,
    });
  }
  roles.sort((a, b) => LEGAL_ROLES.indexOf(a.role as never) - LEGAL_ROLES.indexOf(b.role as never));
  return {
    controller: {
      name: text(controller.name),
      privacyEmail: text(controller.privacyEmail),
      dpoContact: text(controller.dpoContact),
    },
    roles,
    missingRequired: (Array.isArray(raw.missingRequired) ? raw.missingRequired : []).filter(
      (role): role is string => typeof role === "string" && /^[a-z_]{1,32}$/.test(role),
    ),
  };
}

/** The LEGAL-1 revisions in force on a page, recorded with each decision (CN-R7). */
export function legalRevisions(legal: LegalLanguage | null | undefined): Record<string, string> {
  return Object.fromEntries(
    (legal?.roles ?? []).flatMap((role) =>
      role.revision ? [[role.role, role.revision.slice(0, 64)]] : [],
    ),
  );
}
