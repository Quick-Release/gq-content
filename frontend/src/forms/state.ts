// Post/redirect/get without JavaScript: the handler answers every form post
// with a 303 back to the page (`?gq-form=<id>#gq-form-<id>`) and a short-lived
// first-party cookie holding the outcome, the field errors and what the
// visitor typed, so the page renders the form again with them. The page shows
// the outcome only on that redirect's URL, and the cookie expires in minutes.
import type { FormErrorCode } from "./copy";

export type FormStatus = "sent" | "invalid" | "failed" | "verification" | "too-many";

export interface FormState {
  formId: number;
  status: FormStatus;
  /** Field errors by field id: the descriptor check's codes. */
  errors: Record<number, FormErrorCode>;
  /** Gravity Forms' own messages by field id, when it refused the submission. */
  messages: Record<number, string>;
  /** What the visitor typed, by input name (left out when too large to keep). */
  values: Record<string, string>;
  /** Gravity Forms' confirmation message as text, after a submission it accepted. */
  confirmation?: string;
}

/** The query parameter that marks the redirect back after a post. */
export const FORM_STATE_PARAM = "gq-form";
/** Seconds the outcome is kept for the page after the redirect. */
export const FORM_STATE_MAX_AGE = 300;
/** Cookies over this many bytes drop the typed values, then Gravity Forms' messages. */
const MAX_COOKIE_BYTES = 3800;

export const formStateCookieName = (formId: number) => `gq-form-${formId}`;

function encode(value: unknown): string {
  const bytes = new TextEncoder().encode(JSON.stringify(value));
  let binary = "";
  for (const byte of bytes) binary += String.fromCharCode(byte);
  return btoa(binary).replaceAll("+", "-").replaceAll("/", "_").replace(/=+$/, "");
}

function decode(value: string): unknown {
  const binary = atob(value.replaceAll("-", "+").replaceAll("_", "/"));
  return JSON.parse(
    new TextDecoder().decode(Uint8Array.from(binary, (char) => char.charCodeAt(0))),
  ) as unknown;
}

const STATUSES = new Set<FormStatus>(["sent", "invalid", "failed", "verification", "too-many"]);

/** The Set-Cookie header that carries a form's outcome to the page. */
export function formStateCookie(state: FormState, options: { secure: boolean }): string {
  const attempts: unknown[] = [
    { s: state.status, e: state.errors, m: state.messages, v: state.values, c: state.confirmation },
    { s: state.status, e: state.errors, m: state.messages, c: state.confirmation },
    { s: state.status, e: state.errors },
  ];
  let value = "";
  for (const attempt of attempts) {
    value = encode(attempt);
    if (value.length <= MAX_COOKIE_BYTES) break;
  }
  return (
    `${formStateCookieName(state.formId)}=${value}; Path=/; Max-Age=${FORM_STATE_MAX_AGE}; HttpOnly; SameSite=Lax` +
    (options.secure ? "; Secure" : "")
  );
}

/** The Set-Cookie header that removes a form's outcome once the page has shown it. */
export function clearFormStateCookie(formId: number, options: { secure: boolean }): string {
  return (
    `${formStateCookieName(formId)}=; Path=/; Max-Age=0; HttpOnly; SameSite=Lax` +
    (options.secure ? "; Secure" : "")
  );
}

function cookieValue(header: string | null | undefined, name: string): string | null {
  for (const part of (header ?? "").split(";")) {
    const index = part.indexOf("=");
    if (index > 0 && part.slice(0, index).trim() === name) return part.slice(index + 1).trim();
  }
  return null;
}

const stringRecord = (value: unknown): Record<string, string> =>
  typeof value === "object" && value !== null && !Array.isArray(value)
    ? Object.fromEntries(
        Object.entries(value).filter(
          (entry): entry is [string, string] => typeof entry[1] === "string",
        ),
      )
    : {};

const byField = <T extends string>(value: unknown): Record<number, T> =>
  Object.fromEntries(
    Object.entries(stringRecord(value)).flatMap(([key, each]) =>
      /^\d+$/.test(key) ? [[Number(key), each as T]] : [],
    ),
  );

/**
 * A form's outcome for the page: present only on the redirect back after a
 * post to it (`?gq-form=<id>`), from its cookie. Null otherwise.
 */
export function readFormState(
  request: { url: string | URL; cookie: string | null | undefined },
  formId: number,
): FormState | null {
  let url: URL;
  try {
    url = new URL(request.url);
  } catch {
    return null;
  }
  if (url.searchParams.get(FORM_STATE_PARAM) !== String(formId)) return null;
  const raw = cookieValue(request.cookie, formStateCookieName(formId));
  if (!raw) return null;
  let value: unknown;
  try {
    value = decode(raw);
  } catch {
    return null;
  }
  if (typeof value !== "object" || value === null) return null;
  const record = value as Record<string, unknown>;
  if (!STATUSES.has(record.s as FormStatus)) return null;
  return {
    formId,
    status: record.s as FormStatus,
    errors: byField<FormErrorCode>(record.e),
    messages: byField<string>(record.m),
    values: stringRecord(record.v),
    ...(typeof record.c === "string" && record.c ? { confirmation: record.c } : {}),
  };
}

/** Where the handler sends the visitor back to: the page, marked for the form. */
export function formStateLocation(source: string, formId: number): string {
  const url = new URL(source, "https://site.invalid");
  url.searchParams.set(FORM_STATE_PARAM, String(formId));
  url.hash = `gq-form-${formId}`;
  return `${url.pathname}${url.search}${url.hash}`;
}
