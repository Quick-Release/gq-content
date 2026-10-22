// The TanStack Start commerce consumer (#28): with no interaction nothing
// third-party loads and no storage is written; Reject all sets the consent
// cookie through the neutral core and appends one record through the
// installed record endpoint; the banner stays closed afterwards.
import assert from "node:assert/strict";
import { writeFileSync } from "node:fs";
import { DatabaseSync } from "node:sqlite";
import { chromium } from "playwright";
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
  const rows = new DatabaseSync(`${process.env.CONSENT_FIXTURE_DATA}/consent.sqlite`, {
    readOnly: true,
  })
    .prepare("SELECT consent_id, action, analytics, site_id FROM consent_records")
    .all();
  assert.deepEqual(
    rows.map((row) => ({ ...row })),
    [{ consent_id: after.consent.consentId, action: "reject_all", analytics: 0, site_id: "shop" }],
  );
  evidence.push({
    criteria: ["CN-R1", "CN-R7", "CN-R8", "CN-C2"],
    detail:
      "TanStack Start SSR consumer: no third-party request or storage before a decision; Reject all sets the cookie and appends one record via the installed endpoint",
  });
  console.log(`PASS ${evidence[0].criteria.join(", ")}: ${evidence[0].detail}`);
} finally {
  await browser.close();
  if (process.env.CONSENT_EVIDENCE)
    writeFileSync(process.env.CONSENT_EVIDENCE, JSON.stringify(evidence, null, 2));
}
