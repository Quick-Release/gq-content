// @getquick/content/consent/client: the browser runtime behind the default UI
// (and any replacement implementing the same markup Contract, CN-C4). It
// reads the configuration the server rendered, applies decisions immediately,
// records them through the same-origin endpoint, and loads catalog services
// only after their grant. Framework-neutral: plain DOM.
import {
  OPTIONAL_CATEGORIES,
  SERVICE_CATALOG,
  embedService,
  isServiceId,
  type ConsentService,
  type OptionalCategory,
  type ServiceId,
} from "./catalog";
import { consentRecordRequest, isLegalRoleName, isRecordToken } from "./records";
import { CONSENT_CONFIG_ID, type ConsentPageConfig } from "./client-config";
import {
  consentCookie,
  decide,
  grantedCategories,
  promptReason,
  readConsentCookie,
  serviceGranted,
  type ConsentAction,
  type ConsentChoice,
  type ConsentState,
} from "./state";

export interface ConsentController {
  readonly state: ConsentState | null;
  readonly config: ConsentPageConfig;
  choose(choice: ConsentChoice): void;
  openPreferences(opener?: HTMLElement | null): void;
  /** Re-applies grants to the current document (after a client-side navigation). */
  refresh(): void;
}

declare global {
  interface Window {
    dataLayer?: unknown[];
    gtag?: (...args: unknown[]) => void;
    __gqConsent?: ConsentController;
  }
}

const RETRY_DELAYS_MS = [1_000, 3_000, 10_000, 30_000, 60_000];

function readConfig(): ConsentPageConfig | null {
  const element = document.getElementById(CONSENT_CONFIG_ID);
  if (!element?.textContent) return null;
  try {
    const config = JSON.parse(element.textContent) as ConsentPageConfig;
    config.legalRevisions = Object.fromEntries(
      Object.entries(config.legalRevisions ?? {}).filter(
        ([role, revision]) => isLegalRoleName(role) && isRecordToken(revision),
      ),
    );
    return config;
  } catch {
    return null;
  }
}

/** Removes the first-party storage a withdrawn category's services wrote (CN-R6). */
function removeStorage(categories: OptionalCategory[]) {
  const services = Object.values(SERVICE_CATALOG) as ConsentService[];
  const host = location.hostname;
  const domains = ["", host, `.${host}`];
  const parts = host.split(".");
  for (let i = 1; i < parts.length - 1; i++) domains.push(`.${parts.slice(i).join(".")}`);
  for (const service of services) {
    if (!(categories as string[]).includes(service.category)) continue;
    for (const storage of service.storage) {
      if (storage.party !== "first") continue;
      const matches = (name: string) =>
        storage.match === "prefix" ? name.startsWith(storage.name) : name === storage.name;
      if (storage.kind === "cookie") {
        for (const cookie of document.cookie.split(";")) {
          const name = cookie.split("=")[0]!.trim();
          if (!name || !matches(name)) continue;
          for (const domain of domains) {
            document.cookie = `${name}=; Path=/; Max-Age=0${domain ? `; Domain=${domain}` : ""}`;
          }
        }
      } else {
        const area = storage.kind === "localStorage" ? localStorage : sessionStorage;
        for (const key of Object.keys(area)) if (matches(key)) area.removeItem(key);
      }
    }
  }
}

/**
 * GA4 under Consent Mode v2 basic mode (CN-R12): nothing loads before the
 * analytics grant; the denied defaults are queued before the tag; every later
 * decision sends an update. Withdrawal sends denied and disables the tag.
 */
function ga4(measurementId: string) {
  let loaded = false;
  // Google's snippet: gtag.js reads each call's Arguments object.
  function gtag(..._args: unknown[]) {
    window.dataLayer = window.dataLayer ?? [];
    // oxlint-disable-next-line prefer-rest-params
    window.dataLayer.push(arguments);
  }
  const signals = (analytics: boolean) => ({
    analytics_storage: analytics ? "granted" : "denied",
    // No catalog marketing service uses Google's ad signals: always denied.
    ad_storage: "denied",
    ad_user_data: "denied",
    ad_personalization: "denied",
  });
  return function apply(granted: boolean) {
    if (!loaded && !granted) return;
    (window as unknown as Record<string, unknown>)[`ga-disable-${measurementId}`] = !granted;
    if (loaded) {
      gtag("consent", "update", signals(granted));
      return;
    }
    loaded = true;
    window.gtag = gtag;
    gtag("consent", "default", signals(false));
    gtag("consent", "update", signals(true));
    gtag("js", new Date());
    gtag("config", measurementId);
    const script = document.createElement("script");
    script.async = true;
    script.src = `https://www.googletagmanager.com/gtag/js?id=${encodeURIComponent(measurementId)}`;
    document.head.append(script);
  };
}

// The iframe attributes a placeholder may restore; never event handlers or srcdoc.
const EMBED_ATTRIBUTES = new Set([
  "allow",
  "allowfullscreen",
  "aria-hidden",
  "class",
  "frameborder",
  "height",
  "loading",
  "referrerpolicy",
  "tabindex",
  "title",
  "width",
]);

/**
 * Replaces a placeholder's content with its embed, keeping the placeholder to
 * restore. Only an HTTPS URL of the catalog service the placeholder names
 * loads, so markup can't smuggle another host or a script URL through it.
 */
function loadEmbed(placeholder: HTMLElement, id: ServiceId): void {
  const data = placeholder.getAttribute("data-gq-embed");
  if (!data || placeholder.hasAttribute("data-gq-loaded")) return;
  let embed: { tag?: unknown; attrs?: Record<string, unknown> };
  try {
    embed = JSON.parse(data) as typeof embed;
  } catch {
    return;
  }
  if (embed.tag !== "iframe" || !embed.attrs || typeof embed.attrs.src !== "string") return;
  let src: URL;
  try {
    src = new URL(embed.attrs.src);
  } catch {
    return;
  }
  if (src.protocol !== "https:" || embedService(src) !== id) return;
  const iframe = document.createElement("iframe");
  for (const [name, value] of Object.entries(embed.attrs)) {
    if (EMBED_ATTRIBUTES.has(name.toLowerCase()) && typeof value === "string")
      iframe.setAttribute(name, value);
  }
  iframe.src = src.href;
  const original = placeholder.cloneNode(true) as HTMLElement;
  placeholder.replaceChildren(iframe);
  placeholder.setAttribute("data-gq-loaded", "");
  placeholder.removeAttribute("role");
  placeholder.removeAttribute("aria-label");
  originals.set(placeholder, original);
}
const originals = new WeakMap<HTMLElement, HTMLElement>();

function unloadEmbed(placeholder: HTMLElement) {
  const original = originals.get(placeholder);
  if (!original) return;
  placeholder.replaceWith(original);
}

/**
 * Starts the runtime once per document. Safe to call again: the existing
 * controller refreshes the page instead.
 */
export function startConsent(): ConsentController | null {
  if (window.__gqConsent) {
    window.__gqConsent.refresh();
    return window.__gqConsent;
  }
  const initial = readConfig();
  if (!initial) return null;
  let config: ConsentPageConfig = initial;
  let state = readConsentCookie(document.cookie);
  const analytics = config.configuration.measurementId
    ? ga4(config.configuration.measurementId)
    : null;
  let retry: ReturnType<typeof setTimeout> | undefined;
  let opener: HTMLElement | null = null;

  const secure = location.protocol === "https:";
  const writeCookie = (next: ConsentState) => {
    document.cookie = consentCookie(next, { secure });
  };
  const granted = (id: ServiceId) => serviceGranted(config.configuration, state, id);

  function applyEmbeds() {
    for (const placeholder of document.querySelectorAll<HTMLElement>("[data-gq-consent-embed]")) {
      const id = placeholder.getAttribute("data-gq-consent-embed");
      if (!isServiceId(id)) continue;
      if (granted(id)) loadEmbed(placeholder, id);
      else if (
        placeholder.hasAttribute("data-gq-loaded") &&
        !placeholder.hasAttribute("data-gq-once")
      )
        unloadEmbed(placeholder);
    }
  }

  function applyUi() {
    const reason = promptReason(config.configuration, state);
    const banner = document.getElementById("gq-consent-banner");
    if (banner) banner.hidden = reason === null;
    for (const element of document.querySelectorAll<HTMLElement>("[data-gq-consent-id]")) {
      element.textContent = state?.consentId ?? element.getAttribute("data-gq-consent-none") ?? "";
    }
    const inForce = grantedCategories(config.configuration, state);
    for (const input of document.querySelectorAll<HTMLInputElement>(
      "input[data-gq-consent-category]",
    )) {
      input.checked = inForce.includes(input.value as OptionalCategory);
    }
  }

  function apply() {
    applyUi();
    applyEmbeds();
    analytics?.(granted("ga4"));
  }

  /** One decision, however often its cookie is read again. */
  const sameDecision = (a: ConsentState | null, b: ConsentState | null) =>
    Boolean(a && b && a.consentId === b.consentId && a.decidedAt === b.decidedAt);

  async function send(attempt = 0): Promise<void> {
    if (!state || state.recorded) return;
    const decided = state;
    const body = JSON.stringify(
      consentRecordRequest(decided, decided.action, {
        language: config.language,
        uiVersion: config.uiVersion,
        legalRevisions: config.legalRevisions,
      }),
    );
    let retryable = true;
    try {
      const response = await fetch(config.endpoint, {
        method: "POST",
        headers: { "Content-Type": "application/json" },
        body,
        credentials: "same-origin",
      });
      if (response.ok) {
        if (sameDecision(state, decided)) {
          state = { ...state!, recorded: true };
          writeCookie(state);
        }
        return;
      }
      retryable = response.status >= 500 || response.status === 429 || response.status === 408;
    } catch {
      // Offline or the Worker failed: retried below. The choice already applies.
    }
    if (!retryable || !sameDecision(state, decided) || attempt >= RETRY_DELAYS_MS.length) return;
    retry = setTimeout(() => {
      retry = undefined;
      void send(attempt + 1);
    }, RETRY_DELAYS_MS[attempt]);
  }

  function choose(choice: ConsentChoice) {
    const before = grantedCategories(config.configuration, state);
    const decision = decide(config.configuration, state, choice);
    state = decision.state;
    writeCookie(state);
    const after = grantedCategories(config.configuration, state);
    removeStorage(before.filter((category) => !after.includes(category)));
    apply();
    clearTimeout(retry);
    retry = undefined;
    void send();
  }

  function preferences(): HTMLDialogElement | null {
    return document.getElementById("gq-consent-preferences") as HTMLDialogElement | null;
  }

  function openPreferences(from?: HTMLElement | null) {
    const dialog = preferences();
    if (!dialog) return;
    opener = from ?? (document.activeElement as HTMLElement | null);
    applyUi();
    if (!dialog.open) dialog.showModal();
  }

  function closePreferences() {
    const dialog = preferences();
    if (dialog?.open) dialog.close();
  }

  function leaveBanner() {
    const banner = document.getElementById("gq-consent-banner");
    if (banner?.contains(document.activeElement)) {
      const main = document.querySelector<HTMLElement>("main") ?? document.body;
      if (!main.hasAttribute("tabindex")) main.setAttribute("tabindex", "-1");
      main.focus({ preventScroll: true });
    }
  }

  document.addEventListener("click", (event) => {
    const target = (event.target as Element | null)?.closest<HTMLElement>(
      "[data-gq-consent-accept-all],[data-gq-consent-reject-all],[data-gq-consent-customise],[data-gq-consent-open],[data-gq-consent-save],[data-gq-consent-close],[data-gq-consent-load-once],[data-gq-consent-allow]",
    );
    if (!target) return;
    // Decisions come only from the Runtime's own banner and panel; embed
    // buttons only from a placeholder, and only for its own category.
    const ui = target.closest("#gq-consent-banner, #gq-consent-preferences");
    const placeholder = target.closest<HTMLElement>("[data-gq-consent-embed]");
    const decision =
      target.hasAttribute("data-gq-consent-accept-all") ||
      target.hasAttribute("data-gq-consent-reject-all") ||
      target.hasAttribute("data-gq-consent-save") ||
      target.hasAttribute("data-gq-consent-close");
    if (decision && !ui) return;
    if (
      (target.hasAttribute("data-gq-consent-load-once") ||
        target.hasAttribute("data-gq-consent-allow")) &&
      !placeholder
    )
      return;
    event.preventDefault();
    if (target.hasAttribute("data-gq-consent-accept-all")) {
      leaveBanner();
      choose({ kind: "accept_all" });
      closePreferences();
    } else if (target.hasAttribute("data-gq-consent-reject-all")) {
      leaveBanner();
      choose({ kind: "reject_all" });
      closePreferences();
    } else if (
      target.hasAttribute("data-gq-consent-customise") ||
      target.hasAttribute("data-gq-consent-open")
    ) {
      openPreferences(target);
    } else if (target.hasAttribute("data-gq-consent-save")) {
      const decisions: Partial<Record<OptionalCategory, boolean>> = {};
      for (const input of document.querySelectorAll<HTMLInputElement>(
        "#gq-consent-preferences input[data-gq-consent-category]",
      )) {
        decisions[input.value as OptionalCategory] = input.checked;
      }
      leaveBanner();
      choose({ kind: "custom", decisions });
      closePreferences();
    } else if (target.hasAttribute("data-gq-consent-close")) {
      closePreferences();
    } else if (target.hasAttribute("data-gq-consent-load-once")) {
      const id = placeholder!.getAttribute("data-gq-consent-embed");
      if (isServiceId(id)) {
        placeholder!.setAttribute("data-gq-once", "");
        loadEmbed(placeholder!, id);
      }
    } else if (target.hasAttribute("data-gq-consent-allow")) {
      const id = placeholder!.getAttribute("data-gq-consent-embed");
      if (!isServiceId(id)) return;
      const category = SERVICE_CATALOG[id].category;
      if (category === "necessary") return;
      const decisions = Object.fromEntries(
        OPTIONAL_CATEGORIES.map((each) => [
          each,
          grantedCategories(config.configuration, state).includes(each),
        ]),
      ) as Record<OptionalCategory, boolean>;
      decisions[category] = true;
      choose({ kind: "custom", decisions });
    }
  });

  document.addEventListener(
    "close",
    (event) => {
      if (event.target === preferences() && opener?.isConnected) opener.focus();
    },
    true,
  );

  const controller: ConsentController = {
    get state() {
      return state;
    },
    get config() {
      return config;
    },
    choose,
    openPreferences,
    refresh() {
      config = readConfig() ?? config;
      const read = readConsentCookie(document.cookie);
      // A navigation keeps the decision (and its pending record and retries).
      if (!sameDecision(read, state)) state = read;
      apply();
      if (state && !state.recorded && retry === undefined) void send();
    },
  };
  window.__gqConsent = controller;
  // Astro's client-side navigation swaps the document's content.
  document.addEventListener("astro:page-load", () => controller.refresh());
  apply();
  void send();
  return controller;
}

export type { ConsentAction, ConsentChoice, ConsentState, ConsentPageConfig };
export { CONSENT_CONFIG_ID };
