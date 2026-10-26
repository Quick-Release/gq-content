// @getquick/content/forms/astro: the `gravityforms/form` block as
// server-rendered HTML (`<Fragment set:html={...} />`). A plain HTML form
// posting to the Site's own `/gq/forms/<formId>`: it works without
// JavaScript, shows the handler's outcome and field errors after the
// redirect back, and loads nothing from the CMS. It imports no Astro module,
// consent runtime or publication runtime; Sites style it with their own
// tokens and classes.
import { FORMS_COPY, formsCopyLanguage, type FormsCopy } from "./copy";
import { formAction, type FormDescriptor, type FormField } from "./descriptor";
import type { FormState } from "./state";

/** LEGAL-1's links in the page's language (the chrome's `legal`), structurally. */
export interface FormsLegal {
  roles: ReadonlyArray<{ role: string; url: string; title?: string | null }>;
}

export interface GravityFormInput {
  /** The form's descriptor from the publication (`findForm(page.forms, blockFormId(attributes))`). */
  descriptor: FormDescriptor | null;
  /** The page's path: the handler sends the visitor back to it. */
  source: string;
  /** The page's `lang` (BCP 47). */
  language: string;
  /** The page language's Legal Contract: the consent links to its privacy policy. */
  legal?: FormsLegal | null;
  /** The outcome on the redirect back after a post (`readFormState`). */
  state?: FormState | null;
  /** Turnstile's site key, when the Site uses Turnstile. */
  turnstile?: { siteKey: string } | null;
  /** The block's `title` and `description` attributes: show the form's title and description. */
  showTitle?: boolean;
  showDescription?: boolean;
  /** The heading level of the form's title (2 by default). */
  headingLevel?: 2 | 3 | 4 | 5 | 6;
}

export function escapeHtml(value: string): string {
  return value
    .replaceAll("&", "&amp;")
    .replaceAll("<", "&lt;")
    .replaceAll(">", "&gt;")
    .replaceAll('"', "&quot;")
    .replaceAll("'", "&#39;");
}

const attribute = (name: string, value: string | null | undefined) =>
  value === null || value === undefined ? "" : ` ${name}="${escapeHtml(value)}"`;

/** The HTML id of an input (`gq-form-1-input_1_3`). */
export const inputId = (formId: number, name: string) => `gq-form-${formId}-${name}`;

const AUTOCOMPLETE: Partial<Record<FormField["type"], string>> = {
  email: "email",
  phone: "tel",
  website: "url",
};

const INPUT_TYPE: Partial<Record<FormField["type"], string>> = {
  text: "text",
  email: "email",
  phone: "tel",
  website: "url",
  number: "text",
};

interface FieldContext {
  formId: number;
  copy: FormsCopy;
  state: FormState | null;
  privacyPolicy: { url: string; title: string } | null;
}

function errorText(field: FormField, context: FieldContext): string | null {
  const message = context.state?.messages[field.id];
  if (message) return message;
  const code = context.state?.errors[field.id];
  return code ? context.copy.errors[code] : null;
}

/** The value to show: what the visitor typed, after a failed post, else the field's default. */
function shown(name: string, field: FormField, context: FieldContext): string {
  const values = context.state?.status === "sent" ? null : context.state?.values;
  if (values) return values[name] ?? "";
  return field.defaultValue ?? "";
}

function requiredMark(field: FormField, copy: FormsCopy): string {
  return field.required
    ? ` <span class="gq-form__required" aria-hidden="true">*</span><span class="gq-form__visually-hidden"> (${escapeHtml(copy.required)})</span>`
    : "";
}

/** The description and error elements of a field, and the ids that describe its input. */
function annotations(field: FormField, context: FieldContext) {
  const base = `gq-form-${context.formId}-field-${field.id}`;
  const error = errorText(field, context);
  const ids: string[] = [];
  let html = "";
  if (field.description) {
    ids.push(`${base}-description`);
    html += `<p class="gq-form__description" id="${base}-description">${escapeHtml(field.description)}</p>`;
  }
  if (error) {
    ids.push(`${base}-error`);
    html += `<p class="gq-form__error" id="${base}-error">${escapeHtml(error)}</p>`;
  }
  return {
    html,
    describedBy: ids.length ? ids.join(" ") : null,
    invalid: Boolean(error),
    base,
  };
}

function inputAttributes(
  field: FormField,
  context: FieldContext,
  notes: { describedBy: string | null; invalid: boolean },
) {
  return (
    attribute("aria-describedby", notes.describedBy) +
    (notes.invalid ? ' aria-invalid="true"' : "") +
    (field.required ? ' required aria-required="true"' : "")
  );
}

function fieldClass(field: FormField, invalid: boolean, extra = "") {
  return (
    `gq-form__field gq-form__field--${field.type}${extra}` +
    (invalid ? " gq-form__field--invalid" : "") +
    (field.cssClass ? ` ${field.cssClass}` : "")
  );
}

function renderField(field: FormField, context: FieldContext): string {
  const { formId, copy } = context;
  if (field.type === "html")
    return `<div class="gq-form__html${field.cssClass ? ` ${escapeHtml(field.cssClass)}` : ""}">${field.content ?? ""}</div>`;
  if (field.type === "section")
    return (
      `<div class="gq-form__section"><h3 class="gq-form__section-title">${escapeHtml(field.label)}</h3>` +
      (field.description
        ? `<p class="gq-form__description">${escapeHtml(field.description)}</p>`
        : "") +
      `</div>`
    );
  if (field.type === "hidden" || field.visibility === "hidden")
    return field.inputs
      .map(
        (input) =>
          `<input type="hidden" name="${escapeHtml(input.name)}" value="${escapeHtml(field.defaultValue ?? "")}">`,
      )
      .join("");

  const notes = annotations(field, context);
  const first = field.inputs[0];
  if (!first) return "";
  const classes = escapeHtml(fieldClass(field, notes.invalid));
  const label = escapeHtml(field.label) + requiredMark(field, copy);

  if (field.type === "radio" || field.type === "checkbox") {
    const options = (field.choices ?? []).map((choice, index) => {
      const input = field.type === "checkbox" ? field.inputs[index] : first;
      if (!input) return "";
      const id = `${inputId(formId, input.name)}-${index}`;
      const values = context.state?.status === "sent" ? null : context.state?.values;
      const checked = values ? values[input.name] === choice.value : choice.selected;
      return (
        `<div class="gq-form__choice"><input type="${field.type}" id="${id}" name="${escapeHtml(input.name)}" value="${escapeHtml(choice.value)}"${checked ? " checked" : ""}${attribute("aria-describedby", notes.describedBy)}${notes.invalid ? ' aria-invalid="true"' : ""}>` +
        `<label for="${id}">${escapeHtml(choice.text)}</label></div>`
      );
    });
    return (
      `<fieldset class="${classes}"${field.required ? ' aria-required="true"' : ""}><legend class="gq-form__label">${label}</legend>` +
      notes.html +
      options.join("") +
      `</fieldset>`
    );
  }

  if (field.type === "consent") {
    const id = inputId(formId, first.name);
    const checked = shown(first.name, field, context) === "1";
    const policy = context.privacyPolicy
      ? ` <a class="gq-form__policy" href="${escapeHtml(context.privacyPolicy.url)}">${escapeHtml(context.privacyPolicy.title)}</a>`
      : "";
    const consentText = field.consent?.description
      ? `<p class="gq-form__description gq-form__consent-text" id="${notes.base}-text">${escapeHtml(field.consent.description)}</p>`
      : "";
    const describedBy = [notes.describedBy, consentText ? `${notes.base}-text` : null]
      .filter(Boolean)
      .join(" ");
    return (
      `<fieldset class="${classes}"><legend class="gq-form__label">${label}</legend>` +
      notes.html +
      consentText +
      `<div class="gq-form__choice"><input type="checkbox" id="${id}" name="${escapeHtml(first.name)}" value="1"${checked ? " checked" : ""}${attribute("aria-describedby", describedBy || null)}${notes.invalid ? ' aria-invalid="true"' : ""}${field.required ? ' required aria-required="true"' : ""}>` +
      `<label for="${id}">${escapeHtml(field.consent?.checkboxLabel ?? field.label)}</label>${policy}</div>` +
      `</fieldset>`
    );
  }

  if (field.type === "name" && field.inputs.length > 1) {
    const parts = field.inputs.map((input) => {
      const id = inputId(formId, input.name);
      return (
        `<div class="gq-form__name-part"><label for="${id}">${escapeHtml(input.label)}</label>` +
        `<input type="text" id="${id}" name="${escapeHtml(input.name)}" value="${escapeHtml(shown(input.name, field, context))}"${attribute("autocomplete", input.autocomplete)}${attribute("placeholder", input.placeholder)}${attribute("aria-describedby", notes.describedBy)}${notes.invalid ? ' aria-invalid="true"' : ""}></div>`
      );
    });
    return (
      `<fieldset class="${classes}"${field.required ? ' aria-required="true"' : ""}><legend class="gq-form__label">${label}</legend>` +
      notes.html +
      parts.join("") +
      `</fieldset>`
    );
  }

  const id = inputId(formId, first.name);
  const common =
    attribute("placeholder", field.placeholder) +
    (field.maxLength ? ` maxlength="${field.maxLength}"` : "") +
    inputAttributes(field, context, notes);
  let control: string;
  if (field.type === "textarea") {
    control = `<textarea id="${id}" name="${escapeHtml(first.name)}" rows="6"${common}>${escapeHtml(shown(first.name, field, context))}</textarea>`;
  } else if (field.type === "select") {
    const value =
      context.state?.values && context.state.status !== "sent"
        ? shown(first.name, field, context)
        : null;
    const choices = field.choices ?? [];
    const hasEmpty = choices.some((choice) => choice.value === "");
    const options =
      (hasEmpty ? "" : `<option value=""${value === "" ? " selected" : ""}></option>`) +
      choices
        .map((choice) => {
          const selected = value !== null ? value === choice.value : choice.selected;
          return `<option value="${escapeHtml(choice.value)}"${selected ? " selected" : ""}>${escapeHtml(choice.text)}</option>`;
        })
        .join("");
    control = `<select id="${id}" name="${escapeHtml(first.name)}"${inputAttributes(field, context, notes)}>${options}</select>`;
  } else {
    const inputmode = field.type === "number" ? ' inputmode="decimal"' : "";
    const autocomplete =
      field.type === "name" ? "name" : (AUTOCOMPLETE[field.type] ?? first.autocomplete);
    control = `<input type="${INPUT_TYPE[field.type] ?? "text"}" id="${id}" name="${escapeHtml(first.name)}" value="${escapeHtml(shown(first.name, field, context))}"${attribute("autocomplete", autocomplete)}${inputmode}${common}>`;
  }
  let confirmation = "";
  const second = field.inputs[1];
  if (field.type === "email" && second) {
    const confirmId = inputId(formId, second.name);
    confirmation =
      `<label class="gq-form__label" for="${confirmId}">${escapeHtml(second.label)}${requiredMark(field, copy)}</label>` +
      `<input type="email" id="${confirmId}" name="${escapeHtml(second.name)}" value="${escapeHtml(shown(second.name, field, context))}" autocomplete="email"${inputAttributes(field, context, notes)}>`;
  }
  return (
    `<div class="${classes}"><label class="gq-form__label" for="${id}">${label}</label>` +
    notes.html +
    control +
    confirmation +
    `</div>`
  );
}

/** Turnstile loads only once the visitor interacts with a form (CONSENT-1, CN-R3). */
export const FORMS_TURNSTILE_SCRIPT = `(()=>{const s="https://challenges.cloudflare.com/turnstile/v0/api.js?render=explicit";let l;const load=()=>l??=new Promise((ok,no)=>{const e=document.createElement("script");e.src=s;e.async=true;e.onload=()=>ok(window.turnstile);e.onerror=no;document.head.append(e)});for(const f of document.querySelectorAll("form[data-gq-turnstile]")){const start=()=>{if(f.dataset.gqTurnstileStarted)return;f.dataset.gqTurnstileStarted="1";load().then(t=>t.render(f.querySelector("[data-gq-turnstile-widget]"),{sitekey:f.dataset.gqTurnstile,"response-field-name":"cf-turnstile-response"}))};f.addEventListener("focusin",start,{once:true});f.addEventListener("pointerdown",start,{once:true})}})();`;

/**
 * A `gravityforms/form` block's HTML. Without a descriptor (the CMS hasn't
 * delivered one) or for an unavailable form, a status message instead of a
 * form that can't be sent.
 */
export function renderGravityForm(input: GravityFormInput): string {
  const copy = FORMS_COPY[formsCopyLanguage(input.language)];
  const descriptor = input.descriptor;
  if (!descriptor || !descriptor.available)
    return `<div class="gq-form gq-form--unavailable"${descriptor ? ` id="gq-form-${descriptor.id}"` : ""}><p class="gq-form__status" role="status">${escapeHtml(copy.unavailable)}</p></div>`;
  const formId = descriptor.id;
  const state = input.state && input.state.formId === formId ? input.state : null;
  const policy = input.legal?.roles.find((role) => role.role === "privacy_policy");
  const context: FieldContext = {
    formId,
    copy,
    state,
    privacyPolicy: policy ? { url: policy.url, title: policy.title || copy.privacyPolicy } : null,
  };
  const level = input.headingLevel ?? 2;
  const titleId = `gq-form-${formId}-title`;
  const heading =
    input.showTitle !== false && descriptor.title
      ? `<h${level} class="gq-form__title" id="${titleId}">${escapeHtml(descriptor.title)}</h${level}>`
      : "";
  const description =
    input.showDescription !== false && descriptor.description
      ? `<p class="gq-form__intro">${escapeHtml(descriptor.description)}</p>`
      : "";
  const open = `<div class="gq-form" id="gq-form-${formId}" data-gq-form="${formId}" lang="${escapeHtml(input.language)}">${heading}${description}`;

  if (state?.status === "sent") {
    const message =
      state.confirmation ||
      (descriptor.confirmation.type === "message" ? descriptor.confirmation.message : "") ||
      copy.sent;
    return `${open}<div class="gq-form__status gq-form__status--sent" role="status">${message
      .split(/\n{2,}/)
      .map((paragraph) => `<p>${escapeHtml(paragraph.trim())}</p>`)
      .join("")}</div></div>`;
  }

  let status = "";
  if (state) {
    const problems = descriptor.fields.flatMap((field) => {
      const error = errorText(field, context);
      if (!error) return [];
      const target = field.inputs[0];
      const anchor =
        field.type === "radio" || field.type === "checkbox"
          ? `${inputId(formId, target!.name)}-0`
          : inputId(formId, target!.name);
      return [`<li><a href="#${anchor}">${escapeHtml(field.label)}: ${escapeHtml(error)}</a></li>`];
    });
    const summary =
      state.status === "invalid"
        ? copy.errorSummary
        : state.status === "verification"
          ? copy.verification
          : state.status === "too-many"
            ? copy.tooMany
            : copy.failed;
    status =
      `<div class="gq-form__errors" role="alert" id="gq-form-${formId}-errors" tabindex="-1">` +
      `<p>${escapeHtml(summary)}</p>${problems.length ? `<ul>${problems.join("")}</ul>` : ""}</div>`;
  }

  const required = descriptor.fields.some(
    (field) => field.required && field.visibility === "visible",
  )
    ? `<p class="gq-form__legend">${escapeHtml(copy.requiredFields)}</p>`
    : "";
  const honeypot = descriptor.honeypot
    ? `<div class="gq-form__hp" aria-hidden="true" style="position:absolute!important;left:-9999px!important;width:1px;height:1px;overflow:hidden"><label for="${inputId(formId, descriptor.honeypot.name)}">${escapeHtml(copy.honeypot)}</label><input type="text" id="${inputId(formId, descriptor.honeypot.name)}" name="${escapeHtml(descriptor.honeypot.name)}" value="" tabindex="-1" autocomplete="off"></div>`
    : "";
  const turnstile = input.turnstile?.siteKey
    ? `<div class="gq-form__turnstile" data-gq-turnstile-widget></div><noscript><p class="gq-form__status">${escapeHtml(copy.needsJavaScript)}</p></noscript>`
    : "";
  const script = input.turnstile?.siteKey ? `<script>${FORMS_TURNSTILE_SCRIPT}</script>` : "";

  return (
    open +
    status +
    `<form class="gq-form__form" method="post" action="${formAction(formId)}" novalidate` +
    (heading ? ` aria-labelledby="${titleId}"` : "") +
    attribute("data-gq-turnstile", input.turnstile?.siteKey || null) +
    `>` +
    `<input type="hidden" name="gq_source" value="${escapeHtml(input.source)}">` +
    required +
    honeypot +
    descriptor.fields.map((field) => renderField(field, context)).join("") +
    turnstile +
    `<div class="gq-form__actions"><button type="submit" class="gq-form__submit">${escapeHtml(descriptor.submitLabel || copy.submit)}</button></div>` +
    `</form></div>` +
    script
  );
}

/**
 * A minimal default stylesheet (layout and states only). Sites usually style
 * the `gq-form*` classes with their own tokens instead.
 */
export const FORMS_STYLES = `
.gq-form__visually-hidden{position:absolute!important;width:1px;height:1px;padding:0;margin:-1px;overflow:hidden;clip:rect(0,0,0,0);white-space:nowrap;border:0}
.gq-form__form{display:grid;gap:var(--gq-form-gap,1rem)}
.gq-form__field{display:grid;gap:.375rem;border:0;margin:0;padding:0;min-width:0}
.gq-form__field input:not([type=checkbox]):not([type=radio]),.gq-form__field textarea,.gq-form__field select{font:inherit;width:100%;padding:.5rem .75rem;border:1px solid var(--gq-form-border,#767676);border-radius:var(--gq-form-radius,.25rem)}
.gq-form__field--invalid input,.gq-form__field--invalid textarea,.gq-form__field--invalid select{border-color:var(--gq-form-error,#b00020)}
.gq-form__error,.gq-form__errors{color:var(--gq-form-error,#b00020)}
.gq-form__errors{border:2px solid currentColor;padding:1rem}
.gq-form__choice{display:flex;gap:.5rem;align-items:baseline}
.gq-form :focus-visible{outline:3px solid var(--gq-form-focus,#1a73e8);outline-offset:2px}
`.trim();

export type { FormDescriptor, FormField } from "./descriptor";
export type { FormState } from "./state";
export { blockFormId, findForm, GRAVITY_FORMS_BLOCK } from "./descriptor";
export { readFormState, clearFormStateCookie, FORM_STATE_PARAM } from "./state";
