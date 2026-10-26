// @getquick/content/forms/server: the Site's form endpoint (ADR 0009),
// `POST /gq/forms/<formId>`. Framework-neutral (standard Request/Response),
// for the Site's Frontend Worker. It accepts posts from the Site itself only,
// bounds the body, validates it against the form's published descriptor,
// applies the Site's spam controls (Gravity Forms' honeypot always; Turnstile
// when the Site uses it), then submits to Gravity Forms' REST submissions
// endpoint without any Gravity Forms credential. Gravity Forms validates
// again, stores the entry, runs its spam checks and sends its notifications.
// Without JavaScript the answer is a redirect back to the page with the
// outcome (post/redirect/get). Nothing here reads entries.
import { formDiagnostics, FORMS_PATH, type FormDescriptor } from "./descriptor";
import { FORMS_COPY, formsCopyLanguage } from "./copy";
import { formStateCookie, formStateLocation, type FormState, type FormStatus } from "./state";
import { honeypotFilled, validateSubmission } from "./validate";
import { isSameOrigin, readBoundedBody } from "../request-guards";

/** The largest form body accepted (bytes); larger posts are refused unread. */
export const MAX_FORM_BYTES = 64 * 1024;
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
  /** The page language for the handler's own messages (`pt-PT`, `en`). */
  language?: string;
  /** Milliseconds Gravity Forms and Turnstile have to answer (15 s). */
  timeoutMs?: number;
  fetch?: typeof globalThis.fetch;
}

/** Gravity Forms' answer to `POST /gf/v2/forms/<id>/submissions`, as far as it is used. */
interface SubmissionResult {
  is_valid?: boolean;
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
  const timeoutMs = config.timeoutMs ?? 15_000;
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

  /** Gravity Forms' field messages, by field id. */
  function fieldMessages(value: SubmissionResult["validation_messages"]): Record<number, string> {
    if (!value || typeof value !== "object") return {};
    return Object.fromEntries(
      Object.entries(value).flatMap(([id, message]) =>
        /^\d+$/.test(id) && typeof message === "string" && message
          ? [[Number(id), htmlText(message)]]
          : [],
      ),
    );
  }

  async function submit(
    request: Request,
    formId: number,
    source: string,
    params: URLSearchParams,
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
    if (Object.keys(checked.errors).length)
      return outcome(
        request,
        { formId, status: "invalid", errors: checked.errors, values: checked.values },
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
        !(await verifyTurnstile(secret, token, request.headers.get("CF-Connecting-IP")))
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

    let response: Response;
    try {
      response = await fetcher(`${restRoot}/gf/v2/forms/${formId}/submissions`, {
        method: "POST",
        headers: { "Content-Type": "application/json", Accept: "application/json", ...access },
        body: JSON.stringify(checked.input),
        redirect: "manual",
        signal: AbortSignal.timeout(timeoutMs),
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

  /** `POST /gq/forms/<id>`. */
  async function handlePost(request: Request, formId: number): Promise<Response> {
    if (request.method !== "POST")
      return json(405, { error: "Send forms with POST." }, { Allow: "POST" });
    if (!isSameOrigin(request, origins))
      return json(403, { error: "Forms are accepted from this Site only." });
    if (!/^application\/x-www-form-urlencoded\b/i.test(request.headers.get("Content-Type") ?? ""))
      return json(415, { error: "Send the form as application/x-www-form-urlencoded." });
    const bindings = await config.bindings();
    const text = await readBoundedBody(request, MAX_FORM_BYTES);
    if (text === null) return json(413, { error: "The form is too large." });
    const params = new URLSearchParams(text);
    const source = params.get("gq_source") ?? "";
    if (!SOURCE.test(source) || source.length > 2048)
      return json(400, { error: "The form's page (gq_source) isn't a path on this Site." });
    const limiter = bindings.FORMS_RATE_LIMITER;
    if (limiter) {
      // The client IP keys the limit for this request only; it is never stored.
      const { success } = await limiter.limit({
        key: `${formId}:${request.headers.get("CF-Connecting-IP") ?? "unknown"}`,
      });
      if (!success) return outcome(request, { formId, status: "too-many" }, source);
    }
    return submit(request, formId, source, params);
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
