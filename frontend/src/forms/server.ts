// @getquick/content/forms/server: the Site's form endpoint (ADR 0009),
// `POST /gq/forms/<formId>`. Framework-neutral (standard Request/Response),
// for the Site's Frontend Worker. It accepts posts from the Site itself only,
// bounds the body, validates it against the form's published descriptor,
// applies the Site's spam controls (Gravity Forms' honeypot always; Turnstile
// when the Site uses it), then submits to Gravity Forms' REST submissions
// endpoint without any Gravity Forms credential. A form with a file upload
// field posts multipart/form-data: its files are checked by count, size,
// extension and content, then sent on as multipart (ADR 0010 here).
// Gravity Forms validates again, stores the entry and its files, runs its
// spam checks and sends its notifications.
// Without JavaScript the answer is a redirect back to the page with the
// outcome (post/redirect/get). Nothing here reads entries.
import { formDiagnostics, FORMS_PATH, hasUploads, type FormDescriptor } from "./descriptor";
import { FORMS_COPY, formsCopyLanguage } from "./copy";
import { formStateCookie, formStateLocation, type FormState, type FormStatus } from "./state";
import { honeypotFilled, validateSubmission } from "./validate";
import { validateUploads, type SubmittedFiles } from "./uploads";
import { isSameOrigin, readBoundedBody, readBoundedBytes } from "../request-guards";
import { clientAddressResolver, rateLimitKey } from "../client-ip";

/** The largest form body accepted (bytes); larger posts are refused unread. */
export const MAX_FORM_BYTES = 64 * 1024;
/** The largest multipart (upload) body accepted by default (bytes), files included. */
export const MAX_UPLOAD_BYTES = 10 * 1024 * 1024;
/** The most `maxUploadBytes` may be: the Worker holds a post in memory. */
export const MAX_UPLOAD_BYTES_LIMIT = 32 * 1024 * 1024;
/** Cloudflare's server-side Turnstile verification. */
export const TURNSTILE_SITEVERIFY_URL = "https://challenges.cloudflare.com/turnstile/v0/siteverify";
/** The field Turnstile's widget posts its token in. */
export const TURNSTILE_RESPONSE_FIELD = "cf-turnstile-response";

/** A Workers Rate Limiting binding. */
export interface FormsRateLimiter {
  limit(options: { key: string }): Promise<{ success: boolean }>;
}

/** The Worker bindings the handler reads. None is a Gravity Forms credential. */
export interface FormsBindings {
  /** Turnstile's secret key (a Worker secret), when the Site uses Turnstile. */
  TURNSTILE_SECRET_KEY?: string;
  /**
   * A Cloudflare Access service token for the CMS's submissions path only,
   * when the CMS is behind Access. Both or neither.
   */
  GQ_FORMS_ACCESS_CLIENT_ID?: string;
  GQ_FORMS_ACCESS_CLIENT_SECRET?: string;
  /** Rate limiting for form posts, keyed per client IP per request. */
  FORMS_RATE_LIMITER?: FormsRateLimiter;
}

export interface FormLookup {
  formId: number;
  /** The page the form was posted from (a path on the Site). */
  source: string;
}

export interface FormsServerConfig {
  /** The CMS's origin (https://cms.example.com): Gravity Forms' REST API is under it. */
  cmsOrigin: string;
  /** WordPress's REST root, when not `<cmsOrigin>/wp-json`. */
  restRoot?: string;
  /**
   * The form's descriptor as published with the page it was posted from
   * (the content runtime's `publishedForm(source, formId)`), or null.
   */
  descriptor: (lookup: FormLookup) => Promise<FormDescriptor | null> | FormDescriptor | null;
  /** The Site's spam controls. The honeypot is always applied when a form enables it. */
  spam?: { turnstile?: boolean };
  bindings: () => FormsBindings | Promise<FormsBindings>;
  /** The Site's public origin(s), when the Worker sees another (a proxy). */
  siteOrigins?: readonly string[];
  /**
   * The reverse proxies the Site runs in front of the Worker, as IPv4/IPv6
   * addresses or CIDRs. Only a request whose `CF-Connecting-IP` is one of
   * them has its client IP taken from the proxy's `X-Forwarded-For` /
   * `X-Real-IP` (docs/client-ip.md).
   */
  trustedProxies?: readonly string[];
  /** The page language for the handler's own messages (`pt-PT`, `en`). */
  language?: string;
  /**
   * The hard cap on a multipart post, files included (bytes; 10 MiB, at most
   * 32 MiB). Keep it within what the Site's proxies and the CMS's PHP
   * (`post_max_size`) accept.
   */
  maxUploadBytes?: number;
  /** Milliseconds Gravity Forms and Turnstile have to answer (15 s; 60 s for uploads). */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** Gravity Forms' answer to `POST /gf/v2/forms/<id>/submissions`, as far as it is used. */
interface SubmissionResult {
  is_valid?: boolean;
  /** A message per field; a list of messages for a multiple file upload. */
  validation_messages?: Record<string, unknown> | unknown[];
  confirmation_type?: string;
  confirmation_message?: unknown;
  confirmation_redirect?: unknown;
}

const SOURCE = /^\/(?!\/)[^\s\\]*$/;

/** HTML as text: tags dropped, paragraphs and breaks as new lines, entities decoded. */
export function htmlText(html: string): string {
  return html
    .replace(/<(script|style)\b[\s\S]*?<\/\1>/gi, "")
    .replace(/<br\s*\/?>/gi, "\n")
    .replace(/<\/(p|div|li|h[1-6])>/gi, "\n\n")
    .replace(/<[^>]*>/g, "")
    .replace(/&#(\d+);/g, (_, code: string) => String.fromCodePoint(Number(code)))
    .replace(/&#x([0-9a-f]+);/gi, (_, code: string) => String.fromCodePoint(parseInt(code, 16)))
    .replace(/&nbsp;/g, " ")
    .replace(/&quot;/g, '"')
    .replace(/&lt;/g, "<")
    .replace(/&gt;/g, ">")
    .replace(/&amp;/g, "&")
    .replace(/[ \t]+\n/g, "\n")
    .replace(/\n{3,}/g, "\n\n")
    .trim()
    .slice(0, 2000);
}

/**
 * The form endpoint. `handle` answers `POST /gq/forms/<id>` and null for any
 * other path; `check` says what is configured, for readiness, never values.
 */
export function createFormsServer(config: FormsServerConfig) {
  const cms = new URL(config.cmsOrigin);
  if (cms.protocol !== "https:" && cms.protocol !== "http:")
    throw new Error("cmsOrigin must be the CMS's http(s) origin");
  const restRoot = (config.restRoot ?? `${cms.origin}/wp-json`).replace(/\/+$/, "");
  if (new URL(restRoot).origin !== cms.origin)
    throw new Error("restRoot must be on the CMS's origin");
  const origins = new Set((config.siteOrigins ?? []).map((origin) => new URL(origin).origin));
  const clientAddress = clientAddressResolver(config.trustedProxies);
  const timeoutMs = config.timeoutMs ?? 15_000;
  const uploadTimeoutMs = config.timeoutMs ?? 60_000;
  const maxUploadBytes = config.maxUploadBytes ?? MAX_UPLOAD_BYTES;
  if (
    !Number.isInteger(maxUploadBytes) ||
    maxUploadBytes < MAX_FORM_BYTES ||
    maxUploadBytes > MAX_UPLOAD_BYTES_LIMIT
  )
    throw new Error(
      `maxUploadBytes must be a whole number of bytes from ${MAX_FORM_BYTES} to ${MAX_UPLOAD_BYTES_LIMIT}`,
    );
  const fetcher = config.fetch ?? globalThis.fetch.bind(globalThis);
  const copy = FORMS_COPY[formsCopyLanguage(config.language)];
  const turnstileRequired = config.spam?.turnstile === true;

  const wantsJson = (request: Request) => {
    const accept = request.headers.get("Accept") ?? "";
    return /\bapplication\/json\b/i.test(accept) && !/\btext\/html\b/i.test(accept);
  };
  const json = (status: number, body: unknown, headers: Record<string, string> = {}) =>
    Response.json(body, { status, headers: { "Cache-Control": "no-store", ...headers } });

  /** The Access pair, if both are set; "partial" is a misconfiguration and fails closed. */
  function accessHeaders(bindings: FormsBindings): Record<string, string> | "partial" {
    const id = bindings.GQ_FORMS_ACCESS_CLIENT_ID?.trim() ?? "";
    const secret = bindings.GQ_FORMS_ACCESS_CLIENT_SECRET?.trim() ?? "";
    if (!id && !secret) return {};
    if (!id || !secret) return "partial";
    return { "CF-Access-Client-Id": id, "CF-Access-Client-Secret": secret };
  }

  /** The answer to a post: JSON for a script that asks for it, else a redirect back. */
  function outcome(
    request: Request,
    state: Omit<FormState, "values" | "messages" | "errors"> &
      Partial<Pick<FormState, "values" | "messages" | "errors">>,
    source: string,
  ): Response {
    const full: FormState = { values: {}, messages: {}, errors: {}, ...state };
    if (wantsJson(request)) {
      const statusCode: Record<FormStatus, number> = {
        sent: 200,
        invalid: 422,
        verification: 422,
        "too-many": 429,
        "too-large": 413,
        failed: 502,
      };
      return json(statusCode[full.status], {
        status: full.status,
        errors: Object.fromEntries(
          Object.entries(full.errors).map(([id, code]) => [
            id,
            full.messages[Number(id)] ?? copy.errors[code],
          ]),
        ),
        ...(full.confirmation ? { confirmation: full.confirmation } : {}),
      });
    }
    return new Response(null, {
      status: 303,
      headers: {
        Location: formStateLocation(source, full.formId),
        "Set-Cookie": formStateCookie(full, { secure: new URL(request.url).protocol === "https:" }),
        "Cache-Control": "no-store",
      },
    });
  }

  async function verifyTurnstile(
    secret: string,
    token: string,
    ip: string | null,
  ): Promise<boolean> {
    const body = new URLSearchParams({ secret, response: token });
    if (ip) body.set("remoteip", ip);
    try {
      const response = await fetcher(TURNSTILE_SITEVERIFY_URL, {
        method: "POST",
        body,
        signal: AbortSignal.timeout(timeoutMs),
      });
      if (!response.ok) return false;
      const result = (await response.json()) as { success?: unknown };
      return result.success === true;
    } catch (error) {
      console.error(`Forms: Turnstile couldn't be verified: ${(error as Error).name}`);
      return false;
    }
  }

  /** Gravity Forms' field messages, by field id; a multiple file upload's list is joined. */
  function fieldMessages(value: SubmissionResult["validation_messages"]): Record<number, string> {
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).flatMap(([id, message]) => {
        const list = (Array.isArray(message) ? message : [message]).filter(
          (each): each is string => typeof each === "string" && each !== "",
        );
        const text = list.map(htmlText).filter(Boolean).join("\n");
        return /^\d+$/.test(id) && text ? [[Number(id), text]] : [];
      }),
    );
  }

  async function submit(
    request: Request,
    formId: number,
    source: string,
    params: URLSearchParams,
    files: SubmittedFiles,
  ): Promise<Response> {
    const bindings = await config.bindings();
    let descriptor: FormDescriptor | null;
    try {
      descriptor = await config.descriptor({ formId, source });
    } catch (error) {
      console.error(
        `Forms: form ${formId}'s descriptor couldn't be read: ${(error as Error).message}`,
      );
      descriptor = null;
    }
    if (!descriptor || descriptor.id !== formId || !descriptor.available)
      return outcome(request, { formId, status: "failed" }, source);
    const diagnostics = formDiagnostics(descriptor);
    if (diagnostics.length) {
      console.error(
        `Forms: form ${formId} isn't submitted: ${diagnostics.map((each) => each.code).join(", ")}`,
      );
      return outcome(request, { formId, status: "failed" }, source);
    }

    // A bot filled the honeypot: answered as sent, and nothing reaches the CMS.
    const sent = {
      formId,
      status: "sent" as const,
      ...(descriptor.confirmation.type === "message" && descriptor.confirmation.message
        ? { confirmation: descriptor.confirmation.message }
        : {}),
    };
    if (honeypotFilled(descriptor, params)) return outcome(request, sent, source);

    const checked = validateSubmission(descriptor, params);
    const uploads = await validateUploads(descriptor, files);
    const errors = { ...checked.errors, ...uploads.errors };
    if (Object.keys(errors).length)
      return outcome(
        request,
        { formId, status: "invalid", errors, values: checked.values },
        source,
      );

    if (turnstileRequired) {
      const secret = bindings.TURNSTILE_SECRET_KEY?.trim();
      if (!secret) {
        console.error("Forms: Turnstile is required but TURNSTILE_SECRET_KEY isn't bound");
        return outcome(request, { formId, status: "failed", values: checked.values }, source);
      }
      const token = params.get(TURNSTILE_RESPONSE_FIELD) ?? "";
      if (
        !token ||
        token.length > 2048 ||
        !(await verifyTurnstile(secret, token, clientAddress(request)))
      )
        return outcome(request, { formId, status: "verification", values: checked.values }, source);
    }

    const access = accessHeaders(bindings);
    if (access === "partial") {
      console.error(
        "Forms: set both GQ_FORMS_ACCESS_CLIENT_ID and GQ_FORMS_ACCESS_CLIENT_SECRET, or neither",
      );
      return outcome(request, { formId, status: "failed", values: checked.values }, source);
    }

    // Gravity Forms reads files from $_FILES: a form with uploads is sent as
    // multipart, each file with the type its content proved. Others stay JSON.
    const multipart = hasUploads(descriptor);
    let body: string | FormData = JSON.stringify(checked.input);
    if (multipart) {
      body = new FormData();
      for (const [name, value] of Object.entries(checked.input)) body.append(name, value);
      for (const each of uploads.files)
        body.append(each.name, new Blob([each.file], { type: each.type }), each.filename);
    }
    let response: Response;
    try {
      response = await fetcher(`${restRoot}/gf/v2/forms/${formId}/submissions`, {
        method: "POST",
        headers: {
          ...(multipart ? {} : { "Content-Type": "application/json" }),
          Accept: "application/json",
          ...access,
        },
        body,
        redirect: "manual",
        signal: AbortSignal.timeout(multipart ? uploadTimeoutMs : timeoutMs),
      });
    } catch (error) {
      console.error(`Forms: form ${formId} couldn't reach the CMS: ${(error as Error).name}`);
      return outcome(request, { formId, status: "failed", values: checked.values }, source);
    }
    let result: SubmissionResult | null = null;
    try {
      result = (await response.json()) as SubmissionResult;
    } catch {
      result = null;
    }
    if (response.status === 200 && result?.is_valid === true) {
      if (
        result.confirmation_type === "redirect" &&
        typeof result.confirmation_redirect === "string"
      ) {
        let target: URL | null = null;
        try {
          target = new URL(result.confirmation_redirect);
        } catch {
          target = null;
        }
        // A page confirmation is the CMS's permalink: the Site serves it at the same path.
        if (target && target.origin === cms.origin)
          target = new URL(`${target.pathname}${target.search}${target.hash}`, request.url);
        if (target && (target.protocol === "https:" || target.protocol === "http:")) {
          const location =
            target.origin === new URL(request.url).origin
              ? `${target.pathname}${target.search}${target.hash}`
              : target.href;
          if (wantsJson(request)) return json(200, { status: "sent", redirect: location });
          return new Response(null, {
            status: 303,
            headers: { Location: location, "Cache-Control": "no-store" },
          });
        }
      }
      const message =
        typeof result.confirmation_message === "string"
          ? htmlText(result.confirmation_message)
          : "";
      return outcome(
        request,
        { formId, status: "sent", ...(message ? { confirmation: message } : sent) },
        source,
      );
    }
    if (response.status === 400 && result?.is_valid === false) {
      const messages = fieldMessages(result.validation_messages);
      const errors = Object.fromEntries(
        Object.keys(messages).map((id) => [Number(id), "required" as const]),
      );
      return outcome(
        request,
        { formId, status: "invalid", errors, messages, values: checked.values },
        source,
      );
    }
    console.error(`Forms: Gravity Forms refused form ${formId} (HTTP ${response.status})`);
    return outcome(request, { formId, status: "failed", values: checked.values }, source);
  }

  /**
   * A post over its cap. A form with uploads also names its page in the action
   * (`?gq_source=`), so the visitor is sent back to it with the outcome.
   */
  function tooLarge(request: Request, formId: number): Response {
    const source = new URL(request.url).searchParams.get("gq_source") ?? "";
    if (SOURCE.test(source) && source.length <= 2048)
      return outcome(request, { formId, status: "too-large" }, source);
    return json(413, { error: "The form is too large." });
  }

  /** `POST /gq/forms/<id>`. */
  async function handlePost(request: Request, formId: number): Promise<Response> {
    if (request.method !== "POST")
      return json(405, { error: "Send forms with POST." }, { Allow: "POST" });
    if (!isSameOrigin(request, origins))
      return json(403, { error: "Forms are accepted from this Site only." });
    const type = request.headers.get("Content-Type") ?? "";
    const multipart = /^multipart\/form-data\b/i.test(type);
    if (!multipart && !/^application\/x-www-form-urlencoded\b/i.test(type))
      return json(415, {
        error: "Send the form as application/x-www-form-urlencoded or multipart/form-data.",
      });
    const bindings = await config.bindings();
    let params: URLSearchParams;
    let files: SubmittedFiles = { getAll: () => [] };
    if (multipart) {
      const bytes = await readBoundedBytes(request, maxUploadBytes);
      if (bytes === null) return tooLarge(request, formId);
      let data: FormData;
      try {
        data = await new Response(bytes, { headers: { "Content-Type": type } }).formData();
      } catch {
        return json(400, { error: "The form isn't valid multipart/form-data." });
      }
      params = new URLSearchParams();
      for (const [name, value] of data) if (typeof value === "string") params.append(name, value);
      files = data;
    } else {
      const text = await readBoundedBody(request, MAX_FORM_BYTES);
      if (text === null) return tooLarge(request, formId);
      params = new URLSearchParams(text);
    }
    const source = params.get("gq_source") ?? "";
    if (!SOURCE.test(source) || source.length > 2048)
      return json(400, { error: "The form's page (gq_source) isn't a path on this Site." });
    const limiter = bindings.FORMS_RATE_LIMITER;
    if (limiter) {
      // The client IP keys the limit for this request only; it is never stored.
      const { success } = await limiter.limit({
        key: `${formId}:${rateLimitKey(clientAddress(request))}`,
      });
      if (!success) return outcome(request, { formId, status: "too-many" }, source);
    }
    return submit(request, formId, source, params, files);
  }

  /** Routes a form post; null when the path isn't a form endpoint. */
  async function handle(request: Request): Promise<Response | null> {
    const path = new URL(request.url).pathname.replace(/\/+$/, "");
    if (!path.startsWith(`${FORMS_PATH}/`)) return null;
    const id = path.slice(FORMS_PATH.length + 1);
    if (!/^[1-9]\d{0,8}$/.test(id)) return null;
    return handlePost(request, Number(id));
  }

  /** What is configured, for readiness: never values. */
  async function check() {
    const bindings = await config.bindings();
    const access = accessHeaders(bindings);
    return {
      cmsOrigin: cms.origin,
      spam: {
        honeypot: true,
        turnstile: turnstileRequired,
      },
      turnstileSecret: Boolean(bindings.TURNSTILE_SECRET_KEY?.trim()),
      access: access === "partial" ? "partial" : Object.keys(access).length ? "configured" : "none",
      rateLimit: Boolean(bindings.FORMS_RATE_LIMITER),
      maxUploadBytes,
      ready:
        (!turnstileRequired || Boolean(bindings.TURNSTILE_SECRET_KEY?.trim())) &&
        access !== "partial",
    };
  }

  return { handle, check };
}

export type FormsServer = ReturnType<typeof createFormsServer>;
export { FORMS_PATH };
export type { FormDescriptor } from "./descriptor";
