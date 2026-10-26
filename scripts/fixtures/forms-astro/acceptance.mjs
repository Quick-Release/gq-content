// Headless Gravity Forms acceptance (ADR 0009) in the installed consumer: a
// stand-in for the CMS's Gravity Forms REST API records what reaches it; the
// Astro Site is built for Cloudflare Workers and served by workerd (astro
// preview); Chromium visits it without JavaScript, and Turnstile is verified
// with Cloudflare's real siteverify and test keys. Evidence: FORMS_EVIDENCE.
import { execFileSync } from "node:child_process";
import { readdirSync, readFileSync, statSync, writeFileSync } from "node:fs";
import { createServer } from "node:http";
import { join } from "node:path";
import { chromium } from "playwright";
import {
  CONTACT_FORM,
  UNSUPPORTED_FORM,
  TURNSTILE_TEST_KEYS,
  assertAccessibleForm,
  assertNoEntryReadsOrCredentials,
  contactSubmission,
  formBody,
  gravityFormsStub,
} from "@getquick/content/forms/testing";

const checks = [];
function check(name, ok, detail) {
  checks.push({ name, ok: Boolean(ok), ...(detail === undefined ? {} : { detail }) });
  console.log(
    `${ok ? "PASS" : "FAIL"} ${name}${ok || detail === undefined ? "" : `: ${JSON.stringify(detail)}`}`,
  );
}
const freePort = () =>
  new Promise((done) => {
    const probe = createServer().listen(0, "127.0.0.1", () => {
      const { port } = probe.address();
      probe.close(() => done(port));
    });
  });

// The CMS: Gravity Forms' REST submissions endpoint for the fixture's forms.
const stub = gravityFormsStub([
  CONTACT_FORM,
  UNSUPPORTED_FORM,
  { ...CONTACT_FORM, id: 4 },
  { ...CONTACT_FORM, id: 5 },
]);
const cms = createServer(async (incoming, outgoing) => {
  const chunks = [];
  for await (const chunk of incoming) chunks.push(chunk);
  const request = new Request(`http://${incoming.headers.host}${incoming.url}`, {
    method: incoming.method,
    headers: Object.entries(incoming.headers).flatMap(([key, value]) =>
      typeof value === "string" ? [[key, value]] : [],
    ),
    ...(chunks.length ? { body: Buffer.concat(chunks) } : {}),
  });
  const response = await stub.handle(request);
  outgoing.writeHead(response.status, Object.fromEntries(response.headers));
  outgoing.end(Buffer.from(await response.arrayBuffer()));
});
const cmsPort = await freePort();
await new Promise((done) => cms.listen(cmsPort, "127.0.0.1", done));
const cmsOrigin = `http://127.0.0.1:${cmsPort}`;

const run = (command, args) => execFileSync(command, args, { stdio: "inherit", timeout: 600000 });
writeFileSync(
  "wrangler.jsonc",
  JSON.stringify({
    name: "forms-acceptance",
    compatibility_date: "2026-10-19",
    vars: { CMS_ORIGIN: cmsOrigin },
  }),
);
run("node_modules/.bin/astro", ["build"]);

// The Worker bundle imports the forms exports only: no content or consent runtime.
const bundled = [];
const walk = (dir) => {
  for (const name of readdirSync(dir)) {
    const path = join(dir, name);
    if (statSync(path).isDirectory()) walk(path);
    else if (/\.m?js$/.test(name)) bundled.push(readFileSync(path, "utf8"));
  }
};
walk("dist/server");
const markers = [
  "createContentRuntime",
  "PUBLICATION_DB",
  "publication_events",
  "consent_records",
  "createConsentServer",
  "CONSENT_DB",
];
const found = markers.filter((marker) => bundled.some((code) => code.includes(marker)));
check(
  "the Astro Worker bundle carries neither the publication nor the consent runtime",
  found.length === 0,
  found,
);
check(
  "the Worker bundle holds the forms handler",
  bundled.some((code) => code.includes("/gf/v2/forms/")),
);

const port = await freePort();
const origin = `http://127.0.0.1:${port}`;
run("node_modules/.bin/astro", ["preview", "--port", String(port)]);
let browser;
try {
  for (let attempt = 0; ; attempt++) {
    try {
      if ((await fetch(`${origin}/contactos/`)).ok) break;
    } catch {
      // Not listening yet.
    }
    if (attempt > 200) throw new Error("The Astro Worker didn't start");
    await new Promise((done) => setTimeout(done, 100));
  }
  browser = await chromium.launch();
  const context = await browser.newContext({ javaScriptEnabled: false });
  const page = await context.newPage();
  const requested = [];
  page.on("request", (request) => requested.push(request.url()));

  // Rendering: from the descriptor alone, no CMS request or credential.
  await page.goto(`${origin}/contactos/`);
  const html = await page.content();
  let accessible = true;
  try {
    assertAccessibleForm(html);
  } catch (error) {
    accessible = error.message;
  }
  check(
    "the rendered form is accessible: labels, descriptions, required marks",
    accessible === true,
    accessible,
  );
  check(
    "rendering made no CMS request and loaded nothing from another origin",
    stub.requests.length === 0 && requested.every((url) => url.startsWith(origin)),
    requested,
  );
  check(
    "the consent links to LEGAL-1's privacy policy",
    (await page.locator(".gq-form__field--consent a.gq-form__policy").getAttribute("href")) ===
      "/politica-de-privacidade/",
  );

  // Without JavaScript: an empty post comes back with accessible errors.
  await page.locator("button[type=submit]").click();
  await page.waitForURL(/gq-form=1/);
  const summary = page.locator('.gq-form__errors[role="alert"]');
  check(
    "an invalid post returns to the page with an error summary (no JavaScript)",
    await summary.isVisible(),
  );
  check(
    "each invalid field is marked and described by its error",
    (await page.locator("#gq-form-1-input_2").getAttribute("aria-invalid")) === "true" &&
      (await page.locator("#gq-form-1-input_2").getAttribute("aria-describedby")) ===
        "gq-form-1-field-2-error" &&
      (await page.locator("#gq-form-1-field-2-error").innerText()).includes("obrigatório"),
  );
  check(
    "an invalid post created no entry and reached no CMS",
    stub.entries.length === 0 && stub.requests.length === 0,
  );

  // A valid post creates one entry through Gravity Forms and shows its confirmation.
  await page.fill("#gq-form-1-input_1_3", "Ana");
  await page.fill("#gq-form-1-input_1_6", "Silva");
  await page.fill("#gq-form-1-input_2", "ana@example.com");
  await page.fill("#gq-form-1-input_4", "Olá, gostava de saber mais.");
  await page.check("#gq-form-1-input_5_1");
  await page.locator("button[type=submit]").click();
  await page.waitForSelector(".gq-form__status--sent");
  check(
    "a valid post shows Gravity Forms' confirmation as a status message (no JavaScript)",
    (await page.locator('.gq-form__status--sent[role="status"]').innerText()).trim() ===
      "Obrigado pelo seu contacto.",
  );
  check(
    "it created one entry, with the descriptor's consent text",
    stub.entries.length === 1 &&
      stub.entries[0].values.input_5_2 === CONTACT_FORM.fields[4].consent.checkboxLabel &&
      stub.entries[0].values.input_6 === "",
  );
  let credentials = true;
  try {
    assertNoEntryReadsOrCredentials(stub.requests);
  } catch (error) {
    credentials = error.message;
  }
  check(
    "the submission used Gravity Forms' REST submissions endpoint without a credential",
    credentials === true &&
      stub.requests.every((each) => each.url === "/wp-json/gf/v2/forms/1/submissions"),
    credentials,
  );
  await page.reload();
  check(
    "the outcome is shown once: the page clears it",
    (await page.locator(".gq-form__status--sent").count()) === 0,
  );

  // A bot that fills the honeypot is told it was sent; no entry is created.
  await page.goto(`${origin}/contactos/`);
  await page.fill("#gq-form-1-input_1_3", "Bot");
  await page.fill("#gq-form-1-input_1_6", "Bot");
  await page.fill("#gq-form-1-input_2", "bot@example.com");
  await page.fill("#gq-form-1-input_4", "spam");
  await page.check("#gq-form-1-input_5_1");
  await page.locator("#gq-form-1-input_6").fill("https://spam.example", { force: true });
  const before = stub.requests.length;
  await page.locator("button[type=submit]").click();
  await page.waitForSelector(".gq-form__status--sent");
  check(
    "a honeypot-filled post creates no entry",
    stub.entries.length === 1 && stub.requests.length === before,
  );

  // The handler refuses cross-origin, oversize and descriptor-invalid posts.
  const post = (path, values, headers = {}, body) =>
    fetch(`${origin}${path}`, {
      method: "POST",
      redirect: "manual",
      headers: { Origin: origin, "Content-Type": "application/x-www-form-urlencoded", ...headers },
      body: body ?? formBody(values),
    });
  const cross = await post("/gq/forms/1", contactSubmission(), { Origin: "https://evil.test" });
  const oversize = await post("/gq/forms/1", {}, {}, "input_4=" + "x".repeat(70 * 1024));
  const invalid = await post("/gq/forms/1", { ...contactSubmission(), input_2: "nope" });
  const unsupported = await post("/gq/forms/2", { ...contactSubmission("/candidatura/") });
  check("a cross-origin post is refused", cross.status === 403, cross.status);
  check("an oversize post is refused", oversize.status === 413, oversize.status);
  check(
    "a descriptor-invalid post is answered with its errors",
    invalid.status === 303 && /gq-form-1=/.test(invalid.headers.get("set-cookie") ?? ""),
    invalid.status,
  );
  check("an unsupported form is never submitted", unsupported.status === 303);
  check(
    "none of them reached the CMS",
    stub.requests.length === before && stub.entries.length === 1,
  );

  // Turnstile, verified with Cloudflare's siteverify and its test keys.
  const token = { "cf-turnstile-response": TURNSTILE_TEST_KEYS.dummyToken };
  const passing = await post("/gq/forms/4", { ...contactSubmission("/turnstile/"), ...token });
  const passed = await fetch(`${origin}${passing.headers.get("location")}`, {
    headers: { Cookie: (passing.headers.get("set-cookie") ?? "").split(";")[0] },
  }).then((response) => response.text());
  check(
    "with Turnstile, a token Cloudflare verifies (always-passing secret) is submitted",
    passed.includes("gq-form__status--sent") &&
      stub.entries.length === 2 &&
      stub.entries[1].formId === 4,
  );
  const failing = await post("/gq/forms/5", {
    ...contactSubmission("/turnstile-falha/"),
    ...token,
  });
  const failed = await fetch(`${origin}${failing.headers.get("location")}`, {
    headers: { Cookie: (failing.headers.get("set-cookie") ?? "").split(";")[0] },
  }).then((response) => response.text());
  check(
    "with Turnstile, a token Cloudflare rejects (always-failing secret) creates no entry",
    failed.includes("gq-form__errors") && stub.entries.length === 2,
  );
  const missing = await post("/gq/forms/4", contactSubmission("/turnstile/"));
  check(
    "with Turnstile, a post without a token creates no entry",
    missing.status === 303 && stub.entries.length === 2,
  );

  // CONSENT-1 (CN-R3): Turnstile loads on interaction with the form, not with the page.
  const scripted = await browser.newContext();
  const visit = await scripted.newPage();
  const loaded = [];
  visit.on("request", (request) => loaded.push(request.url()));
  await visit.goto(`${origin}/turnstile/`);
  await visit.waitForTimeout(500);
  const beforeInteraction = loaded.filter((url) => !url.startsWith(origin));
  await visit.focus("#gq-form-4-input_2");
  await visit.waitForRequest(
    (request) => request.url().startsWith("https://challenges.cloudflare.com/"),
    { timeout: 15000 },
  );
  check(
    "Turnstile loads only once the visitor interacts with the form",
    beforeInteraction.length === 0,
    beforeInteraction,
  );
} finally {
  await browser?.close();
  try {
    run("node_modules/.bin/astro", ["preview", "stop"]);
  } finally {
    cms.close();
  }
}

writeFileSync(
  process.env.FORMS_EVIDENCE ?? "forms-acceptance.json",
  JSON.stringify(
    {
      checks,
      entries: stub.entries.length,
      cmsRequests: stub.requests.map((each) => ({
        method: each.method,
        url: each.url,
        authorization: Boolean(each.headers.authorization),
      })),
    },
    null,
    2,
  ) + "\n",
);
const failures = checks.filter((each) => !each.ok);
if (failures.length) {
  console.error(`${failures.length} forms acceptance check(s) failed`);
  process.exit(1);
}
console.log(`Headless Gravity Forms acceptance: ${checks.length} checks passed.`);
