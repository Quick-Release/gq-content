// @getquick/content/consent/testing: CONSENT-1's shared acceptance suite
// (seam 1, the Site Frontend as a visitor sees it). Provider and adapter CI
// run it against real browsers; replacement UIs must pass it (CN-C4). It takes
// structural Playwright-like objects, so it has no browser dependency itself.
import { CONSENT_COOKIE, readConsentCookie, type ConsentState } from "./state";
import { hostMatches } from "./catalog";

export interface ScanOptions {
  /** The Site's origin; relative URLs and this host are first party. */
  siteOrigin: string;
  /** Further first-party hosts (the Site's own CMS/media origin). */
  firstPartyHosts?: readonly string[];
}

export interface LiveSource {
  tag: string;
  attribute: string;
  url: string;
}

export interface HtmlScan {
  /** Third-party URLs the HTML would load without any script running. */
  liveThirdParty: LiveSource[];
  /** Placeholders blocked for good (unknown hosts, inactive services, scripts): the diagnostic report. */
  blocked: Array<{ host: string; tag: string }>;
  /** Consent placeholders by service. */
  placeholders: string[];
}

function firstParty(url: URL, options: ScanOptions): boolean {
  const site = new URL(options.siteOrigin);
  return (
    url.host === site.host ||
    (options.firstPartyHosts ?? []).some((host) => hostMatches(url.hostname, host))
  );
}

/** Whether a request URL leaves the Site (data:, blob: and the Site's own hosts don't). */
export function isThirdPartyUrl(value: string, options: ScanOptions): boolean {
  let url: URL;
  try {
    url = new URL(value, options.siteOrigin);
  } catch {
    return false;
  }
  if (url.protocol !== "http:" && url.protocol !== "https:") return false;
  return !firstParty(url, options);
}

const LOADING = [
  ["iframe", "src"],
  ["script", "src"],
  ["img", "src"],
  ["img", "srcset"],
  ["source", "src"],
  ["source", "srcset"],
  ["video", "src"],
  ["video", "poster"],
  ["audio", "src"],
  ["embed", "src"],
  ["object", "data"],
  ["link", "href"],
  ["track", "src"],
] as const;

/**
 * Raw HTML, as fetched without JavaScript (CN-R1, CN-R13): every third-party
 * URL an element would load, the blocked-embed diagnostics, and placeholders.
 * `<link>` counts only for stylesheets, preloads, icons and fonts.
 */
export function scanConsentHtml(html: string, options: ScanOptions): HtmlScan {
  const liveThirdParty: LiveSource[] = [];
  for (const match of html.matchAll(/<([a-z][a-z0-9-]*)\b([^>]*)>/gi)) {
    const tag = match[1]!.toLowerCase();
    const attributes = match[2]!;
    if (
      tag === "link" &&
      !/\brel\s*=\s*["']?[^"'>]*(stylesheet|preload|icon|modulepreload|preconnect|dns-prefetch)/i.test(
        attributes,
      )
    )
      continue;
    for (const [element, attribute] of LOADING) {
      if (element !== tag) continue;
      const value = new RegExp(
        `(?:^|\\s)${attribute}\\s*=\\s*(?:"([^"]*)"|'([^']*)'|([^\\s>]+))`,
        "i",
      ).exec(attributes);
      if (!value) continue;
      const raw = (value[1] ?? value[2] ?? value[3] ?? "").replaceAll("&amp;", "&");
      const urls =
        attribute === "srcset"
          ? raw.split(",").map((each) => each.trim().split(/\s+/)[0] ?? "")
          : [raw];
      for (const url of urls) {
        if (url && isThirdPartyUrl(url, options)) liveThirdParty.push({ tag, attribute, url });
      }
    }
  }
  const blocked = [
    ...html.matchAll(/data-gq-consent-blocked="([^"]*)"[^>]*?data-gq-tag="([^"]*)"/g),
  ].map((match) => ({ host: match[1]!, tag: match[2]! }));
  const placeholders = [...html.matchAll(/data-gq-consent-embed="([^"]+)"/g)].map(
    (match) => match[1]!,
  );
  return { liveThirdParty, blocked, placeholders };
}

/** The Playwright surface the suite uses. */
export interface BrowserContextLike {
  newPage(): Promise<PageLike>;
  cookies(): Promise<Array<{ name: string; value: string }>>;
  close(): Promise<void>;
}
export interface BrowserLike {
  newContext(options?: { javaScriptEnabled?: boolean }): Promise<BrowserContextLike>;
}
export interface PageLike {
  goto(url: string, options?: { waitUntil?: "load" | "networkidle" }): Promise<unknown>;
  on(event: "request", listener: (request: { url(): string }) => void): unknown;
  evaluate<T>(script: () => T | Promise<T>): Promise<T>;
  click(selector: string): Promise<void>;
  waitForTimeout(ms: number): Promise<void>;
  keyboard: { press(key: string): Promise<void> };
}

export interface Capture {
  route: string;
  requests: string[];
  thirdParty: string[];
  cookies: string[];
  localStorage: string[];
  sessionStorage: string[];
  consent: ConsentState | null;
}

/** Records every request and the storage a page holds after it settles. */
export async function capture(
  context: BrowserContextLike,
  page: PageLike,
  route: string,
  options: ScanOptions,
  act?: (page: PageLike) => Promise<void>,
): Promise<Capture> {
  const requests: string[] = [];
  page.on("request", (request) => requests.push(request.url()));
  await page.goto(new URL(route, options.siteOrigin).href, { waitUntil: "networkidle" });
  if (act) {
    await act(page);
    await page.waitForTimeout(500);
  }
  const storage = await page.evaluate(() => ({
    local: Object.keys(localStorage),
    session: Object.keys(sessionStorage),
  }));
  const cookies = await context.cookies();
  const consent = cookies.find((cookie) => cookie.name === CONSENT_COOKIE);
  return {
    route,
    requests,
    thirdParty: requests.filter((url) => isThirdPartyUrl(url, options)),
    cookies: cookies.map((cookie) => cookie.name),
    localStorage: storage.local,
    sessionStorage: storage.session,
    consent: consent ? readConsentCookie(`${CONSENT_COOKIE}=${consent.value}`) : null,
  };
}

export interface AcceptanceCheck {
  criterion: string;
  route: string;
  passed: boolean;
  detail: string;
}

export interface AcceptanceOptions extends ScanOptions {
  routes: readonly string[];
  /** Third-party hosts allowed without consent (necessary services on this route); none by default. */
  necessaryHosts?: readonly string[];
  /** Cookies allowed without consent besides gq_consent (necessary storage the Site declares). */
  necessaryCookies?: readonly string[];
  /** Fetches raw HTML (defaults to global fetch). */
  fetch?: typeof globalThis.fetch;
}

function allowed(url: string, hosts: readonly string[]) {
  try {
    const host = new URL(url).hostname;
    return hosts.some((each) => hostMatches(host, each));
  } catch {
    return false;
  }
}

/**
 * The provider/adapter acceptance run (CONSENT-1 acceptance evidence 1 and 2):
 * for each route, raw HTML without JavaScript, a visit with no interaction,
 * and a visit after Reject all, each captured; plus first-layer presentation.
 * Returns every check; a compliant Site has none failing.
 */
export async function runConsentAcceptance(
  browser: BrowserLike,
  options: AcceptanceOptions,
): Promise<AcceptanceCheck[]> {
  const checks: AcceptanceCheck[] = [];
  const record = (criterion: string, route: string, passed: boolean, detail: string) =>
    checks.push({ criterion, route, passed, detail });
  const necessaryHosts = options.necessaryHosts ?? [];
  const necessaryCookies = [CONSENT_COOKIE, ...(options.necessaryCookies ?? [])];
  const violations = (result: Capture) => [
    ...result.thirdParty
      .filter((url) => !allowed(url, necessaryHosts))
      .map((url) => `request ${url}`),
    ...result.cookies
      .filter((name) => !necessaryCookies.includes(name))
      .map((name) => `cookie ${name}`),
    ...result.localStorage.map((key) => `localStorage ${key}`),
    ...result.sessionStorage.map((key) => `sessionStorage ${key}`),
  ];

  for (const route of options.routes) {
    const response = await (options.fetch ?? fetch)(new URL(route, options.siteOrigin));
    const scan = scanConsentHtml(await response.text(), options);
    const live = scan.liveThirdParty.filter((source) => !allowed(source.url, necessaryHosts));
    record(
      "CN-R13",
      route,
      live.length === 0,
      live.length
        ? `live third-party sources: ${live.map((each) => each.url).join(", ")}`
        : `no live third-party src; ${scan.placeholders.length} placeholder(s), ${scan.blocked.length} blocked`,
    );

    const fresh = await browser.newContext();
    try {
      const page = await fresh.newPage();
      const result = await capture(fresh, page, route, options);
      const found = violations(result);
      if (result.cookies.includes(CONSENT_COOKIE))
        found.push("consent cookie written without a decision");
      record(
        "CN-R1",
        route,
        found.length === 0,
        found.join("; ") || "no third-party request or optional storage without interaction",
      );

      const presentation = await page.evaluate(() => {
        const banner = document.getElementById("gq-consent-banner");
        if (!banner || banner.hidden) return { banner: false } as const;
        const accept = banner.querySelector<HTMLElement>("[data-gq-consent-accept-all]");
        const reject = banner.querySelector<HTMLElement>("[data-gq-consent-reject-all]");
        const style = (element: HTMLElement | null) => {
          if (!element) return null;
          const computed = getComputedStyle(element);
          const box = element.getBoundingClientRect();
          return {
            name: (element.getAttribute("aria-label") ?? element.textContent ?? "").trim(),
            font: `${computed.fontSize} ${computed.fontWeight}`,
            colors: `${computed.color} ${computed.backgroundColor} ${computed.borderColor}`,
            height: Math.round(box.height),
            visible: box.width > 0 && box.height > 0,
          };
        };
        return {
          banner: true,
          accept: style(accept),
          reject: style(reject),
          customise: Boolean(banner.querySelector("[data-gq-consent-customise]")),
          policy: Boolean(banner.querySelector("a[href]")),
          checked: [
            ...document.querySelectorAll<HTMLInputElement>("input[data-gq-consent-category]"),
          ].filter((input) => input.checked).length,
          settings: Boolean(document.querySelector("[data-gq-consent-open]")),
          label: banner.getAttribute("aria-labelledby")
            ? (document.getElementById(banner.getAttribute("aria-labelledby")!)?.textContent ?? "")
            : "",
        } as const;
      });
      if (presentation.banner) {
        const { accept, reject } = presentation;
        const equal =
          Boolean(accept && reject && accept.visible && reject.visible) &&
          accept!.font === reject!.font &&
          accept!.colors === reject!.colors &&
          Math.abs(accept!.height - reject!.height) <= 1;
        record(
          "CN-R4",
          route,
          equal && Boolean(accept!.name) && Boolean(reject!.name),
          `Accept all and Reject all ${equal ? "have" : "lack"} equal prominence`,
        );
        record(
          "CN-R4",
          route,
          presentation.customise && presentation.policy,
          "a route to per-category choices and the cookie policy link are on the first layer",
        );
        record(
          "CN-R4",
          route,
          presentation.checked === 0,
          `${presentation.checked} pre-ticked category control(s)`,
        );
        record(
          "CN-R4",
          route,
          Boolean(presentation.label.trim()),
          "the banner has an accessible name",
        );
      }
      record(
        "CN-R6",
        route,
        presentation.banner
          ? presentation.settings
          : await page.evaluate(() => Boolean(document.querySelector("[data-gq-consent-open]"))),
        "a persistent Cookie settings control is on the page",
      );

      if (presentation.banner) {
        await page.click("#gq-consent-banner [data-gq-consent-reject-all]");
        await page.waitForTimeout(300);
        const rejected = await capture(fresh, await fresh.newPage(), route, options);
        const after = violations(rejected);
        const denied =
          rejected.consent !== null &&
          Object.values(rejected.consent.decisions).every((value) => !value);
        record(
          "CN-R1",
          route,
          after.length === 0 && denied,
          after.join("; ") ||
            (denied
              ? "after Reject all: nothing loads, the consent cookie records the rejection"
              : "the consent cookie doesn't record the rejection"),
        );
      }
    } finally {
      await fresh.close();
    }
  }
  return checks;
}

/** The checks that failed. */
export function failures(checks: readonly AcceptanceCheck[]): AcceptanceCheck[] {
  return checks.filter((check) => !check.passed);
}
