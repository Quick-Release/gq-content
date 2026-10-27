// Framework-neutral server-rendered consent markup, driven by /consent/client.
import {
  OPTIONAL_CATEGORIES,
  SERVICE_CATALOG,
  copyLanguage,
  type ConsentService,
  type ConsentCategory,
} from "./catalog";
import type { ConsentConfiguration } from "./configuration";
import { CONSENT_COPY } from "./copy";
import { escapeHtml } from "./embeds";
import { legalRevisions, type LegalLanguage } from "./legal";
import { CONSENT_CONFIG_ID, type ConsentPageConfig } from "./client-config";
import { CONSENT_PATH } from "./paths";
import { grantedCategories, promptReason, readConsentCookie } from "./state";
import { CONSENT_UI_VERSION } from "./version";

export interface ConsentPageInput {
  configuration: ConsentConfiguration;
  /** The page's `lang` (BCP 47): the UI follows it (CN-C3). */
  language: string;
  /** The page language's Legal Contract, from the chrome (LEGAL-1); null when not delivered yet. */
  legal?: LegalLanguage | null;
  /** The request's Cookie header: the banner is rendered open only without a decision in force. */
  cookie?: string | null;
  now?: number;
  /** Include the default stylesheet (Sites restyle through its custom properties). */
  styles?: boolean;
}

export interface ConsentPage {
  /** For `<head>`: the configuration the client reads, and the default styles. */
  head: string;
  /** For the start of `<body>`: the banner (first in focus order) and the preferences dialog. */
  body: string;
  /** For the footer: the legal links and the persistent "Cookie settings" control. */
  footer: string;
  /** Whether the banner is rendered open. */
  bannerOpen: boolean;
}

function storageText(service: ConsentService, language: "en" | "pt-PT") {
  const copy = CONSENT_COPY[language];
  return service.storage
    .map(
      (item) =>
        `${item.name}${item.match === "prefix" ? "*" : ""} (${item.kind}, ${item.duration[language]}${item.party === "third" ? `; ${copy.thirdPartyStorage}` : ""})`,
    )
    .join("; ");
}

function serviceList(services: ConsentService[], language: "en" | "pt-PT") {
  if (!services.length) return "";
  const copy = CONSENT_COPY[language];
  const rows = services.map((service) => {
    const storage = storageText(service, language);
    return (
      `<li class="gq-consent-service"><strong>${escapeHtml(service.name)}</strong>` +
      `<dl><dt>${escapeHtml(copy.provider)}</dt><dd>${escapeHtml(service.provider)}</dd>` +
      `<dt>${escapeHtml(copy.purpose)}</dt><dd>${escapeHtml(service.purpose[language])}</dd>` +
      `<dt>${escapeHtml(copy.storage)}</dt><dd>${escapeHtml(storage || "—")}</dd>` +
      `<dt>${escapeHtml(copy.retention)}</dt><dd>${escapeHtml(service.retention[language])}</dd></dl></li>`
    );
  });
  return `<ul class="gq-consent-services">${rows.join("")}</ul>`;
}

function link(href: string, text: string, attributes = "") {
  return `<a href="${escapeHtml(href)}"${attributes}>${escapeHtml(text)}</a>`;
}

/** The legal links and "Cookie settings" control for a footer (LG-R5, CN-R6). */
export function legalFooter(legal: LegalLanguage | null | undefined, language: string): string {
  const lang = copyLanguage(language);
  const copy = CONSENT_COPY[lang];
  const items = (legal?.roles ?? []).map(
    (role) =>
      `<li>${link(role.url, role.title ?? copy.legal[role.role] ?? role.role, ` data-gq-legal-role="${escapeHtml(role.role)}"`)}</li>`,
  );
  items.push(
    `<li><button type="button" class="gq-consent-settings" data-gq-consent-open aria-haspopup="dialog" aria-controls="gq-consent-preferences">${escapeHtml(copy.cookieSettings)}</button></li>`,
  );
  return `<nav class="gq-legal" aria-label="${escapeHtml(copy.legalNavigation)}"><ul>${items.join("")}</ul></nav>`;
}

/** Everything the default UI renders on one page. */
export function consentPage(input: ConsentPageInput): ConsentPage {
  const { configuration } = input;
  const lang = copyLanguage(input.language);
  const copy = CONSENT_COPY[lang];
  const state = readConsentCookie(input.cookie);
  const now = input.now ?? Date.now();
  const bannerOpen = promptReason(configuration, state, now) !== null;
  const inForce = grantedCategories(configuration, state, now);
  const cookiePolicy = input.legal?.roles.find((role) => role.role === "cookie_policy");

  const config: ConsentPageConfig = {
    configuration,
    language: input.language,
    uiVersion: CONSENT_UI_VERSION,
    legalRevisions: legalRevisions(input.legal),
    endpoint: CONSENT_PATH,
  };
  // JSON in a script element: "<" is escaped so no content can end it.
  const head =
    `<script type="application/json" id="${CONSENT_CONFIG_ID}">${JSON.stringify(config).replaceAll("<", "\\u003c")}</script>` +
    (input.styles === false ? "" : `<style data-gq-consent-styles>${CONSENT_STYLES}</style>`);

  const services = configuration.services.map((id) => SERVICE_CATALOG[id] as ConsentService);
  const inCategory = (category: ConsentCategory) =>
    services.filter((service) => service.category === category);

  const optional = configuration.categories.length > 0;
  // Rendered whenever there is something to decide (CN-C1); the client shows
  // or hides it as decisions change. Open, it is first in focus order.
  const banner = !optional
    ? ""
    : `<section id="gq-consent-banner" class="gq-consent-banner" role="dialog" aria-modal="false" aria-labelledby="gq-consent-banner-title" aria-describedby="gq-consent-banner-text" lang="${escapeHtml(input.language)}"${bannerOpen ? "" : " hidden"}>` +
      `<h2 id="gq-consent-banner-title" class="gq-consent-banner__title">${escapeHtml(copy.bannerTitle)}</h2>` +
      `<p id="gq-consent-banner-text" class="gq-consent-banner__text">${escapeHtml(copy.bannerText)}` +
      (cookiePolicy
        ? ` ${link(cookiePolicy.url, copy.cookiePolicy, ' class="gq-consent-banner__policy"')}`
        : "") +
      `</p><div class="gq-consent-banner__actions">` +
      `<button type="button" class="gq-consent-button gq-consent-button--choice" data-gq-consent-reject-all>${escapeHtml(copy.rejectAll)}</button>` +
      `<button type="button" class="gq-consent-button gq-consent-button--choice" data-gq-consent-accept-all>${escapeHtml(copy.acceptAll)}</button>` +
      `<button type="button" class="gq-consent-button gq-consent-button--secondary" data-gq-consent-customise aria-haspopup="dialog" aria-controls="gq-consent-preferences">${escapeHtml(copy.customise)}</button>` +
      `</div></section>`;

  const necessary = copy.categories.necessary;
  const categories = OPTIONAL_CATEGORIES.filter((category) =>
    configuration.categories.includes(category),
  ).map((category) => {
    const text = copy.categories[category];
    const id = `gq-consent-category-${category}`;
    return (
      `<fieldset class="gq-consent-category"><legend>${escapeHtml(text.name)}</legend>` +
      `<label for="${id}"><input type="checkbox" id="${id}" name="${category}" value="${category}" data-gq-consent-category${inForce.includes(category) ? " checked" : ""}> ${escapeHtml(text.name)}</label>` +
      `<p>${escapeHtml(text.description)}</p>${serviceList(inCategory(category), lang)}</fieldset>`
    );
  });
  const preferences =
    `<dialog id="gq-consent-preferences" class="gq-consent-preferences" aria-labelledby="gq-consent-preferences-title" lang="${escapeHtml(input.language)}">` +
    `<form method="dialog"><h2 id="gq-consent-preferences-title">${escapeHtml(copy.preferencesTitle)}</h2>` +
    `<p>${escapeHtml(copy.preferencesText)}</p>` +
    (cookiePolicy ? `<p>${link(cookiePolicy.url, copy.cookiePolicy)}</p>` : "") +
    `<fieldset class="gq-consent-category"><legend>${escapeHtml(necessary.name)}</legend>` +
    `<p>${escapeHtml(copy.alwaysOn)}. ${escapeHtml(necessary.description)}</p>${serviceList(inCategory("necessary"), lang)}</fieldset>` +
    categories.join("") +
    (optional
      ? `<p class="gq-consent-id">${escapeHtml(copy.consentId)}: <code data-gq-consent-id data-gq-consent-none="${escapeHtml(copy.noDecision)}">${escapeHtml(state?.consentId ?? copy.noDecision)}</code></p>`
      : "") +
    `<div class="gq-consent-preferences__actions">` +
    (optional
      ? `<button type="button" class="gq-consent-button gq-consent-button--choice" data-gq-consent-reject-all>${escapeHtml(copy.rejectAll)}</button>` +
        `<button type="button" class="gq-consent-button gq-consent-button--choice" data-gq-consent-accept-all>${escapeHtml(copy.acceptAll)}</button>` +
        `<button type="button" class="gq-consent-button gq-consent-button--secondary" data-gq-consent-save>${escapeHtml(copy.save)}</button>`
      : "") +
    `<button type="button" class="gq-consent-button gq-consent-button--secondary" data-gq-consent-close>${escapeHtml(copy.close)}</button>` +
    `</div></form></dialog>`;

  return {
    head,
    body: banner + preferences,
    footer: legalFooter(input.legal, input.language),
    bannerOpen,
  };
}

/**
 * The default stylesheet. Sites restyle it through these custom properties or
 * their own CSS (CN-C4); the two first-layer choices share one class so they
 * keep equal prominence.
 */
export const CONSENT_STYLES = `
.gq-consent-banner{position:fixed;inset:auto 1rem 1rem 1rem;z-index:2147483000;max-width:44rem;margin:0 auto;padding:1.25rem;background:var(--gq-consent-background,#fff);color:var(--gq-consent-color,#111);border:1px solid var(--gq-consent-border,#888);border-radius:var(--gq-consent-radius,.5rem);box-shadow:0 .5rem 2rem rgba(0,0,0,.2);font:inherit}
.gq-consent-banner[hidden]{display:none}
.gq-consent-banner__title,.gq-consent-preferences h2{margin:0 0 .5rem;font-size:1.125rem}
.gq-consent-banner__actions,.gq-consent-preferences__actions,.gq-consent-embed__actions{display:flex;flex-wrap:wrap;gap:.5rem;margin-top:1rem}
.gq-consent-button{font:inherit;cursor:pointer;padding:.6rem 1rem;border-radius:var(--gq-consent-radius,.5rem);border:2px solid var(--gq-consent-accent,#111)}
.gq-consent-button--choice{flex:1 1 10rem;background:var(--gq-consent-accent,#111);color:var(--gq-consent-accent-contrast,#fff)}
.gq-consent-button--secondary{background:transparent;color:inherit}
.gq-consent-button:focus-visible,.gq-consent-settings:focus-visible{outline:3px solid var(--gq-consent-focus,#1a73e8);outline-offset:2px}
.gq-consent-preferences{max-width:40rem;width:calc(100% - 2rem);max-height:calc(100vh - 2rem);overflow:auto;padding:1.25rem;border:1px solid var(--gq-consent-border,#888);border-radius:var(--gq-consent-radius,.5rem);background:var(--gq-consent-background,#fff);color:var(--gq-consent-color,#111)}
.gq-consent-category{border:1px solid var(--gq-consent-border,#ccc);border-radius:.375rem;margin:.75rem 0;padding:.75rem}
.gq-consent-services{margin:.5rem 0 0;padding-left:1rem;font-size:.875rem}
.gq-consent-services dl{display:grid;grid-template-columns:max-content 1fr;gap:.125rem .5rem;margin:.25rem 0}
.gq-consent-services dd{margin:0}
.gq-consent-embed{position:relative;display:flex;align-items:center;justify-content:center;width:100%;min-height:12rem;background:var(--gq-consent-embed-background,#eee);color:var(--gq-consent-color,#111)}
.gq-consent-embed[data-gq-loaded]{display:block;min-height:0;background:none}
.gq-consent-embed[data-gq-loaded]>iframe{width:100%;height:100%;border:0}
.gq-consent-embed--decorative{position:absolute;inset:0;min-height:0;background:none}
.gq-consent-embed__notice{max-width:32rem;padding:1rem;text-align:center}
.gq-consent-blocked{padding:1rem;background:var(--gq-consent-embed-background,#eee)}
.gq-legal ul{display:flex;flex-wrap:wrap;gap:.5rem 1rem;list-style:none;margin:0;padding:0}
.gq-consent-settings{font:inherit;color:inherit;background:none;border:0;padding:0;text-decoration:underline;cursor:pointer}
`.trim();
