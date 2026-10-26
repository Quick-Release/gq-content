// The fixture Site's forms, as its publications would carry them: Nomia's
// contact form, a form readiness must fail, and two copies of the contact form
// behind Turnstile (Cloudflare's always-passing and always-failing secrets).
import { env } from "cloudflare:workers";
import type { FormDescriptor } from "@getquick/content/forms";
import { createFormsServer, type FormsServer } from "@getquick/content/forms/server";
import {
  CONTACT_FORM,
  TURNSTILE_TEST_KEYS,
  UNSUPPORTED_FORM,
} from "@getquick/content/forms/testing";

export const FORMS: Record<number, { descriptor: FormDescriptor; page: string }> = {
  1: { descriptor: CONTACT_FORM, page: "/contactos/" },
  2: { descriptor: UNSUPPORTED_FORM, page: "/candidatura/" },
  4: { descriptor: { ...CONTACT_FORM, id: 4 }, page: "/turnstile/" },
  5: { descriptor: { ...CONTACT_FORM, id: 5 }, page: "/turnstile-falha/" },
};

const vars = env as unknown as { CMS_ORIGIN: string };

/** As `content.publishedForm(source, formId)` finds it: on the page it was posted from. */
const descriptor = ({ formId, source }: { formId: number; source: string }) => {
  const form = FORMS[formId];
  return form && form.page === source ? form.descriptor : null;
};

const servers = new Map<string, FormsServer>();
/** Turnstile with the always-passing (4) or always-failing (5) secret; honeypot only otherwise. */
export function formsServer(formId: number): FormsServer {
  const key = formId === 4 ? "pass" : formId === 5 ? "fail" : "none";
  let server = servers.get(key);
  if (!server) {
    server = createFormsServer({
      cmsOrigin: vars.CMS_ORIGIN,
      descriptor,
      spam: { turnstile: key !== "none" },
      bindings: () => ({
        ...(key === "pass" ? { TURNSTILE_SECRET_KEY: TURNSTILE_TEST_KEYS.passingSecretKey } : {}),
        ...(key === "fail" ? { TURNSTILE_SECRET_KEY: TURNSTILE_TEST_KEYS.failingSecretKey } : {}),
      }),
      language: "pt-PT",
    });
    servers.set(key, server);
  }
  return server;
}
