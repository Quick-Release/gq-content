// @getquick/content/forms/testing: fixtures and assertions for headless
// Gravity Forms (ADR 0009), for this package's suites and a Site's own: form
// descriptors, a stand-in for Gravity Forms' REST submissions endpoint that
// records what reaches it (files too), and checks for the descriptor's
// privacy, the rendered form's accessibility and the absence of entry reads.
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

/** A form readiness must fail: Gravity Forms' CAPTCHA, an upload of files the Frontend can't verify, a payment field and a page break. */
export const UNSUPPORTED_FORM: FormDescriptor = {
  ...CONTACT_FORM,
  id: 2,
  title: "Candidatura",
  fields: CONTACT_FORM.fields.slice(0, 2),
  diagnostics: [
    { code: "unsupported-captcha", fieldId: 10, type: "captcha", message: "CAPTCHA" },
    {
      code: "unsupported-file-upload",
      fieldId: 11,
      type: "fileupload",
      message: "The Frontend can't verify docx files: allow only jpg, jpeg, png, gif, webp, pdf.",
    },
    { code: "unsupported-payment", fieldId: 12, type: "product", message: "Payment" },
    { code: "unsupported-multi-page", fieldId: 13, type: "page", message: "Multi-page" },
  ],
};

/** The upload settings Sites use for images and PDFs: 5 MB per file, up to 5 files. */
export const IMAGE_AND_PDF_UPLOAD = {
  allowedExtensions: ["jpg", "jpeg", "png", "webp", "gif", "pdf"],
  maxFileSize: 5 * 1024 * 1024,
  multipleFiles: true,
  maxFiles: 5,
};

/**
 * A public submission form like Nomia's /partilhe/: name, email, a content
 * type, title, content, image and PDF attachments, and privacy consent.
 */
export const SUBMISSION_FORM: FormDescriptor = {
  schema: FORM_DESCRIPTOR_SCHEMA,
  id: 6,
  available: true,
  title: "Partilhe",
  description: "Envie-nos conteúdos para publicação.",
  submitLabel: "Enviar",
  fields: [
    {
      id: 1,
      type: "text",
      label: "Nome",
      description: "",
      required: true,
      visibility: "visible",
      inputs: [{ id: "1", name: "input_1", label: "Nome" }],
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
      type: "select",
      label: "Tipo de conteúdo",
      description: "",
      required: true,
      visibility: "visible",
      choices: [
        { text: "Notícia", value: "noticia", selected: false },
        { text: "Evento", value: "evento", selected: false },
        { text: "Publicação", value: "publicacao", selected: false },
      ],
      inputs: [{ id: "3", name: "input_3", label: "Tipo de conteúdo" }],
    },
    {
      id: 4,
      type: "text",
      label: "Título",
      description: "",
      required: true,
      visibility: "visible",
      maxLength: 200,
      inputs: [{ id: "4", name: "input_4", label: "Título" }],
    },
    {
      id: 5,
      type: "textarea",
      label: "Conteúdo",
      description: "",
      required: true,
      visibility: "visible",
      inputs: [{ id: "5", name: "input_5", label: "Conteúdo" }],
    },
    {
      id: 6,
      type: "fileupload",
      label: "Anexos",
      description: "Imagens ou documentos PDF.",
      required: false,
      visibility: "visible",
      inputs: [{ id: "6", name: "input_6", label: "Anexos" }],
      upload: IMAGE_AND_PDF_UPLOAD,
    },
    {
      id: 7,
      type: "consent",
      label: "Privacidade",
      description: "",
      required: true,
      visibility: "visible",
      inputs: [
        { id: "7.1", name: "input_7_1", label: "Consentimento" },
        { id: "7.2", name: "input_7_2", label: "Texto" },
        { id: "7.3", name: "input_7_3", label: "Descrição" },
      ],
      consent: {
        checkboxLabel: "Aceito o tratamento dos meus dados para analisar este conteúdo.",
        description: "",
        revisionId: "2",
      },
    },
  ],
  honeypot: { name: "input_8" },
  confirmation: { type: "message", message: "Obrigado. Vamos analisar o seu conteúdo." },
  diagnostics: [],
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
  // A file input needs a form that sends files, and a hint naming what it accepts.
  for (const match of html.matchAll(/<input type="file"([^>]*)>/g)) {
    const id = /\sid="([^"]+)"/.exec(match[1]!)?.[1];
    if (!/aria-describedby="[^"]*-hint\b/.test(match[1]!))
      problems.push(`${id} doesn't describe which files it accepts`);
  }
  if (/<input type="file"/.test(html) && !/<form\b[^>]*\senctype="multipart\/form-data"/.test(html))
    problems.push("a file input is in a form that doesn't send files");
  if (problems.length) throw new Error(`Inaccessible form: ${problems.join("; ")}`);
}

/** A file Gravity Forms' stand-in received. */
export interface RecordedFile {
  /** The file name it was posted with. */
  filename: string;
  /** The Content-Type it was posted with. */
  type: string;
  size: number;
  /** Its first bytes, hex (for signature checks). */
  head: string;
}

/** A request Gravity Forms' stand-in received. */
export interface RecordedRequest {
  method: string;
  url: string;
  headers: Record<string, string>;
  /** JSON's values, or a multipart body's text values. */
  body: Record<string, string> | null;
  /** A multipart body's files, by the name they were posted under (`input_6[]`). */
  files?: Record<string, RecordedFile[]>;
}

export interface StoredEntry {
  formId: number;
  values: Record<string, string>;
  /** Files stored with the entry, by field input name (`input_6`). */
  files: Record<string, RecordedFile[]>;
  spam: boolean;
}

async function recordFile(file: Blob & { name?: string }): Promise<RecordedFile> {
  const head = new Uint8Array(await file.slice(0, 12).arrayBuffer());
  return {
    filename: file.name ?? "",
    type: file.type,
    size: file.size,
    head: [...head].map((byte) => byte.toString(16).padStart(2, "0")).join(""),
  };
}

/**
 * A stand-in for Gravity Forms' REST API on a CMS: `POST
 * /wp-json/gf/v2/forms/<id>/submissions` as Gravity Forms 3.2 answers it,
 * validating required fields and storing entries for the given descriptors.
 * It takes JSON, or multipart/form-data whose files are `input_<id>` (one) or
 * `input_<id>[]` (several), as Gravity Forms reads `$_FILES`, and checks their
 * count, size and extension as Gravity Forms does (a multiple upload's
 * messages are a list). A filled honeypot is stored as spam, Gravity Forms'
 * default honeypot action. Anything else is a 404. `requests` records every
 * request.
 */
export function gravityFormsStub(forms: readonly FormDescriptor[]) {
  const entries: StoredEntry[] = [];
  const requests: RecordedRequest[] = [];
  async function handle(request: Request): Promise<Response> {
    const url = new URL(request.url);
    let body: Record<string, string> | null = null;
    let files: Record<string, RecordedFile[]> | undefined;
    try {
      if (request.method !== "POST") body = null;
      else if (/^multipart\/form-data\b/i.test(request.headers.get("Content-Type") ?? "")) {
        body = {};
        files = {};
        for (const [name, value] of await request.formData()) {
          if (typeof value === "string") body[name] = value;
          else (files[name] ??= []).push(await recordFile(value));
        }
      } else body = (await request.json()) as Record<string, string>;
    } catch {
      body = null;
    }
    requests.push({
      method: request.method,
      url: url.pathname + url.search,
      headers: Object.fromEntries(request.headers),
      body,
      ...(files ? { files } : {}),
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
    const messages: Record<string, string | string[]> = {};
    const stored: Record<string, RecordedFile[]> = {};
    for (const field of form.fields) {
      if (field.type === "fileupload") {
        const name = field.inputs[0]?.name ?? `input_${field.id}`;
        const posted = [...(files?.[name] ?? []), ...(files?.[`${name}[]`] ?? [])];
        const upload = field.upload;
        if (posted.length === 0) {
          if (field.required) messages[field.id] = "This field is required.";
          continue;
        }
        const limit = upload?.multipleFiles ? upload.maxFiles : 1;
        if (limit && posted.length > limit) {
          messages[field.id] = `Number of files (${posted.length}) exceeds limit (${limit}).`;
          continue;
        }
        const invalid = posted.flatMap((file) => {
          const extension = /\.([^.]+)$/.exec(file.filename)?.[1]?.toLowerCase() ?? "";
          if (upload && !upload.allowedExtensions.includes(extension))
            return [`${file.filename} - The uploaded file type is not allowed.`];
          if (upload && file.size > upload.maxFileSize)
            return [`${file.filename} - File exceeds size limit.`];
          return [];
        });
        if (invalid.length) messages[field.id] = upload?.multipleFiles ? invalid : invalid[0]!;
        else stored[name] = posted;
        continue;
      }
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
    entries.push({ formId: form.id, values, files: stored, spam });
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

/** Minimal files of each format the form endpoint verifies, as their signatures start. */
export const SAMPLE_FILES = {
  jpg: [0xff, 0xd8, 0xff, 0xe0, 0x00, 0x10, 0x4a, 0x46, 0x49, 0x46, 0x00, 0x01],
  png: [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a, 0x00, 0x00, 0x00, 0x0d],
  gif: [...new TextEncoder().encode("GIF89a"), 0x01, 0x00, 0x01, 0x00, 0x00, 0x00],
  webp: [
    ...new TextEncoder().encode("RIFF"),
    0x24,
    0x00,
    0x00,
    0x00,
    ...new TextEncoder().encode("WEBPVP8 "),
  ],
  pdf: [...new TextEncoder().encode("%PDF-1.7\n%\u00e2\u00e3")],
  /** A Windows executable: what a renamed attachment can really be. */
  exe: [0x4d, 0x5a, 0x90, 0x00, 0x03, 0x00, 0x00, 0x00, 0x04, 0x00, 0x00, 0x00],
} as const;

/**
 * A file as a browser posts it: `kind`'s signature, padded to `size` bytes,
 * with `type` as the client's claimed MIME type (never trusted).
 */
export function sampleFile(
  filename: string,
  kind: keyof typeof SAMPLE_FILES,
  options: { size?: number; type?: string } = {},
): File {
  const head = Uint8Array.from(SAMPLE_FILES[kind]);
  const bytes = new Uint8Array(Math.max(options.size ?? 256, head.length));
  bytes.set(head);
  return new File([bytes], filename, { type: options.type ?? "application/octet-stream" });
}

/**
 * A multipart form body as a browser posts it: the values, then each field's
 * files under its input name (several under the same name, as `multiple` does).
 */
export function multipartBody(
  values: Record<string, string>,
  files: Record<string, File | readonly File[]> = {},
): FormData {
  const body = new FormData();
  for (const [name, value] of Object.entries(values)) body.append(name, value);
  for (const [name, chosen] of Object.entries(files))
    for (const file of Array.isArray(chosen) ? chosen : [chosen]) body.append(name, file);
  return body;
}

/** A filled-in, valid submission of SUBMISSION_FORM from `source` (attach files with multipartBody). */
export function submissionValues(source = "/partilhe/"): Record<string, string> {
  return {
    gq_source: source,
    input_1: "Ana Silva",
    input_2: "ana@example.com",
    input_3: "evento",
    input_4: "Feira da bioeconomia",
    input_5: "Um evento sobre bioeconomia circular.",
    input_7_1: "1",
    input_8: "",
  };
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
