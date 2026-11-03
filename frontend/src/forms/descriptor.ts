// The public form descriptor (ADR 0009): what a Site needs to render a Gravity
// Forms form and validate a submission to it, delivered by the gq-content CMS
// module with each publication that references the form. It never carries
// notifications, entries, feeds or admin settings; `parseFormDescriptor`
// keeps only the fields below, so anything else the CMS sends is dropped.

/** The Site path the forms handler answers under: `/gq/forms/<formId>`. */
export const FORMS_PATH = "/gq/forms";

/** The descriptor's wire version; another version doesn't parse. */
export const FORM_DESCRIPTOR_SCHEMA = 1;

/** The Gravity Forms block a Site's dispatcher routes to the renderer. */
export const GRAVITY_FORMS_BLOCK = "gravityforms/form";

/** Field types this release renders and submits. */
export const SUPPORTED_FIELD_TYPES = [
  "text",
  "textarea",
  "email",
  "phone",
  "number",
  "website",
  "select",
  "radio",
  "checkbox",
  "consent",
  "name",
  "hidden",
  "html",
  "section",
  "fileupload",
] as const;
export type FormFieldType = (typeof SUPPORTED_FIELD_TYPES)[number];

export interface FormChoice {
  text: string;
  value: string;
  selected: boolean;
}

/** One HTML input of a field: Gravity Forms' `input_<field>` or `input_<field>_<n>`. */
export interface FormInput {
  /** Gravity Forms' input id (`1`, `1.3`). */
  id: string;
  /** The name it is posted as. */
  name: string;
  label: string;
  /** For a checkbox input, the choice's value. */
  value?: string;
  placeholder?: string;
  /** Name sub-inputs: autocomplete token (given-name, family-name…). */
  autocomplete?: string;
}

export interface FormConsent {
  /** The text next to the checkbox. */
  checkboxLabel: string;
  /** The consent's longer text, as plain text. */
  description: string;
  /** Gravity Forms' form revision the text belongs to; submitted with the consent. */
  revisionId: string;
}

/**
 * The extensions an upload field may allow: the formats whose content the form
 * endpoint verifies (ADR 0010 here). Another extension is a diagnostic.
 */
export const VERIFIABLE_FILE_EXTENSIONS = ["jpg", "jpeg", "png", "gif", "webp", "pdf"] as const;
export type VerifiableFileExtension = (typeof VERIFIABLE_FILE_EXTENSIONS)[number];

/** A file upload field's public settings, as Gravity Forms enforces them. */
export interface FormUpload {
  /** Lower case, without dots (`jpg`, `pdf`). Empty: none set, which isn't supported. */
  allowedExtensions: string[];
  /** The largest file accepted, in bytes (the field's limit, capped by the CMS's PHP). */
  maxFileSize: number;
  /** Whether the field takes several files. */
  multipleFiles: boolean;
  /** The most files it takes: 1 for a single file; 0 for several without a maximum (unsupported). */
  maxFiles: number;
}

export interface FormField {
  id: number;
  type: FormFieldType;
  label: string;
  /** Plain text. */
  description: string;
  required: boolean;
  /** A hidden field is submitted, not shown; a `hidden` visibility field is too. */
  visibility: "visible" | "hidden";
  placeholder?: string;
  maxLength?: number;
  defaultValue?: string;
  /** select, radio, checkbox. */
  choices?: FormChoice[];
  /** The inputs it posts (one for most fields). */
  inputs: FormInput[];
  /** consent only. */
  consent?: FormConsent;
  /** html only: sanitized by WordPress (wp_kses_post) on the CMS. */
  content?: string;
  /** number only. */
  range?: { min?: number; max?: number };
  /** The Site's CSS classes the editor set on the field. */
  cssClass?: string;
  /** fileupload only. */
  upload?: FormUpload;
}

export type FormConfirmation =
  | { type: "message"; message: string }
  | { type: "redirect"; url: string };

/** Why a form can't be offered as it is; readiness reports each one as a failure. */
export type FormDiagnosticCode =
  | "unavailable"
  | "unsupported-captcha"
  | "unsupported-file-upload"
  | "unsupported-payment"
  | "unsupported-multi-page"
  | "unsupported-field"
  | "unsupported-conditional-logic"
  | "requires-login";

export interface FormDiagnostic {
  code: FormDiagnosticCode;
  fieldId?: number;
  /** Gravity Forms' field type, for a field diagnostic. */
  type?: string;
  message: string;
}

export interface FormDescriptor {
  schema: typeof FORM_DESCRIPTOR_SCHEMA;
  id: number;
  /** False when the form is missing, inactive or trashed: it renders as unavailable. */
  available: boolean;
  title: string;
  /** Plain text. */
  description: string;
  submitLabel: string;
  fields: FormField[];
  /** Gravity Forms' honeypot input, when the form enables it. */
  honeypot: { name: string } | null;
  /** The default confirmation. */
  confirmation: FormConfirmation;
  /** Set by the CMS for fields and settings this release doesn't support. */
  diagnostics: FormDiagnostic[];
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}
const text = (value: unknown): string => (typeof value === "string" ? value : "");
const optionalText = (value: unknown): string | undefined =>
  typeof value === "string" && value !== "" ? value : undefined;
const finite = (value: unknown): number | undefined =>
  typeof value === "number" && Number.isFinite(value) ? value : undefined;

const INPUT_NAME = /^input_\d+(?:_\d+)?$/;
const DIAGNOSTIC_CODES = new Set<FormDiagnosticCode>([
  "unavailable",
  "unsupported-captcha",
  "unsupported-file-upload",
  "unsupported-payment",
  "unsupported-multi-page",
  "unsupported-field",
  "unsupported-conditional-logic",
  "requires-login",
]);

function parseInput(value: unknown): FormInput | null {
  if (!isRecord(value)) return null;
  const id = text(value.id);
  const name = text(value.name);
  if (!/^\d+(?:\.\d+)?$/.test(id) || !INPUT_NAME.test(name)) return null;
  return {
    id,
    name,
    label: text(value.label),
    ...(typeof value.value === "string" ? { value: value.value } : {}),
    ...(optionalText(value.placeholder) ? { placeholder: text(value.placeholder) } : {}),
    ...(optionalText(value.autocomplete) ? { autocomplete: text(value.autocomplete) } : {}),
  };
}

const EXTENSION = /^[a-z0-9]{1,16}$/;

function parseUpload(value: unknown): FormUpload {
  const record = isRecord(value) ? value : {};
  const extensions = Array.isArray(record.allowedExtensions) ? record.allowedExtensions : [];
  const multipleFiles = record.multipleFiles === true;
  const size = finite(record.maxFileSize);
  const count = finite(record.maxFiles);
  return {
    allowedExtensions: [
      ...new Set(
        extensions
          .map((each) => text(each).trim().toLowerCase().replace(/^\./, ""))
          .filter((each) => EXTENSION.test(each)),
      ),
    ],
    maxFileSize: size !== undefined && size > 0 ? Math.floor(size) : 0,
    multipleFiles,
    maxFiles: !multipleFiles ? 1 : count !== undefined && count > 0 ? Math.floor(count) : 0,
  };
}

function parseField(value: unknown): FormField | null {
  if (!isRecord(value)) return null;
  const id = value.id;
  const type = value.type;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return null;
  if (!SUPPORTED_FIELD_TYPES.includes(type as FormFieldType)) return null;
  const inputs = Array.isArray(value.inputs)
    ? value.inputs.map(parseInput).filter((input): input is FormInput => input !== null)
    : [];
  const field: FormField = {
    id,
    type: type as FormFieldType,
    label: text(value.label),
    description: text(value.description),
    required: value.required === true,
    visibility: value.visibility === "hidden" ? "hidden" : "visible",
    inputs,
  };
  if (optionalText(value.placeholder)) field.placeholder = text(value.placeholder);
  const maxLength = finite(value.maxLength);
  if (maxLength !== undefined && maxLength > 0) field.maxLength = Math.floor(maxLength);
  if (typeof value.defaultValue === "string") field.defaultValue = value.defaultValue;
  if (optionalText(value.cssClass)) field.cssClass = text(value.cssClass);
  if (Array.isArray(value.choices))
    field.choices = value.choices.filter(isRecord).map((choice) => ({
      text: text(choice.text),
      value: text(choice.value),
      selected: choice.selected === true,
    }));
  if (isRecord(value.consent))
    field.consent = {
      checkboxLabel: text(value.consent.checkboxLabel),
      description: text(value.consent.description),
      revisionId: text(value.consent.revisionId),
    };
  if (typeof value.content === "string") field.content = value.content;
  if (isRecord(value.range)) {
    const min = finite(value.range.min);
    const max = finite(value.range.max);
    field.range = { ...(min !== undefined ? { min } : {}), ...(max !== undefined ? { max } : {}) };
  }
  // Settings that don't parse become ones readiness fails on (formDiagnostics).
  if (field.type === "fileupload") field.upload = parseUpload(value.upload);
  return field;
}

function parseConfirmation(value: unknown): FormConfirmation {
  if (isRecord(value) && value.type === "redirect" && typeof value.url === "string") {
    try {
      const url = new URL(value.url);
      if (url.protocol === "https:" || url.protocol === "http:")
        return { type: "redirect", url: url.href };
    } catch {
      // Not a URL: the message confirmation below.
    }
  }
  return { type: "message", message: isRecord(value) ? text(value.message) : "" };
}

/**
 * A descriptor as the CMS delivered it, keeping only the public fields above,
 * or null when it isn't one. Fields of a type this release doesn't support
 * are left out; the CMS reports them as diagnostics.
 */
export function parseFormDescriptor(value: unknown): FormDescriptor | null {
  if (!isRecord(value) || value.schema !== FORM_DESCRIPTOR_SCHEMA) return null;
  const id = value.id;
  if (typeof id !== "number" || !Number.isInteger(id) || id < 1) return null;
  const fields = Array.isArray(value.fields)
    ? value.fields.map(parseField).filter((field): field is FormField => field !== null)
    : [];
  const honeypotName = isRecord(value.honeypot) ? text(value.honeypot.name) : "";
  const diagnostics = Array.isArray(value.diagnostics)
    ? value.diagnostics.filter(isRecord).flatMap((diagnostic): FormDiagnostic[] => {
        const code = diagnostic.code as FormDiagnosticCode;
        if (!DIAGNOSTIC_CODES.has(code)) return [];
        const fieldId = finite(diagnostic.fieldId);
        return [
          {
            code,
            ...(fieldId !== undefined ? { fieldId } : {}),
            ...(optionalText(diagnostic.type) ? { type: text(diagnostic.type) } : {}),
            message: text(diagnostic.message),
          },
        ];
      })
    : [];
  return {
    schema: FORM_DESCRIPTOR_SCHEMA,
    id,
    available: value.available === true,
    title: text(value.title),
    description: text(value.description),
    submitLabel: text(value.submitLabel),
    fields,
    honeypot: INPUT_NAME.test(honeypotName) ? { name: honeypotName } : null,
    confirmation: parseConfirmation(value.confirmation),
    diagnostics,
  };
}

/**
 * The descriptors a publication carries (the CMS's `getquickForms`, as JSON
 * text or data), dropping any that don't parse. Undefined for no value.
 */
export function parseFormDescriptors(value: unknown): FormDescriptor[] | undefined {
  let parsed = value;
  if (typeof parsed === "string") {
    try {
      parsed = JSON.parse(parsed) as unknown;
    } catch {
      return undefined;
    }
  }
  if (!Array.isArray(parsed)) return undefined;
  return parsed
    .map(parseFormDescriptor)
    .filter((descriptor): descriptor is FormDescriptor => descriptor !== null);
}

/** The form a `gravityforms/form` block shows, from its attributes (`formId`). */
export function blockFormId(attributes: Record<string, unknown> | null | undefined): number | null {
  const raw = attributes?.formId;
  const id = typeof raw === "string" ? Number(raw) : raw;
  return typeof id === "number" && Number.isInteger(id) && id > 0 ? id : null;
}

/** A form's descriptor among a publication's, or null. */
export function findForm(
  forms: readonly FormDescriptor[] | null | undefined,
  formId: number,
): FormDescriptor | null {
  return forms?.find((form) => form.id === formId) ?? null;
}

/** The path a form posts to on the Site's own origin. */
export const formAction = (formId: number) => `${FORMS_PATH}/${formId}`;

/** Whether a descriptor has an upload field a visitor fills in: its form posts multipart. */
export function hasUploads(descriptor: FormDescriptor): boolean {
  return descriptor.fields.some(
    (field) => field.type === "fileupload" && field.visibility === "visible",
  );
}

/** Why an upload field's settings can't be honoured, or null. */
function uploadProblem(upload: FormUpload | undefined): string | null {
  if (!upload || upload.allowedExtensions.length === 0)
    return `Set the field's allowed file extensions (${VERIFIABLE_FILE_EXTENSIONS.join(", ")}).`;
  const unverifiable = upload.allowedExtensions.filter(
    (each) => !(VERIFIABLE_FILE_EXTENSIONS as readonly string[]).includes(each),
  );
  if (unverifiable.length)
    return `The Frontend can't verify ${unverifiable.join(", ")} files: allow only ${VERIFIABLE_FILE_EXTENSIONS.join(", ")}.`;
  if (upload.maxFileSize <= 0) return "The field has no file size limit.";
  if (upload.maxFiles <= 0) return "Set the maximum number of files.";
  return null;
}

/** Everything readiness must fail for: an unavailable form, and each unsupported field or setting. */
export function formDiagnostics(descriptor: FormDescriptor): FormDiagnostic[] {
  const diagnostics = [...descriptor.diagnostics];
  // Also checked here, so a descriptor from another CMS version can't post what isn't verified.
  for (const field of descriptor.fields) {
    if (field.type !== "fileupload") continue;
    const problem = uploadProblem(field.upload);
    if (
      problem &&
      !diagnostics.some(
        (each) => each.code === "unsupported-file-upload" && each.fieldId === field.id,
      )
    )
      diagnostics.push({
        code: "unsupported-file-upload",
        fieldId: field.id,
        type: "fileupload",
        message: problem,
      });
  }
  if (!descriptor.available && !diagnostics.some((each) => each.code === "unavailable"))
    diagnostics.unshift({
      code: "unavailable",
      message: `Form ${descriptor.id} is missing, inactive or in the trash.`,
    });
  return diagnostics;
}

/** The spam controls a Site's forms use. */
export type FormSpamControl = "honeypot" | "turnstile";

export interface FormsReadiness {
  ok: boolean;
  forms: Array<{
    id: number;
    title: string;
    ok: boolean;
    diagnostics: FormDiagnostic[];
    /** Gravity Forms' honeypot is enabled on the form. */
    honeypot: boolean;
  }>;
  /**
   * Controls the Site declares that no checked form uses (honeypot only), and
   * forms whose largest upload exceeds the Site's `maxUploadBytes`.
   */
  warnings: string[];
}

/** The most a form's visible upload fields can post together (bytes): each field's limit times its files. */
export function largestUpload(descriptor: FormDescriptor): number {
  return descriptor.fields
    .filter((field) => field.type === "fileupload" && field.visibility === "visible")
    .reduce(
      (total, field) =>
        total + (field.upload?.maxFileSize ?? 0) * Math.max(field.upload?.maxFiles ?? 0, 1),
      0,
    );
}

/**
 * Readiness over the forms a Site's published content references: fails for
 * any diagnostic. `spam` is the Site's declared controls; declaring the
 * honeypot for a form that doesn't enable it is reported as a warning.
 * `maxUploadBytes` is the Site's cap on a post (the form endpoint's): a form
 * whose files can exceed it together is reported as a warning, since its
 * largest posts will be refused.
 */
export function formsReadiness(
  descriptors: readonly FormDescriptor[],
  options: { spam?: readonly FormSpamControl[]; maxUploadBytes?: number } = {},
): FormsReadiness {
  const unique = new Map(descriptors.map((descriptor) => [descriptor.id, descriptor]));
  const forms = [...unique.values()].map((descriptor) => {
    const diagnostics = formDiagnostics(descriptor);
    return {
      id: descriptor.id,
      title: descriptor.title,
      ok: diagnostics.length === 0,
      diagnostics,
      honeypot: descriptor.honeypot !== null,
    };
  });
  const warnings = options.spam?.includes("honeypot")
    ? forms
        .filter((form) => !form.honeypot)
        .map((form) => `Form ${form.id} doesn't enable Gravity Forms' anti-spam honeypot.`)
    : [];
  const cap = options.maxUploadBytes;
  if (cap !== undefined)
    for (const descriptor of unique.values()) {
      const largest = largestUpload(descriptor);
      if (largest > cap)
        warnings.push(
          `Form ${descriptor.id}'s files can reach ${(largest / 1048576).toFixed(1)} MB together, more than the ${(cap / 1048576).toFixed(1)} MB the Site accepts per post: lower its upload fields' size limits or numbers of files.`,
        );
    }
  return { ok: forms.every((form) => form.ok), forms, warnings };
}
