// The neutral consent core (#21, #23, #24, #25): categories, catalog,
// configuration version, the consent cookie, decisions and embed rewriting.
import { expect, test } from "vite-plus/test";
import {
  CONSENT_CATEGORIES,
  CONSENT_COPY,
  DECISION_VALIDITY_MS,
  consentConfiguration,
  consentCookie,
  decide,
  embedPlaceholder,
  grantedCategories,
  needsBanner,
  parseConsentState,
  parseLegalLanguage,
  promptReason,
  readConsentCookie,
  rewriteEmbeds,
  serializeConsentState,
  serviceGranted,
  legalRevisions,
} from "@getquick/content/consent";
import { scanConsentHtml } from "@getquick/content/consent/testing";

const DAY = 24 * 60 * 60 * 1000;
const youtube = consentConfiguration({ services: ["youtube"], controller: "Acme, Lda." });

test("exactly the five fixed purpose categories (CN-R2)", () => {
  expect(CONSENT_CATEGORIES).toEqual([
    "necessary",
    "preferences",
    "analytics",
    "marketing",
    "external_media",
  ]);
  expect(youtube.categories).toEqual(["external_media"]);
  expect(youtube.services).toEqual(["consent", "youtube"]);
});

test("the service set is closed and GA4 follows gq-config's toggle (CN-R3, ticket 08)", () => {
  expect(() => consentConfiguration({ services: ["hotjar"] })).toThrow(/catalog/);
  expect(() => consentConfiguration({ services: ["ga4"] })).toThrow(/gq-config/);
  const off = consentConfiguration({ analytics: { enabled: false, measurementId: "G-ABC1234" } });
  const on = consentConfiguration({ analytics: { enabled: true, measurementId: "G-ABC1234" } });
  const invalid = consentConfiguration({ analytics: { enabled: true, measurementId: "UA-1-1" } });
  expect(off.services).not.toContain("ga4");
  expect(invalid.services).not.toContain("ga4");
  expect(on.services).toContain("ga4");
  expect(on.measurementId).toBe("G-ABC1234");
  expect(on.version).not.toBe(off.version);
  expect(needsBanner(off)).toBe(false);
  expect(needsBanner(on)).toBe(true);
});

test("the configuration version is stable and ignores copy edits (CN-R5)", () => {
  const again = consentConfiguration({ services: ["youtube"], controller: "Acme, Lda." });
  expect(again.version).toBe(youtube.version);
  const original = CONSENT_COPY.en.bannerTitle;
  CONSENT_COPY.en.bannerTitle = "Edited copy";
  try {
    expect(consentConfiguration({ services: ["youtube"], controller: "Acme, Lda." }).version).toBe(
      youtube.version,
    );
  } finally {
    CONSENT_COPY.en.bannerTitle = original;
  }
  expect(
    consentConfiguration({ services: ["youtube", "vimeo"], controller: "Acme, Lda." }).version,
  ).not.toBe(youtube.version);
});

test("the consent cookie round-trips and malformed values are no decision", () => {
  const { state } = decide(youtube, null, { kind: "reject_all" }, 1_700_000_000_000);
  expect(parseConsentState(serializeConsentState(state))).toEqual(state);
  const cookie = consentCookie(state);
  expect(cookie).toMatch(
    /^gq_consent=[A-Za-z0-9_-]+; Path=\/; Max-Age=34128000; SameSite=Lax; Secure$/,
  );
  expect(Number(/Max-Age=(\d+)/.exec(cookie)![1])).toBeLessThanOrEqual(13 * 31 * 24 * 3600);
  expect(readConsentCookie(`a=1; ${cookie.split(";")[0]}; b=2`)).toEqual(state);
  for (const bad of ["", "x", "eyJ2IjoyfQ", "%%%"]) expect(parseConsentState(bad)).toBeNull();
});

test("decisions: nothing is granted by default, actions follow CN-R7", () => {
  const now = 1_700_000_000_000;
  const accepted = decide(youtube, null, { kind: "accept_all" }, now);
  expect(accepted.action).toBe("accept_all");
  expect(accepted.state.decisions).toEqual({
    preferences: false,
    analytics: false,
    marketing: false,
    external_media: true,
  });
  const custom = decide(youtube, null, { kind: "custom", decisions: {} }, now);
  expect(custom.action).toBe("custom");
  expect(Object.values(custom.state.decisions).every((value) => !value)).toBe(true);
  const rejected = decide(youtube, null, { kind: "reject_all" }, now);
  expect(rejected.action).toBe("reject_all");
  const withdrawn = decide(youtube, accepted.state, { kind: "reject_all" }, now + DAY);
  expect(withdrawn.action).toBe("withdraw");
  expect(withdrawn.state.consentId).toBe(accepted.state.consentId);
  const renewed = decide(
    youtube,
    accepted.state,
    { kind: "accept_all" },
    now + DECISION_VALIDITY_MS,
  );
  expect(renewed.action).toBe("renew");
  expect(renewed.state.consentId).toBe(accepted.state.consentId);
  // Inactive categories cannot be granted.
  const sneaky = decide(youtube, null, { kind: "custom", decisions: { analytics: true } }, now);
  expect(sneaky.state.decisions.analytics).toBe(false);
});

test("validity and re-prompting (CN-R5)", () => {
  const now = 1_700_000_000_000;
  expect(promptReason(youtube, null, now)).toBe("first");
  const rejected = decide(youtube, null, { kind: "reject_all" }, now).state;
  // A rejection is not re-asked within 6 months.
  expect(promptReason(youtube, rejected, now + DECISION_VALIDITY_MS - DAY)).toBeNull();
  expect(promptReason(youtube, rejected, now + DECISION_VALIDITY_MS)).toBe("expired");
  // A new service in a rejected category is not material; in a granted one it is.
  const withVimeo = consentConfiguration({
    services: ["youtube", "vimeo"],
    controller: "Acme, Lda.",
  });
  expect(promptReason(withVimeo, rejected, now + DAY)).toBeNull();
  const accepted = decide(youtube, null, { kind: "accept_all" }, now).state;
  expect(promptReason(withVimeo, accepted, now + DAY)).toBe("material");
  expect(serviceGranted(withVimeo, accepted, "youtube", now + DAY)).toBe(true);
  expect(serviceGranted(withVimeo, accepted, "vimeo", now + DAY)).toBe(false);
  // A new category is material, as is another controller.
  const analytics = consentConfiguration({
    services: ["youtube"],
    controller: "Acme, Lda.",
    analytics: { enabled: true, measurementId: "G-ABC1234" },
  });
  expect(promptReason(analytics, rejected, now + DAY)).toBe("material");
  const otherController = consentConfiguration({ services: ["youtube"], controller: "Other, SA" });
  expect(promptReason(otherController, rejected, now + DAY)).toBe("material");
  expect(grantedCategories(otherController, accepted, now + DAY)).toEqual([]);
  // A removed service isn't material.
  const none = consentConfiguration({ controller: "Acme, Lda." });
  expect(promptReason(none, accepted, now + DAY)).toBeNull();
});

const site = { siteOrigin: "https://www.acme.test", firstPartyHosts: ["cms.acme.test"] };
const embed = (src: string, extra = "") =>
  `<figure class="wp-block-embed"><div class="wp-block-embed__wrapper"><iframe title="Clip" width="560" height="315" src="${src}"${extra} allowfullscreen></iframe></div></figure>`;

test("WordPress embeds become placeholders with no live third-party src (CN-R13)", () => {
  const html = embed("https://www.youtube.com/embed/abcdefghijk?feature=oembed&amp;x=1");
  expect(scanConsentHtml(html, site).liveThirdParty).toHaveLength(1);
  const result = rewriteEmbeds(html, { configuration: youtube, language: "pt-PT" });
  expect(result.placeholders).toEqual([{ service: "youtube", host: "www.youtube.com" }]);
  expect(result.blocked).toEqual([]);
  const scan = scanConsentHtml(result.html, site);
  expect(scan.liveThirdParty).toEqual([]);
  expect(scan.placeholders).toEqual(["youtube"]);
  expect(result.html).toContain("Carregar uma vez");
  expect(result.html).toContain('data-gq-consent-allow="external_media"');
  expect(result.html).not.toMatch(/<iframe/);
  // The embed's URL is kept, decoded, for loading after consent.
  expect(result.html).toContain("feature=oembed&amp;x=1");
  expect(
    result.html.startsWith('<figure class="wp-block-embed"><div class="wp-block-embed__wrapper">'),
  ).toBe(true);
});

test("unknown hosts, inactive services and scripts are blocked and reported (CN-R3)", () => {
  const html =
    embed("https://evil.example/frame") +
    embed("https://player.vimeo.com/video/1") +
    '<script src="https://www.googletagmanager.com/gtag/js?id=G-X"></script>' +
    "<script>fetch('https://x.example')</script>" +
    '<script type="application/ld+json">{"@type":"Thing"}</script>' +
    '<iframe src="/first-party/"></iframe><iframe src="https://cms.acme.test/embed/"></iframe>' +
    '<p>Text</p><img src="https://cms.acme.test/wp-content/uploads/a.jpg" alt="">';
  const result = rewriteEmbeds(html, {
    configuration: youtube,
    language: "en",
    firstPartyHosts: ["cms.acme.test"],
  });
  expect(result.blocked).toEqual([
    { tag: "iframe", host: "evil.example", service: null, reason: "unknown-host" },
    { tag: "iframe", host: "player.vimeo.com", service: "vimeo", reason: "inactive-service" },
    { tag: "script", host: "www.googletagmanager.com", service: "ga4", reason: "script" },
    { tag: "script", host: "inline", service: null, reason: "script" },
  ]);
  expect(result.html).toContain('<script type="application/ld+json">{"@type":"Thing"}</script>');
  expect(result.html).toContain('<iframe src="/first-party/"></iframe>');
  expect(result.html).toContain('<iframe src="https://cms.acme.test/embed/"></iframe>');
  const scan = scanConsentHtml(result.html, site);
  expect(scan.liveThirdParty).toEqual([]);
  expect(scan.blocked.map((each) => each.host)).toEqual([
    "evil.example",
    "player.vimeo.com",
    "www.googletagmanager.com",
    "inline",
  ]);
  expect(result.html).toContain("Content from evil.example is blocked: it isn&#039;t a service");
});

test("HTML without third-party embeds is byte-identical after rewriting", () => {
  const html =
    '<p>Olá &amp; <a href="https://other.example/">link</a></p>\n<video src="/v.mp4"></video>';
  expect(rewriteEmbeds(html, { configuration: youtube, language: "en" }).html).toBe(html);
});

test("Site components use the same placeholder; the video hero is decorative (ticket 09)", () => {
  const maps = consentConfiguration({ services: ["google_maps", "youtube"] });
  const placeholder = embedPlaceholder({
    service: "google_maps",
    src: "https://www.google.com/maps/embed?pb=abc",
    title: "Our office",
    width: 600,
    height: 450,
    language: "en",
  });
  expect(scanConsentHtml(placeholder, site).liveThirdParty).toEqual([]);
  expect(placeholder).toContain('data-gq-consent-embed="google_maps"');
  expect(placeholder).toContain("Load once");
  expect(placeholder).toContain("Always allow external media");
  const hero =
    '<iframe class="wp-block-getquick-design-video-hero__video wp-block-getquick-design-video-hero__video--youtube" src="https://www.youtube-nocookie.com/embed/abcdefghijk?autoplay=1" title="Decorative background video" tabindex="-1" aria-hidden="true"></iframe>';
  const rewritten = rewriteEmbeds(hero, { configuration: maps, language: "en" }).html;
  expect(rewritten).toContain("data-gq-decorative");
  expect(rewritten).not.toContain("Load once");
  expect(scanConsentHtml(rewritten, site).liveThirdParty).toEqual([]);
  const mapsInHtml = rewriteEmbeds(embed("https://www.google.com/maps/embed?pb=abc"), {
    configuration: maps,
    language: "en",
  });
  expect(mapsInHtml.placeholders[0]?.service).toBe("google_maps");
});

test("the Legal Contract is parsed defensively and its revisions recorded", () => {
  const legal = parseLegalLanguage({
    controller: { name: "Acme, Lda.", privacyEmail: "privacy@acme.test", dpoContact: null },
    roles: [
      {
        role: "cookie_policy",
        url: "/cookies/",
        title: "Cookies",
        revision: "2026-10-01T10:00:00",
        isFallback: false,
      },
      {
        role: "privacy_policy",
        url: "https://www.acme.test/privacy/",
        title: null,
        revision: "7",
        isFallback: true,
      },
      { role: "made_up", url: "/x/", title: null, revision: null, isFallback: false },
      {
        role: "terms_of_use",
        url: "javascript:alert(1)",
        title: null,
        revision: null,
        isFallback: false,
      },
    ],
    missingRequired: ["terms_of_sale"],
  });
  expect(legal?.roles.map((role) => role.role)).toEqual(["privacy_policy", "cookie_policy"]);
  expect(legalRevisions(legal)).toEqual({
    privacy_policy: "7",
    cookie_policy: "2026-10-01T10:00:00",
  });
  expect(legal?.missingRequired).toEqual(["terms_of_sale"]);
});

test("the video hero is gated identically on the Site renderer path and in WordPress HTML (ticket 09)", async () => {
  const { renderWordPressBlocks } = await import("@getquick/content");
  const configuration = consentConfiguration({ services: ["youtube"] });
  const rendered = renderWordPressBlocks([
    {
      name: "getquick-design/video-hero",
      attributes: { videoType: "youtube", videoUrl: "https://youtu.be/abcdefghijk" },
      innerBlocks: [],
      innerHTML: '<section class="wp-block-getquick-design-video-hero"></section>',
    } as never,
  ]);
  expect(rendered).toContain("youtube-nocookie.com/embed/abcdefghijk");
  // The Site's own rendering and the delivery step run the same rewriting.
  const sitePath = rewriteEmbeds(rendered, { configuration, language: "en" });
  const deliveryPath = rewriteEmbeds(rendered, { configuration, language: "en" });
  expect(sitePath).toEqual(deliveryPath);
  expect(sitePath.placeholders).toEqual([{ service: "youtube", host: "www.youtube-nocookie.com" }]);
  expect(sitePath.html).toContain("data-gq-decorative");
  expect(scanConsentHtml(sitePath.html, site).liveThirdParty).toEqual([]);
  // Without the service declared, the hero video is blocked, never live.
  const undeclared = rewriteEmbeds(rendered, {
    configuration: consentConfiguration(),
    language: "en",
  });
  expect(undeclared.blocked[0]?.reason).toBe("inactive-service");
});
