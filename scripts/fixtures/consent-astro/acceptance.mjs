// CONSENT-1 / LEGAL-1 acceptance on the minimal Astro fixture (seam 1: the
// Site Frontend as a visitor sees it), in a real Chromium against the packed
// package. Third-party requests are captured and answered locally, so no
// visitor traffic leaves the machine. Writes evidence to $CONSENT_EVIDENCE.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { failures, runConsentAcceptance, scanConsentHtml } from "@getquick/content/consent/testing";
import { readConsentCookie } from "@getquick/content/consent";

const origin = process.env.CONSENT_ORIGIN;
const data = process.env.CONSENT_FIXTURE_DATA;
const evidence = [];
const pass = (criteria, detail) => {
  evidence.push({ criteria, detail, passed: true });
  console.log(`PASS ${criteria.join(", ")}: ${detail}`);
};
const site = { siteOrigin: origin };
const thirdParty = (url) => new URL(url).origin !== origin;
const records = () =>
  new DatabaseSync(`${data}/consent.sqlite`, { readOnly: true })
    .prepare("SELECT * FROM consent_records ORDER BY id")
    .all();
const settle = (page, ms = 400) => page.waitForTimeout(ms);

const browser = await chromium.launch();
// Every context answers third-party requests locally after they are captured.
async function context(options = {}) {
  const ctx = await browser.newContext(options);
  await ctx.route(
    (url) => thirdParty(url.href),
    (route) => {
      const url = route.request().url();
      if (url.startsWith("https://www.googletagmanager.com/gtag/js"))
        return route.fulfill({
          contentType: "text/javascript",
          // A stand-in tag: records what it saw first and writes _ga as GA4 does.
          body: "window.__tagSaw = JSON.stringify(Array.from(window.dataLayer, (e) => Array.from(e))); document.cookie = '_ga=GA1.1.1.1; Path=/'; document.cookie = '_ga_TEST1234=GS1.1; Path=/';",
        });
      return route.fulfill({
        contentType: "text/html",
        body: "<!doctype html><title>stub</title>",
      });
    },
  );
  const requests = [];
  ctx.on("request", (request) => requests.push(request.url()));
  return { ctx, requests, external: () => requests.filter(thirdParty) };
}
const cookieState = async (ctx) => {
  const cookie = (await ctx.cookies()).find((each) => each.name === "gq_consent");
  return cookie ? readConsentCookie(`gq_consent=${cookie.value}`) : null;
};

try {
  // 1. The shared suite on representative routes: raw HTML, no interaction, Reject all, presentation.
  const routes = ["/", "/en/", "/sobre/", "/en/about/", "/contacto/", "/privacidade/"];
  const suite = await runConsentAcceptance(
    { newContext: async () => (await context()).ctx },
    { ...site, routes },
  );
  assert.deepEqual(failures(suite), [], JSON.stringify(failures(suite), null, 2));
  for (const check of suite)
    evidence.push({
      criteria: [check.criterion],
      detail: `${check.route}: ${check.detail}`,
      passed: check.passed,
    });
  pass(
    ["CN-R1", "CN-R4", "CN-R6", "CN-R13"],
    `shared suite passed ${suite.length} checks on ${routes.join(" ")}`,
  );

  // 2. A deliberately non-compliant page fails the same suite.
  const bad = await runConsentAcceptance(
    { newContext: async () => (await context()).ctx },
    { ...site, routes: ["/non-compliant/"] },
  );
  const badFailures = failures(bad).map((check) => check.criterion);
  assert.ok(badFailures.includes("CN-R13") && badFailures.includes("CN-R1"), JSON.stringify(bad));
  pass(
    ["CN-R1", "CN-R13"],
    `the non-compliant fixture fails the suite (${badFailures.join(", ")})`,
  );

  // 3. Raw HTML without JavaScript: placeholders, the blocked unknown host as a diagnostic.
  const raw = await (await fetch(`${origin}/sobre/`)).text();
  const scan = scanConsentHtml(raw, site);
  assert.deepEqual(scan.liveThirdParty, []);
  assert.deepEqual(scan.blocked, [{ host: "tracker.example", tag: "iframe" }]);
  assert.ok(raw.includes("data-gq-decorative"), "video hero is a decorative placeholder");
  pass(
    ["CN-R3", "CN-R13"],
    "an unknown-host iframe in WordPress HTML is blocked and reported; the video hero is gated",
  );

  // 4. Accept all loads the embed; GA4 follows Consent Mode v2 basic mode.
  {
    const { ctx, external } = await context();
    const page = await ctx.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    assert.deepEqual(external(), [], "nothing third-party before a decision");
    await page.click("#gq-consent-banner [data-gq-consent-accept-all]");
    await page.waitForSelector("[data-gq-consent-embed='youtube'] iframe");
    await settle(page, 800);
    const google = external();
    assert.ok(
      google.some((url) => url.startsWith("https://www.youtube.com/embed/")),
      google.join(),
    );
    assert.ok(
      google.some((url) =>
        url.startsWith("https://www.googletagmanager.com/gtag/js?id=G-TEST1234"),
      ),
    );
    const saw = JSON.parse(await page.evaluate(() => window.__tagSaw));
    assert.deepEqual(saw[0], [
      "consent",
      "default",
      {
        analytics_storage: "denied",
        ad_storage: "denied",
        ad_user_data: "denied",
        ad_personalization: "denied",
      },
    ]);
    assert.deepEqual(saw[1].slice(0, 2), ["consent", "update"]);
    assert.equal(saw[1][2].analytics_storage, "granted");
    assert.equal(await page.isHidden("#gq-consent-banner"), true);
    pass(
      ["CN-R12", "CN-R1"],
      "after Accept all the embed and the GA4 tag load; denied defaults precede the tag, then an analytics_storage update",
    );

    // Withdrawal from the persistent control: denied update, _ga removed, nothing further loads.
    await page.click("footer [data-gq-consent-open]");
    await page.uncheck("#gq-consent-category-analytics");
    await page.click("#gq-consent-preferences [data-gq-consent-save]");
    await settle(page);
    const layer = await page.evaluate(() => Array.from(window.dataLayer, (e) => Array.from(e)));
    const last = layer.filter((entry) => entry[0] === "consent").at(-1);
    assert.equal(last[2].analytics_storage, "denied");
    const names = (await ctx.cookies()).map((cookie) => cookie.name);
    assert.ok(!names.some((name) => name.startsWith("_ga")), names.join());
    assert.equal(await page.evaluate(() => window["ga-disable-G-TEST1234"]), true);
    const before = external().length;
    await page.goto(`${origin}/en/`, { waitUntil: "networkidle" });
    assert.ok(
      !external()
        .slice(before)
        .some((url) => url.includes("googletagmanager")),
    );
    const state = await cookieState(ctx);
    assert.equal(state.decisions.analytics, false);
    assert.equal(state.decisions.external_media, true);
    pass(
      ["CN-R6", "CN-R12"],
      "withdrawing analytics sends a denied update, removes _ga cookies and stops further loading",
    );
    await ctx.close();
  }

  // 5. Records: one per decision, append-only, with the right actions and language.
  {
    const start = records().length;
    const { ctx } = await context();
    const page = await ctx.newPage();
    await page.goto(`${origin}/en/`, { waitUntil: "networkidle" });
    assert.equal(
      await page.textContent("#gq-consent-banner [data-gq-consent-accept-all]"),
      "Accept all",
    );
    await page.click("#gq-consent-banner [data-gq-consent-customise]");
    assert.equal(await page.isChecked("#gq-consent-category-analytics"), false);
    assert.equal(await page.isChecked("#gq-consent-category-external_media"), false);
    await page.check("#gq-consent-category-external_media");
    await page.click("#gq-consent-preferences [data-gq-consent-save]");
    await settle(page);
    const state = await cookieState(ctx);
    assert.ok(state.recorded, "the custom decision was recorded");
    await page.click("footer [data-gq-consent-open]");
    assert.equal(await page.textContent("[data-gq-consent-id]"), state.consentId);
    await page.click("#gq-consent-preferences [data-gq-consent-reject-all]");
    await settle(page);
    const rows = records().slice(start);
    assert.deepEqual(
      rows.map((row) => [row.action, row.language, row.external_media, row.analytics]),
      [
        ["custom", "en-US", 1, 0],
        ["withdraw", "en-US", 0, 0],
      ],
    );
    assert.ok(rows.every((row) => row.consent_id === state.consentId && row.site_id === "acme"));
    assert.deepEqual(JSON.parse(rows[0].legal_revisions), {
      privacy_policy: "2026-10-01T09:00:00",
      cookie_policy: "2026-10-03T09:00:00",
    });
    assert.ok(!Object.keys(rows[0]).some((column) => /ip|agent|user/i.test(column)));
    pass(
      ["CN-R7", "CN-R8", "CN-R11", "CN-C3"],
      "custom then withdraw each append one record with the consent ID shown in the panel, page language and legal revisions",
    );
    await ctx.close();
  }

  // 6. A failed write is retried and never turns a rejection into a grant.
  {
    const start = records().length;
    const { ctx, external } = await context();
    let failed = 0;
    await ctx.route(`${origin}/gq/consent`, (route) =>
      failed++ < 2 ? route.fulfill({ status: 503, body: "{}" }) : route.continue(),
    );
    const page = await ctx.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.click("#gq-consent-banner [data-gq-consent-reject-all]");
    await settle(page, 300);
    let state = await cookieState(ctx);
    assert.equal(state.recorded, false);
    assert.ok(Object.values(state.decisions).every((value) => !value));
    await page.waitForTimeout(4_800);
    state = await cookieState(ctx);
    assert.equal(failed, 3);
    assert.equal(state.recorded, true);
    assert.deepEqual(
      records()
        .slice(start)
        .map((row) => row.action),
      ["reject_all"],
    );
    assert.deepEqual(external(), []);
    pass(
      ["CN-R8", "CN-R14"],
      "two failed record writes are retried; the rejection stays applied and is recorded once",
    );
    await ctx.close();
  }

  // 7. Validity and re-prompting; keyboard and focus.
  {
    const now = Date.now();
    const config = JSON.parse(
      /<script type="application\/json" id="gq-consent-config">(.*?)<\/script>/.exec(
        await (await fetch(`${origin}/`)).text(),
      )[1],
    ).configuration;
    const encode = (value) => Buffer.from(JSON.stringify(value)).toString("base64url");
    const cookieFor = (decidedAt, d, services = config.services) => ({
      name: "gq_consent",
      value: encode({
        v: 1,
        i: "0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d",
        t: decidedAt,
        d,
        s: services,
        c: config.controller,
        h: config.version,
        a: "reject_all",
        r: 1,
      }),
      url: origin,
    });
    const banner = async (cookie) => {
      const { ctx } = await context();
      await ctx.addCookies([cookie]);
      const page = await ctx.newPage();
      await page.goto(`${origin}/`, { waitUntil: "networkidle" });
      const shown = await page.isVisible("#gq-consent-banner");
      return { ctx, page, shown };
    };
    const month = 30.4375 * 24 * 3600 * 1000;
    let probe = await banner(cookieFor(now - 5 * month, "0000"));
    assert.equal(probe.shown, false, "a rejection is not re-asked within 6 months");
    await probe.ctx.close();
    probe = await banner(cookieFor(now - 7 * month, "0000"));
    assert.equal(probe.shown, true, "an expired decision prompts");
    const start = records().length;
    await probe.page.click("#gq-consent-banner [data-gq-consent-accept-all]");
    await settle(probe.page);
    assert.deepEqual(
      records()
        .slice(start)
        .map((row) => [row.action, row.consent_id]),
      [["renew", "0b1f2c3d-4e5f-4a6b-8c7d-9e0f1a2b3c4d"]],
    );
    await probe.ctx.close();
    probe = await banner(
      cookieFor(
        now - month,
        "0001",
        config.services.filter((id) => id !== "google_maps"),
      ),
    );
    assert.equal(probe.shown, true, "a new service in a granted category re-prompts");
    await probe.ctx.close();
    probe = await banner(
      cookieFor(
        now - month,
        "0000",
        config.services.filter((id) => id !== "google_maps"),
      ),
    );
    assert.equal(probe.shown, false, "a new service in a rejected category does not");
    await probe.ctx.close();
    pass(
      ["CN-R5"],
      "6-month validity, renewal with the same consent ID, material re-prompts only for granted categories",
    );

    const { ctx } = await context();
    const page = await ctx.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    // The banner comes first: its cookie policy link, Reject all, Accept all, then the choices.
    const order = [];
    for (let i = 0; i < 4; i++) {
      await page.keyboard.press("Tab");
      order.push(
        await page.evaluate(() => {
          const element = document.activeElement;
          if (!element?.closest("#gq-consent-banner")) return "outside";
          return element.matches("a")
            ? "policy"
            : ["reject-all", "accept-all", "customise"].find((name) =>
                element.hasAttribute(`data-gq-consent-${name}`),
              );
        }),
      );
    }
    assert.deepEqual(order, ["policy", "reject-all", "accept-all", "customise"]);
    await page.keyboard.press("Enter");
    assert.equal(
      await page.evaluate(() => document.getElementById("gq-consent-preferences").open),
      true,
    );
    assert.equal(
      await page.evaluate(() =>
        document.getElementById("gq-consent-preferences").contains(document.activeElement),
      ),
      true,
    );
    await page.keyboard.press("Escape");
    assert.equal(
      await page.evaluate(() => document.activeElement?.hasAttribute("data-gq-consent-customise")),
      true,
    );
    const names = await page.evaluate(() =>
      [
        ...document.querySelectorAll(
          "#gq-consent-banner button, #gq-consent-preferences button, #gq-consent-preferences input",
        ),
      ].map((element) => (element.labels?.[0]?.textContent ?? element.textContent ?? "").trim()),
    );
    assert.ok(names.every(Boolean), names.join("|"));
    assert.equal(await page.getAttribute("#gq-consent-banner", "role"), "dialog");
    pass(
      ["CN-R4"],
      "the banner is first in focus order, its controls are keyboard-operable with accessible names, the panel takes and returns focus",
    );
    await ctx.close();
  }

  // 8. Site-component embeds: Load once vs Always allow.
  {
    const { ctx, external } = await context();
    const page = await ctx.newPage();
    await page.goto(`${origin}/contacto/`, { waitUntil: "networkidle" });
    assert.deepEqual(external(), []);
    await page.click("[data-gq-consent-embed='google_maps'] [data-gq-consent-load-once]");
    await page.waitForSelector("[data-gq-consent-embed='google_maps'] iframe");
    await settle(page);
    assert.ok(external().some((url) => url.startsWith("https://www.google.com/maps/embed")));
    assert.equal(await cookieState(ctx), null, "Load once grants nothing");
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.isVisible("[data-gq-consent-embed='google_maps'] iframe"), false);
    const start = records().length;
    await page.click("[data-gq-consent-embed='google_maps'] [data-gq-consent-allow]");
    await page.waitForSelector("[data-gq-consent-embed='google_maps'] iframe");
    await settle(page);
    const state = await cookieState(ctx);
    assert.equal(state.decisions.external_media, true);
    assert.equal(state.decisions.analytics, false);
    assert.deepEqual(
      records()
        .slice(start)
        .map((row) => [row.action, row.external_media]),
      [["custom", 1]],
    );
    await page.reload({ waitUntil: "networkidle" });
    assert.equal(await page.isVisible("[data-gq-consent-embed='google_maps'] iframe"), true);
    pass(
      ["CN-R13"],
      "Load once loads one map without a grant; Always allow grants external_media, is recorded and persists",
    );

    // Client-side navigation keeps gating: the video hero loads only after the grant.
    await page.click("header a[href='/sobre/']");
    await page.waitForURL(`${origin}/sobre/`);
    await page.waitForSelector("[data-gq-consent-embed='youtube'][data-gq-decorative] iframe");
    pass(
      ["CN-R1"],
      "after client-side navigation the granted video hero loads from its placeholder",
    );
    await ctx.close();
  }
  {
    const { ctx, external } = await context();
    const page = await ctx.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.click("header a[href='/sobre/']");
    await page.waitForURL(`${origin}/sobre/`);
    await settle(page, 800);
    assert.deepEqual(external(), []);
    assert.equal(await page.isVisible("#gq-consent-banner"), true);
    const storage = await page.evaluate(() => [
      Object.keys(localStorage).length,
      Object.keys(sessionStorage).length,
    ]);
    assert.deepEqual(storage, [0, 0]);
    assert.deepEqual(
      (await ctx.cookies()).map((cookie) => cookie.name),
      [],
    );
    pass(
      ["CN-R1"],
      "client-side navigation without a decision loads nothing third-party and writes no storage",
    );
    await ctx.close();
  }

  // 8b. A button in published content can't act as the banner (CN-R4: only an explicit choice is consent).
  {
    const { ctx, external } = await context();
    const page = await ctx.newPage();
    await page.goto(`${origin}/en/about/`, { waitUntil: "networkidle" });
    await page.$eval("article button", (button) => button.click());
    await settle(page);
    assert.equal(await cookieState(ctx), null);
    assert.equal(await page.isVisible("#gq-consent-banner"), true);
    assert.deepEqual(external(), []);
    pass(
      ["CN-R4", "CN-R3"],
      "a consent hook forged in WordPress HTML is neutralised: clicking it records and grants nothing",
    );
    await ctx.close();
  }

  // 9. CN-C1: no optional service, no banner, no record; the settings control remains.
  {
    const start = records().length;
    const { ctx, external } = await context();
    const page = await ctx.newPage();
    await page.goto(`${origin}/necessary-only/`, { waitUntil: "networkidle" });
    assert.equal(await page.$("#gq-consent-banner"), null);
    await page.click("footer [data-gq-consent-open]");
    assert.equal(await page.isVisible("#gq-consent-preferences"), true);
    assert.equal(await page.$("#gq-consent-preferences input"), null);
    assert.ok((await page.textContent("#gq-consent-preferences")).includes("gq_consent"));
    assert.equal(records().length, start);
    assert.deepEqual(external(), []);
    pass(
      ["CN-C1", "CN-R6"],
      "without optional services no banner or record; Cookie settings lists necessary storage",
    );
    await ctx.close();
  }

  // 10. LEGAL-1: links in the right language in raw HTML with the banner open; legal pages readable.
  for (const [route, expected] of [
    [
      "/",
      {
        privacy_policy: "/privacidade/",
        cookie_policy: "/cookies/",
        complaints_book: "https://www.livroreclamacoes.pt/",
      },
    ],
    [
      "/sobre/",
      {
        privacy_policy: "/privacidade/",
        cookie_policy: "/cookies/",
        complaints_book: "https://www.livroreclamacoes.pt/",
      },
    ],
    [
      "/en/",
      {
        privacy_policy: "/privacidade/",
        cookie_policy: "/en/cookies/",
        complaints_book: "https://www.livroreclamacoes.pt/",
      },
    ],
    [
      "/en/about/",
      {
        privacy_policy: "/privacidade/",
        cookie_policy: "/en/cookies/",
        complaints_book: "https://www.livroreclamacoes.pt/",
      },
    ],
  ]) {
    const html = await (await fetch(`${origin}${route}`)).text();
    assert.ok(
      /<section id="gq-consent-banner"[^>]*>/.exec(html)[0].indexOf("hidden") < 0,
      "banner open",
    );
    const links = Object.fromEntries(
      [...html.matchAll(/<a href="([^"]+)" data-gq-legal-role="([a-z_]+)">/g)].map((m) => [
        m[2],
        m[1],
      ]),
    );
    assert.deepEqual(links, expected, route);
    assert.ok(
      html.includes(`class="gq-consent-banner__policy"`),
      "the banner links the cookie policy",
    );
    assert.ok(html.includes("data-gq-consent-open"));
    const english = route.startsWith("/en/");
    assert.ok(html.includes(english ? ">Cookie settings<" : ">Definições de cookies<"));
  }
  {
    const { ctx } = await context();
    const page = await ctx.newPage();
    await page.goto(`${origin}/`, { waitUntil: "networkidle" });
    await page.click("footer a[data-gq-legal-role='privacy_policy']");
    await page.waitForURL(`${origin}/privacidade/`);
    assert.equal(await page.isVisible("#gq-consent-banner"), true);
    assert.equal(await page.textContent("article"), "Texto legal.");
    await ctx.close();
  }
  pass(
    ["LG-R4", "LG-R5", "LG-R6", "LG-R2"],
    "translated and untranslated routes link every role in their language (fallback for the untranslated privacy policy) with the banner open, from stored chrome with the CMS unreachable; legal pages are reachable and readable with the banner open",
  );
} finally {
  await browser.close();
  if (process.env.CONSENT_EVIDENCE)
    writeFileSync(process.env.CONSENT_EVIDENCE, JSON.stringify(evidence, null, 2));
}
