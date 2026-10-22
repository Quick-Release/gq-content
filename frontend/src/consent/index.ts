// @getquick/content/consent: the framework-neutral consent core (CONSENT-1).
// It imports no framework, WordPress client or D1 binding, so content and
// commerce Frontends share it (ADR 0008).
export * from "./catalog";
export * from "./configuration";
export * from "./state";
export * from "./records";
export * from "./copy";
export * from "./embeds";
export { CONSENT_UI_VERSION } from "./version";
export type { LegalContract, LegalLanguage, LegalRole } from "./legal";
export { LEGAL_ROLES, REQUIRED_LEGAL_ROLES, legalRevisions, parseLegalLanguage } from "./legal";
