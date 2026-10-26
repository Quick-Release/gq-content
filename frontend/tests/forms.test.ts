// Headless Gravity Forms (ADR 0009): the public descriptor, submission
// validation and readiness (/forms), the renderer (/forms/astro), the form
// endpoint against a stand-in for Gravity Forms' REST submissions endpoint
// (/forms/server) and the shared fixtures and assertions (/forms/testing).
// The browser, no-JavaScript and Turnstile test-key proofs against the packed
// package are scripts/forms-acceptance.mjs.
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import * as forms from "@getquick/content/forms";
import * as formsAstro from "@getquick/content/forms/astro";
import * as formsServer from "@getquick/content/forms/server";
import * as formsTesting from "@getquick/content/forms/testing";
import {
  formsReadiness,
  parseFormDescriptor,
  parseFormDescriptors,
  readFormState,
  validateSubmission,
  type FormDescriptor,
} from "@getquick/content/forms";
import { renderGravityForm } from "@getquick/content/forms/astro";
import { createFormsServer, type FormsBindings } from "@getquick/content/forms/server";
import {
  CONTACT_FORM,
  TURNSTILE_TEST_KEYS,
  UNAVAILABLE_FORM,
  UNSUPPORTED_FORM,
  assertAccessibleForm,
  assertNoEntryExports,
  assertNoEntryReadsOrCredentials,
  assertPublicDescriptor,
  contactSubmission,
  formBody,
  gravityFormsStub,
} from "@getquick/content/forms/testing";

const SITE = "https://www.acme.test";
const CMS = "https://cms.acme.test";
const legal = {
  roles: [{ role: "privacy_policy", url: "/politica-de-privacidade/", title: "Privacidade" }],
};

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

function setup(
  options: {
    forms?: FormDescriptor[];
    bindings?: FormsBindings;
    turnstile?: boolean;
    siteverify?: (body: URLSearchParams) => unknown;
  } = {},
) {
  const descriptors = options.forms ?? [CONTACT_FORM, UNSUPPORTED_FORM, UNAVAILABLE_FORM];
  const stub = gravityFormsStub(descriptors);
  const cmsFetch = stub.fetchFor(CMS);
  const verifications: URLSearchParams[] = [];
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === formsServer.TURNSTILE_SITEVERIFY_URL) {
      const body = new URLSearchParams(await request.text());
      verifications.push(body);
      return Response.json(options.siteverify?.(body) ?? { success: false });
    }
    return cmsFetch(request);
  };
  const lookups: Array<{ formId: number; source: string }> = [];
  const server = createFormsServer({
    cmsOrigin: CMS,
    descriptor: (lookup) => {
      lookups.push(lookup);
      return descriptors.find((each) => each.id === lookup.formId) ?? null;
    },
    spam: { turnstile: options.turnstile ?? false },
    bindings: () => options.bindings ?? {},
    language: "pt-PT",
    fetch,
  });
  return { server, stub, verifications, lookups };
}

function post(
  values: Record<string, string>,
  options: { formId?: number; headers?: Record<string, string>; body?: string } = {},
) {
  return new Request(`${SITE}/gq/forms/${options.formId ?? 1}`, {
    method: "POST",
    headers: {
      Origin: SITE,
      "Sec-Fetch-Site": "same-origin",
      "Content-Type": "application/x-www-form-urlencoded",
      ...options.headers,
    },
    body: options.body ?? formBody(values),
  });
}

/** Follows the redirect back as the browser does: the page's URL and the cookie it carries. */
function landing(response: Response) {
  const location = response.headers.get("Location")!;
  const cookie = response.headers.get("Set-Cookie")!.split(";")[0]!;
  return { url: new URL(location, SITE), cookie };
}

test("a descriptor keeps only public form data; notifications, entries and feeds never parse through", () => {
  const delivered = {
    ...CONTACT_FORM,
    notifications: [{ to: "admin@acme.test" }],
    feeds: [{ addon: "mailchimp" }],
    entries: [{ id: 1 }],
    fields: [{ ...CONTACT_FORM.fields[1], adminLabel: "secret", personalData: { exportable: 1 } }],
  };
  const parsed = parseFormDescriptor(delivered)!;
  expect(Object.keys(parsed).sort()).toEqual(
    [
      "available",
      "confirmation",
      "description",
      "diagnostics",
      "fields",
      "honeypot",
      "id",
      "schema",
      "submitLabel",
      "title",
    ].sort(),
  );
  expect(JSON.stringify(parsed)).not.toMatch(/notifications|feeds|entries|adminLabel|personalData/);
  expect(() => assertPublicDescriptor(delivered)).toThrow(/notifications.*feeds.*entries/s);
  expect(assertPublicDescriptor(parsed)).toEqual(parsed);
  for (const fixture of [CONTACT_FORM, UNSUPPORTED_FORM, UNAVAILABLE_FORM])
    expect(assertPublicDescriptor(JSON.parse(JSON.stringify(fixture)))).toEqual(fixture);
  expect(parseFormDescriptor({ ...CONTACT_FORM, schema: 2 })).toBeNull();
  expect(parseFormDescriptors(JSON.stringify([CONTACT_FORM, { id: "x" }]))).toEqual([CONTACT_FORM]);
  expect(parseFormDescriptors(null)).toBeUndefined();
});

test("readiness fails for an unavailable form and each unsupported field, and names the spam controls", () => {
  const readiness = formsReadiness([CONTACT_FORM, UNSUPPORTED_FORM, UNAVAILABLE_FORM], {
    spam: ["honeypot"],
  });
  expect(readiness.ok).toBe(false);
  expect(readiness.forms.map((form) => [form.id, form.ok])).toEqual([
    [1, true],
    [2, false],
    [3, false],
  ]);
  expect(readiness.forms[1]!.diagnostics.map((each) => each.code)).toEqual([
    "unsupported-captcha",
    "unsupported-file-upload",
    "unsupported-payment",
    "unsupported-multi-page",
  ]);
  expect(readiness.forms[2]!.diagnostics[0]!.code).toBe("unavailable");
  expect(readiness.forms[0]!.honeypot).toBe(true);
  expect(readiness.warnings).toEqual(["Form 3 doesn't enable Gravity Forms' anti-spam honeypot."]);
  expect(formsReadiness([CONTACT_FORM]).ok).toBe(true);
});

test("a submission is checked against the descriptor, and only its inputs are kept", () => {
  const valid = validateSubmission(
    CONTACT_FORM,
    new URLSearchParams({ ...contactSubmission(), input_99: "injected", input_5_2: "forged" }),
  );
  expect(valid.errors).toEqual({});
  expect(valid.input).toEqual({
    input_1_3: "Ana",
    input_1_6: "Silva",
    input_2: "ana@example.com",
    input_3: "Pergunta",
    input_4: "Olá, gostava de saber mais.",
    input_5_1: "1",
    // The consent's text and revision come from the descriptor, not the visitor.
    input_5_2: CONTACT_FORM.fields[4]!.consent!.checkboxLabel,
    input_5_3: "7",
    input_6: "",
  });
  const invalid = validateSubmission(
    CONTACT_FORM,
    new URLSearchParams({ input_1_3: "Ana", input_2: "not-an-email", input_3: "x".repeat(121) }),
  );
  expect(invalid.errors).toEqual({
    1: "required",
    2: "email",
    3: "too-long",
    4: "required",
    5: "required",
  });
  expect(invalid.values).toMatchObject({ input_1_3: "Ana", input_2: "not-an-email" });
});

test("the renderer emits an accessible plain HTML form posting to the Site, with no CMS request", () => {
  const html = renderGravityForm({
    descriptor: CONTACT_FORM,
    source: "/contactos/",
    language: "pt-PT",
    legal,
  });
  assertAccessibleForm(html);
  expect(html).toContain(
    '<form class="gq-form__form" method="post" action="/gq/forms/1" novalidate',
  );
  expect(html).toContain('<input type="hidden" name="gq_source" value="/contactos/">');
  expect(html).not.toContain("cms.acme.test");
  expect(html).not.toMatch(/<script|<link|<iframe|gform_/);
  // The consent links to LEGAL-1's privacy policy.
  expect(html).toMatch(
    /<label for="gq-form-1-input_5_1">Aceito o tratamento[^<]*<\/label> <a class="gq-form__policy" href="\/politica-de-privacidade\/">Privacidade<\/a>/,
  );
  // Gravity Forms' honeypot is passed through, out of sight and out of the tab order.
  expect(html).toMatch(
    /<div class="gq-form__hp" aria-hidden="true"[^>]*>.*name="input_6" value="" tabindex="-1"/,
  );
  expect(html).toContain('autocomplete="given-name"');
  expect(html).toContain("Os campos assinalados com * são obrigatórios.");

  const unavailable = renderGravityForm({
    descriptor: UNAVAILABLE_FORM,
    source: "/",
    language: "en",
  });
  expect(unavailable).toContain('role="status">This form isn&#39;t available.');
  expect(unavailable).not.toContain("<form");
  expect(renderGravityForm({ descriptor: null, source: "/", language: "en" })).not.toContain(
    "<form",
  );

  const escaped = renderGravityForm({
    descriptor: { ...CONTACT_FORM, title: '<img src=x onerror="alert(1)">' },
    source: '/"><script>',
    language: "en",
  });
  expect(escaped).not.toMatch(/<img|<script/);
});

test("Turnstile is only rendered for a Site that uses it, and loads on interaction", () => {
  const html = renderGravityForm({
    descriptor: CONTACT_FORM,
    source: "/contactos/",
    language: "en",
    turnstile: { siteKey: TURNSTILE_TEST_KEYS.passingSiteKey },
  });
  expect(html).toContain(`data-gq-turnstile="${TURNSTILE_TEST_KEYS.passingSiteKey}"`);
  expect(html).toContain("<noscript>");
  // The widget's script isn't in the page: only a loader that adds it on focus or pointer.
  expect(html).not.toMatch(/<script[^>]+src=/);
  expect(html).toMatch(/addEventListener\("focusin"/);
});

test("the endpoint refuses cross-origin, oversize, non-form and malformed posts before any CMS request", async () => {
  const { server, stub } = setup();
  const statuses = await Promise.all([
    server.handle(post(contactSubmission(), { headers: { Origin: "https://evil.test" } })),
    server.handle(post(contactSubmission(), { headers: { "Sec-Fetch-Site": "cross-site" } })),
    server.handle(
      new Request(`${SITE}/gq/forms/1`, {
        method: "POST",
        headers: { "Content-Type": "application/x-www-form-urlencoded" },
        body: formBody(contactSubmission()),
      }),
    ),
    server.handle(post({}, { body: "input_4=" + "x".repeat(formsServer.MAX_FORM_BYTES) })),
    server.handle(post({}, { headers: { "Content-Type": "application/json" }, body: "{}" })),
    server.handle(post({ ...contactSubmission(), gq_source: "https://evil.test/" })),
    server.handle(new Request(`${SITE}/gq/forms/1`)),
  ]);
  expect(statuses.map((response) => response?.status)).toEqual([403, 403, 403, 413, 415, 400, 405]);
  expect(await server.handle(new Request(`${SITE}/gq/forms/abc`, { method: "POST" }))).toBeNull();
  expect(await server.handle(new Request(`${SITE}/other`, { method: "POST" }))).toBeNull();
  expect(stub.requests).toEqual([]);
});

test("a valid post creates one entry through the submissions endpoint, without any credential", async () => {
  const { server, stub, lookups } = setup();
  const response = (await server.handle(post(contactSubmission())))!;
  expect(response.status).toBe(303);
  expect(lookups).toEqual([{ formId: 1, source: "/contactos/" }]);
  expect(stub.entries).toHaveLength(1);
  expect(stub.entries[0]!.spam).toBe(false);
  expect(stub.requests).toHaveLength(1);
  expect(stub.requests[0]).toMatchObject({
    method: "POST",
    url: "/wp-json/gf/v2/forms/1/submissions",
  });
  expect(stub.requests[0]!.headers["content-type"]).toBe("application/json");
  assertNoEntryReadsOrCredentials(stub.requests);

  // Post/redirect/get: back to the form on its page, which shows the confirmation.
  const { url, cookie } = landing(response);
  expect(`${url.pathname}${url.search}${url.hash}`).toBe("/contactos/?gq-form=1#gq-form-1");
  expect(response.headers.get("Set-Cookie")).toMatch(/HttpOnly; SameSite=Lax; Secure$/);
  const state = readFormState({ url, cookie }, 1);
  expect(state).toMatchObject({ status: "sent", confirmation: "Obrigado pelo seu contacto." });
  const html = renderGravityForm({
    descriptor: CONTACT_FORM,
    source: "/contactos/",
    language: "pt-PT",
    state,
  });
  assertAccessibleForm(html);
  expect(html).toContain(
    '<div class="gq-form__status gq-form__status--sent" role="status"><p>Obrigado pelo seu contacto.</p></div>',
  );
  // Elsewhere, or on the page without the redirect's marker, there's no outcome.
  expect(readFormState({ url: `${SITE}/contactos/`, cookie }, 1)).toBeNull();
  expect(readFormState({ url, cookie }, 2)).toBeNull();
});

test("an invalid post is answered with its errors and values, and reaches no CMS", async () => {
  const { server, stub } = setup();
  const response = (await server.handle(
    post({ ...contactSubmission(), input_2: "nope", input_5_1: "" }),
  ))!;
  expect(response.status).toBe(303);
  expect(stub.requests).toEqual([]);
  const { url, cookie } = landing(response);
  const state = readFormState({ url, cookie }, 1)!;
  expect(state).toMatchObject({ status: "invalid", errors: { 2: "email", 5: "required" } });
  const html = renderGravityForm({
    descriptor: CONTACT_FORM,
    source: "/contactos/",
    language: "pt-PT",
    state,
  });
  assertAccessibleForm(html);
  expect(html).toContain('<div class="gq-form__errors" role="alert"');
  expect(html).toContain(
    '<a href="#gq-form-1-input_2">Email: Introduza um endereço de email válido.</a>',
  );
  expect(html).toMatch(
    /id="gq-form-1-input_2" name="input_2" value="nope"[^>]*aria-describedby="gq-form-1-field-2-error" aria-invalid="true"/,
  );
  expect(html).toContain(">Olá, gostava de saber mais.</textarea>");
  expect(html).not.toMatch(/name="input_5_1" value="1" checked/);
});

test("Gravity Forms' own validation messages come back as field errors", async () => {
  // The descriptor says the subject is optional; Gravity Forms requires it.
  const strict = {
    ...CONTACT_FORM,
    fields: CONTACT_FORM.fields.map((field) =>
      field.id === 3 ? { ...field, required: true } : field,
    ),
  };
  const stub = gravityFormsStub([strict]);
  const server = createFormsServer({
    cmsOrigin: CMS,
    descriptor: () => CONTACT_FORM,
    bindings: () => ({}),
    fetch: stub.fetchFor(CMS),
  });
  const response = (await server.handle(post({ ...contactSubmission(), input_3: "" })))!;
  const state = readFormState(landing(response), 1)!;
  expect(state).toMatchObject({ status: "invalid", messages: { 3: "This field is required." } });
  expect(stub.entries).toEqual([]);
  const json = (await server.handle(
    post({ ...contactSubmission(), input_3: "" }, { headers: { Accept: "application/json" } }),
  ))!;
  expect(json.status).toBe(422);
  expect(await json.json()).toEqual({
    status: "invalid",
    errors: { 3: "This field is required." },
  });
});

test("a filled honeypot is answered as sent and creates no entry", async () => {
  const { server, stub } = setup();
  const response = (await server.handle(post({ ...contactSubmission(), input_6: "http://spam" })))!;
  expect(readFormState(landing(response), 1)?.status).toBe("sent");
  expect(stub.requests).toEqual([]);
  expect(stub.entries).toEqual([]);
});

test("with Turnstile, a token is verified server-side and a failed one creates no entry", async () => {
  const passing = setup({
    turnstile: true,
    bindings: { TURNSTILE_SECRET_KEY: TURNSTILE_TEST_KEYS.passingSecretKey },
    siteverify: () => ({ success: true }),
  });
  const ok = (await passing.server.handle(
    post(
      { ...contactSubmission(), "cf-turnstile-response": TURNSTILE_TEST_KEYS.dummyToken },
      { headers: { "CF-Connecting-IP": "203.0.113.9" } },
    ),
  ))!;
  expect(readFormState(landing(ok), 1)?.status).toBe("sent");
  expect(passing.stub.entries).toHaveLength(1);
  expect(Object.fromEntries(passing.verifications[0]!)).toEqual({
    secret: TURNSTILE_TEST_KEYS.passingSecretKey,
    response: TURNSTILE_TEST_KEYS.dummyToken,
    remoteip: "203.0.113.9",
  });
  // The token never reaches the CMS.
  expect(JSON.stringify(passing.stub.requests[0]!.body)).not.toContain("DUMMY");

  const failing = setup({
    turnstile: true,
    bindings: { TURNSTILE_SECRET_KEY: TURNSTILE_TEST_KEYS.failingSecretKey },
    siteverify: () => ({ success: false, "error-codes": ["invalid-input-response"] }),
  });
  for (const values of [
    { ...contactSubmission(), "cf-turnstile-response": TURNSTILE_TEST_KEYS.dummyToken },
    contactSubmission(),
  ]) {
    const refused = (await failing.server.handle(post(values)))!;
    expect(readFormState(landing(refused), 1)?.status).toBe("verification");
  }
  expect(failing.verifications).toHaveLength(1);
  expect(failing.stub.requests).toEqual([]);

  // Required without its secret: fails closed.
  const unconfigured = setup({ turnstile: true });
  const failed = (await unconfigured.server.handle(post(contactSubmission())))!;
  expect(readFormState(landing(failed), 1)?.status).toBe("failed");
  expect(unconfigured.stub.requests).toEqual([]);
  expect(await unconfigured.server.check()).toMatchObject({
    spam: { honeypot: true, turnstile: true },
    turnstileSecret: false,
    ready: false,
  });
});

test("unsupported, unavailable and unknown forms are never submitted", async () => {
  const { server, stub } = setup();
  for (const formId of [2, 3, 4]) {
    const response = (await server.handle(post(contactSubmission(), { formId })))!;
    expect(readFormState(landing(response), formId)?.status).toBe("failed");
  }
  expect(stub.requests).toEqual([]);
});

test("an Access service token, when bound, goes only to the submissions endpoint; a partial pair fails closed", async () => {
  const pair = setup({
    bindings: { GQ_FORMS_ACCESS_CLIENT_ID: "id.access", GQ_FORMS_ACCESS_CLIENT_SECRET: "s3cret" },
  });
  await pair.server.handle(post(contactSubmission()));
  expect(pair.stub.requests[0]!.headers).toMatchObject({
    "cf-access-client-id": "id.access",
    "cf-access-client-secret": "s3cret",
  });
  const check = await pair.server.check();
  expect(check.access).toBe("configured");
  expect(JSON.stringify(check)).not.toContain("s3cret");

  const partial = setup({ bindings: { GQ_FORMS_ACCESS_CLIENT_ID: "id.access" } });
  const response = (await partial.server.handle(post(contactSubmission())))!;
  expect(readFormState(landing(response), 1)?.status).toBe("failed");
  expect(partial.stub.requests).toEqual([]);
});

test("a redirect confirmation sends the visitor on; a CMS failure is a failure, never sent", async () => {
  const server = createFormsServer({
    cmsOrigin: CMS,
    descriptor: () => CONTACT_FORM,
    bindings: () => ({}),
    fetch: async () =>
      Response.json({
        is_valid: true,
        confirmation_type: "redirect",
        confirmation_redirect: "https://partner.example/obrigado/",
      }),
  });
  const response = (await server.handle(post(contactSubmission())))!;
  expect(response.status).toBe(303);
  expect(response.headers.get("Location")).toBe("https://partner.example/obrigado/");

  for (const fetch of [
    async () => new Response("Bad gateway", { status: 502 }),
    async () => {
      throw new TypeError("network");
    },
    async () => Response.json({ code: "form_not_found" }, { status: 400 }),
  ]) {
    const failing = createFormsServer({
      cmsOrigin: CMS,
      descriptor: () => CONTACT_FORM,
      bindings: () => ({}),
      fetch: fetch as typeof globalThis.fetch,
    });
    const answer = (await failing.handle(post(contactSubmission())))!;
    const state = readFormState(landing(answer), 1)!;
    expect(state.status).toBe("failed");
    expect(state.values.input_2).toBe("ana@example.com");
  }
});

test("a rate limit, when bound, is keyed per form and client and answers too many", async () => {
  const keys: string[] = [];
  const { server, stub } = setup({
    bindings: {
      FORMS_RATE_LIMITER: {
        limit: async ({ key }) => {
          keys.push(key);
          return { success: false };
        },
      },
    },
  });
  const response = (await server.handle(
    post(contactSubmission(), { headers: { "CF-Connecting-IP": "198.51.100.4" } }),
  ))!;
  expect(readFormState(landing(response), 1)?.status).toBe("too-many");
  expect(keys).toEqual(["1:198.51.100.4"]);
  expect(stub.requests).toEqual([]);
});

test("no forms export reads entries", () => {
  for (const module of [forms, formsAstro, formsServer, formsTesting])
    assertNoEntryExports(module as Record<string, unknown>);
  expect(() => assertNoEntryExports({ listEntries: () => [] })).toThrow(/listEntries/);
  expect(() =>
    assertNoEntryReadsOrCredentials([
      { method: "GET", url: "/wp-json/gf/v2/forms/1/entries", headers: {}, body: null },
    ]),
  ).toThrow(/entry read/);
});

test("review regressions: numbers, CMS page confirmations, empty inputs, defaults and consent HTML", async () => {
  const { parseNumber } = await import("../src/forms/validate");
  expect([
    parseNumber("1234.5"),
    parseNumber("1,5"),
    parseNumber("1.234,5"),
    parseNumber("1,234.5"),
    parseNumber("1 234,5"),
    parseNumber("1,000,000"),
    parseNumber("abc"),
  ]).toEqual([1234.5, 1.5, 1234.5, 1234.5, 1234.5, 1000000, Number.NaN]);

  // A page confirmation (the CMS's permalink) stays on the Site.
  const server = createFormsServer({
    cmsOrigin: CMS,
    descriptor: () => CONTACT_FORM,
    bindings: () => ({}),
    fetch: async () =>
      Response.json({
        is_valid: true,
        confirmation_type: "redirect",
        confirmation_redirect: `${CMS}/obrigado/?x=1`,
      }),
  });
  const response = (await server.handle(post(contactSubmission())))!;
  expect(response.headers.get("Location")).toBe("/obrigado/?x=1");

  // A field without inputs that Gravity Forms refuses doesn't break the page.
  const bare = {
    ...CONTACT_FORM,
    fields: [{ ...CONTACT_FORM.fields[0]!, inputs: [] }, ...CONTACT_FORM.fields.slice(1)],
  };
  const html = renderGravityForm({
    descriptor: bare,
    source: "/contactos/",
    language: "en",
    state: { formId: 1, status: "invalid", errors: {}, messages: { 1: "Required." }, values: {} },
  });
  expect(html).toContain('<a href="#gq-form-1">Nome: Required.</a>');

  // An outcome that kept nothing typed leaves the defaults and preselections.
  const choosing = {
    ...CONTACT_FORM,
    fields: [
      {
        ...CONTACT_FORM.fields[2]!,
        defaultValue: "Geral",
      },
      {
        id: 8,
        type: "select" as const,
        label: "Tema",
        description: "",
        required: false,
        visibility: "visible" as const,
        choices: [
          { text: "A", value: "a", selected: false },
          { text: "B", value: "b", selected: true },
        ],
        inputs: [{ id: "8", name: "input_8", label: "Tema" }],
      },
    ],
  };
  const limited = renderGravityForm({
    descriptor: choosing,
    source: "/",
    language: "en",
    state: { formId: 1, status: "too-many", errors: {}, messages: {}, values: {} },
  });
  expect(limited).toContain('value="Geral"');
  expect(limited).toContain('<option value="b" selected>');

  // Gravity Forms allows HTML in a consent's checkbox label: shown as text.
  const consent = {
    ...CONTACT_FORM,
    fields: CONTACT_FORM.fields.map((field) =>
      field.type === "consent"
        ? {
            ...field,
            consent: { ...field.consent!, checkboxLabel: 'I agree to the <a href="/p">policy</a>' },
          }
        : field,
    ),
  };
  const agreed = renderGravityForm({ descriptor: consent, source: "/", language: "en" });
  expect(agreed).toContain('<label for="gq-form-1-input_5_1">I agree to the policy</label>');
  // …and submitted exactly as Gravity Forms renders it, for its state check.
  expect(
    validateSubmission(consent, new URLSearchParams(contactSubmission())).input.input_5_2,
  ).toBe('I agree to the <a href="/p">policy</a>');
});
