// @getquick/content/forms/testing: fixtures and assertions for headless
// Gravity Forms (ADR 0009), for this package's suites and a Site's own: form
// descriptors, a stand-in for Gravity Forms' REST submissions endpoint that
// records what reaches it, and checks for the descriptor's privacy, the
// rendered form's accessibility and the absence of entry reads.
import { FORM_DESCRIPTOR_SCHEMA, parseFormDescriptor, type FormDescriptor } from "./descriptor";

/** A contact form like Nomia's form 1: name, email, subject, message and privacy consent. */
export const CONTACT_FORM: FormDescriptor = {
  schema: FORM_DESCRIPTOR_SCHEMA,
  id: 1,
  available: true,
  title: "Contactos",
  description: "Envie-nos uma mensagem.",
  submitLabel: "Enviar",
  fields: [
    {
      id: 1,
      type: "name",
      label: "Nome",
      description: "",
      required: true,
      visibility: "visible",
      inputs: [
        { id: "1.3", name: "input_1_3", label: "Nome próprio", autocomplete: "given-name" },
        { id: "1.6", name: "input_1_6", label: "Apelido", autocomplete: "family-name" },
      ],
    },
    {
      id: 2,
      type: "email",
      label: "Email",
      description: "",
      required: true,
      visibility: "visible",
      inputs: [{ id: "2", name: "input_2", label: "Email" }],
    },
    {
      id: 3,
      type: "text",
      label: "Assunto",
      description: "",
      required: false,
      visibility: "visible",
      maxLength: 120,
      inputs: [{ id: "3", name: "input_3", label: "Assunto" }],
    },
    {
      id: 4,
      type: "textarea",
      label: "Mensagem",
      description: "",
      required: true,
      visibility: "visible",
      inputs: [{ id: "4", name: "input_4", label: "Mensagem" }],
    },
    {
      id: 5,
      type: "consent",
      label: "Privacidade",
      description: "",
      required: true,
      visibility: "visible",
      inputs: [
        { id: "5.1", name: "input_5_1", label: "Consentimento" },
        { id: "5.2", name: "input_5_2", label: "Texto" },
        { id: "5.3", name: "input_5_3", label: "Descrição" },
      ],
      consent: {
        checkboxLabel: "Aceito o tratamento dos meus dados para responder a este contacto.",
        description: "Os dados são usados apenas para responder à sua mensagem.",
        revisionId: "7",
      },
    },
  ],
  honeypot: { name: "input_6" },
  confirmation: { type: "message", message: "Obrigado pelo seu contacto." },
  diagnostics: [],
};

/** A form readiness must fail: Gravity Forms' CAPTCHA, a file upload, a payment field and a page break. */
export const UNSUPPORTED_FORM: FormDescriptor = {
  ...CONTACT_FORM,
  id: 2,
  title: "Candidatura",
  fields: CONTACT_FORM.fields.slice(0, 2),
  diagnostics: [
    { code: "unsupported-captcha", fieldId: 10, type: "captcha", message: "CAPTCHA" },
    { code: "unsupported-file-upload", fieldId: 11, type: "fileupload", message: "File upload" },
    { code: "unsupported-payment", fieldId: 12, type: "product", message: "Payment" },
    { code: "unsupported-multi-page", fieldId: 13, type: "page", message: "Multi-page" },
  ],
};

/** A referenced form that is missing, inactive or trashed. */
export const UNAVAILABLE_FORM: FormDescriptor = {
  ...CONTACT_FORM,
  id: 3,
  available: false,
  fields: [],
  honeypot: null,
  diagnostics: [{ code: "unavailable", message: "Form 3 is inactive." }],
};

/** Keys that must never appear anywhere in a delivered descriptor. */
export const PRIVATE_FORM_KEYS = [
  "notifications",
  "notification",
  "confirmations",
  "entries",
  "entry",
  "entry_id",
  "feeds",
  "feed",
  "settings",
  "personalData",
  "routing",
  "to",
  "bcc",
  "from",
  "fromName",
  "replyTo",
  "save",
  "limitEntries",
  "scheduleForm",
  "requireLogin",
  "consumer_key",
  "consumer_secret",
] as const;

function keysOf(value: unknown, path = "", found: string[] = []): string[] {
  if (Array.isArray(value))
    value.forEach((each, index) => keysOf(each, `${path}[${index}]`, found));
  else if (typeof value === "object" && value !== null)
    for (const [key, each] of Object.entries(value)) {
      found.push(`${path}.${key}`);
      keysOf(each, `${path}.${key}`, found);
    }
  return found;
}

/**
 * Throws unless a delivered descriptor is public: it parses, and nothing in it
 * is a notification, entry, feed or admin setting (by key, at any depth).
 */
export function assertPublicDescriptor(value: unknown): FormDescriptor {
  const descriptor = parseFormDescriptor(value);
  if (!descriptor) throw new Error("Not a form descriptor");
  const forbidden = keysOf(value).filter((path) =>
    (PRIVATE_FORM_KEYS as readonly string[]).includes(path.slice(path.lastIndexOf(".") + 1)),
  );
  if (forbidden.length)
    throw new Error(`The descriptor carries private form data: ${forbidden.join(", ")}`);
  return descriptor;
}

/**
 * Throws unless rendered form HTML is accessible: every visible control has a
 * label (`for`) or is in a labelled fieldset, every `aria-describedby` id
 * exists, invalid controls are described by their error, an error summary is
 * an alert and a confirmation is a status.
 */
export function assertAccessibleForm(html: string): void {
  const ids = new Set([...html.matchAll(/\sid="([^"]+)"/g)].map((match) => match[1]!));
  const labelled = new Set([...html.matchAll(/<label[^>]*\sfor="([^"]+)"/g)].map((m) => m[1]!));
  const problems: string[] = [];
  for (const match of html.matchAll(/<(input|select|textarea)\b([^>]*)>/g)) {
    const attributes = match[2]!;
    if (/\stype="hidden"/.test(attributes)) continue;
    const id = /\sid="([^"]+)"/.exec(attributes)?.[1];
    if (!id || !labelled.has(id)) problems.push(`a ${match[1]} without a label (${id ?? "no id"})`);
    const describedBy = /\saria-describedby="([^"]+)"/.exec(attributes)?.[1];
    for (const reference of describedBy?.split(/\s+/) ?? [])
      if (!ids.has(reference)) problems.push(`${id} is described by a missing #${reference}`);
    if (/\saria-invalid="true"/.test(attributes) && !/-error\b/.test(describedBy ?? ""))
      problems.push(`${id} is invalid without its error in aria-describedby`);
  }
  if (/gq-form__errors/.test(html) && !/class="gq-form__errors" role="alert"/.test(html))
    problems.push("the error summary isn't an alert");
  if (/gq-form__status--sent/.test(html) && !/gq-form__status--sent" role="status"/.test(html))
    problems.push("the confirmation isn't a status message");
  if (/<form\b/.test(html) && !/<button type="submit"/.test(html))
    problems.push("the form has no submit button");
  if (problems.length) throw new Error(`Inaccessible form: ${problems.join("; ")}`);
}

/** A request Gravity Forms' stand-in received. */
export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  body: Record<string, string> | null;
}

export interface StoredEntry {
  formId: number;
  values: Record<string, string>;
  spam: boolean;
}

/**
 * A stand-in for Gravity Forms' REST API on a CMS: `POST
 * /wp-json/gf/v2/forms/<id>/submissions` as Gravity Forms 3.2 answers it,
 * validating required fields and storing entries for the given descriptors.
 * A filled honeypot is stored as spam, Gravity Forms' default honeypot
 * action. Anything else is a 404. `requests` records every request.
 */
export function gravityFormsStub(forms: readonly FormDescriptor[]) {
  const entries: StoredEntry[] = [];
  const requests: RecordedRequest[] = [];
  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let body: Record<string, string> | null = null;
    try {
      body = request.method === "POST" ? ((await request.json()) as Record<string, string>) : null;
    } catch {
      body = null;
    }
    requests.push({
      method: request.method,
      url: url.pathname + url.search,
      headers: Object.fromEntries(request.headers),
      body,
    });
    const match = /^\/wp-json\/gf\/v2\/forms\/(\d+)\/submissions$/.exec(url.pathname);
    const form = match && forms.find((each) => each.id === Number(match[1]));
    if (!match || request.method !== "POST")
      return Response.json({ code: "rest_no_route" }, { status: 404 });
    if (!form || !form.available)
      return Response.json(
        { code: "form_not_found", message: "Your form could not be found" },
        { status: 400 },
      );
    const values = body ?? {};
    const messages: Record<string, string> = {};
    for (const field of form.fields) {
      if (!field.required) continue;
      const names =
        field.type === "consent"
          ? [field.inputs[0]!.name]
          : field.inputs.map((input) => input.name);
      if (names.every((name) => !values[name])) messages[field.id] = "This field is required.";
    }
    if (Object.keys(messages).length)
      return Response.json(
        { is_valid: false, validation_messages: messages, page_number: 1, source_page_number: 1 },
        { status: 400 },
      );
    const spam = Boolean(form.honeypot && values[form.honeypot.name]);
    entries.push({ formId: form.id, values, spam });
    return Response.json({
      is_valid: true,
      page_number: 0,
      source_page_number: 1,
      confirmation_type: "message",
      confirmation_message: `<div id='gform_confirmation_wrapper_${form.id}' class='gform_confirmation_wrapper '><div id='gform_confirmation_message_${form.id}' class='gform_confirmation_message_${form.id} gform_confirmation_message'>${form.confirmation.type === "message" ? form.confirmation.message : ""}</div></div>`,
      is_spam: spam,
    });
  }
  return {
    entries,
    requests,
    handle,
    /** A `fetch` that answers the CMS's requests at `origin` and refuses any other. */
    fetchFor(origin: string): typeof globalThis.fetch {
      return async (input, init) => {
        const request = new Request(input, init);
        if (new URL(request.url).origin !== origin)
          throw new TypeError(`Unexpected request to ${new URL(request.url).origin}`);
        return handle(request);
      };
    },
  };
}

/** Throws if any request asked for entries, or carried a Gravity Forms credential. */
export function assertNoEntryReadsOrCredentials(requests: readonly RecordedRequest[]): void {
  for (const request of requests) {
    if (/\/entries\b/.test(request.url))
      throw new Error(`An entry read reached the CMS: ${request.method} ${request.url}`);
    if (request.headers.authorization)
      throw new Error(`A credential reached the CMS: ${request.method} ${request.url}`);
    if (/consumer_(key|secret)|oauth_/i.test(request.url))
      throw new Error(`A consumer key reached the CMS: ${request.method} ${request.url}`);
  }
}

/** Throws if a module exports anything that reads entries (by name; these assertions aside). */
export function assertNoEntryExports(module: Record<string, unknown>): void {
  const names = Object.keys(module).filter(
    (name) => /entr(y|ies)/i.test(name) && !name.startsWith("assertNo"),
  );
  if (names.length) throw new Error(`Exports that read entries: ${names.join(", ")}`);
}

/** A form body as a browser posts it (application/x-www-form-urlencoded). */
export function formBody(values: Record<string, string>): string {
  return new URLSearchParams(values).toString();
}

/** A filled-in, valid submission of CONTACT_FORM from `source`. */
export function contactSubmission(source = "/contactos/"): Record<string, string> {
  return {
    gq_source: source,
    input_1_3: "Ana",
    input_1_6: "Silva",
    input_2: "ana@example.com",
    input_3: "Pergunta",
    input_4: "Olá, gostava de saber mais.",
    input_5_1: "1",
    input_6: "",
  };
}

/** Cloudflare's Turnstile test keys: always pass, always fail. */
export const TURNSTILE_TEST_KEYS = {
  passingSiteKey: "1x00000000000000000000AA",
  failingSiteKey: "2x00000000000000000000AB",
  passingSecretKey: "1x0000000000000000000000000000000AA",
  failingSecretKey: "2x0000000000000000000000000000000AA",
  /** The token the test site keys produce. */
  dummyToken: "XXXX.DUMMY.TOKEN.XXXX",
} as const;
