// The TanStack Start commerce consumer (#28): with no interaction nothing
// third-party loads and no storage is written; Reject all sets the consent
// cookie through the neutral core and appends one record through the
// installed record endpoint; the banner stays closed afterwards.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
import { readConsentCookie } from "@getquick/content/consent";
import { capture, scanConsentHtml } from "@getquick/content/consent/testing";

const origin = process.env.CONSENT_ORIGIN;
const site = { siteOrigin: origin };
const evidence = [];
const browser = await chromium.launch();
try {
  const html = await (await fetch(`${origin}/`)).text();
  assert.deepEqual(scanConsentHtml(html, site).liveThirdParty, []);
  const context = await browser.newContext();
  await context.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
  const page = await context.newPage();
  const first = await capture(context, page, "/", site);
  assert.deepEqual(
    [first.thirdParty, first.cookies, first.localStorage, first.sessionStorage],
    [[], [], [], []],
  );
  await page.waitForSelector("#gq-consent-banner");
  await page.click("[data-gq-consent-reject-all]");
  await page.waitForTimeout(500);
  const after = await capture(context, await context.newPage(), "/", site);
  assert.ok(after.consent && Object.values(after.consent.decisions).every((value) => !value));
  assert.deepEqual(after.thirdParty, []);
  assert.equal(await (await context.pages()).at(-1).$("#gq-consent-banner"), null);
  // The default HTML UI is present in SSR, with no framework dependency.
  const htmlResponse = await (await fetch(`${origin}/html`)).text();
  assert.match(htmlResponse, /id="gq-consent-config"/);
  assert.match(htmlResponse, /data-gq-consent-reject-all/);
  assert.deepEqual(scanConsentHtml(htmlResponse, site).liveThirdParty, []);
  const htmlContext = await browser.newContext();
  await htmlContext.route(
    (url) => url.origin !== origin,
    (route) => route.abort(),
  );
  const htmlPage = await htmlContext.newPage();
  await htmlPage.goto(`${origin}/html`);
  await htmlPage.waitForFunction(() => Boolean(window.__gqConsent));
  await htmlPage.evaluate(() => {
    window.navigationSentinel = "same document";
  });
  await htmlPage.getByRole("link", { name: "Back to shop" }).click();
  await htmlPage.getByRole("link", { name: "HTML consent" }).click();
  await htmlPage.waitForSelector("[data-gq-consent-reject-all]");
  assert.equal(await htmlPage.evaluate(() => window.navigationSentinel), "same document");
  const written = htmlPage.waitForResponse(
    (response) =>
      response.url() === `${origin}/gq/consent` && response.request().method() === "POST",
  );
  await htmlPage.click("[data-gq-consent-reject-all]");
  assert.equal((await written).status(), 201);
  await htmlPage.waitForFunction(() => document.getElementById("gq-consent-banner")?.hidden);
  await htmlPage.getByRole("link", { name: "Back to shop" }).click();
  await htmlPage.getByRole("link", { name: "HTML consent" }).click();
  await htmlPage.waitForFunction(() => document.getElementById("gq-consent-banner")?.hidden);
  const htmlState = readConsentCookie(await htmlPage.evaluate(() => document.cookie));
  assert.ok(htmlState);
  assert.notEqual(htmlState.consentId, after.consent.consentId);
  await htmlContext.close();
  const rows = new DatabaseSync(`${process.env.CONSENT_FIXTURE_DATA}/consent.sqlite`, {
    readOnly: true,
  })
    .prepare("SELECT consent_id, action, analytics, site_id FROM consent_records")
    .all();
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [
      { consent_id: after.consent.consentId, action: "reject_all", analytics: 0, site_id: "shop" },
      { consent_id: htmlState.consentId, action: "reject_all", analytics: 0, site_id: "shop" },
    ],
  );
  evidence.push({
    criteria: ["HTML-SSR", "HTML-NAVIGATION"],
    detail:
      "Neutral HTML UI renders on Start SSR; client navigation retains the document, repeated startConsent binds once, one rejection writes one record and remains in force after remount",
  });
  evidence.push({
    criteria: ["CN-R1", "CN-R7", "CN-R8", "CN-C2"],
    detail:
      "TanStack Start SSR consumer: no third-party request or storage before a decision; Reject all sets the cookie and appends one record via the installed endpoint",
  });
  for (const item of evidence) console.log(`PASS ${item.criteria.join(", ")}: ${item.detail}`);
} finally {
  await browser.close();
  if (process.env.CONSENT_EVIDENCE)
    writeFileSync(process.env.CONSENT_EVIDENCE, JSON.stringify(evidence, null, 2));
}
