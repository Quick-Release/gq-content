// Typechecked against the installed declarations: every forms export a Site
// and gq-site's adapter use, without the content or consent runtime.
import {
  formsReadiness,
  parseFormDescriptors,
  type FormDescriptor,
  type FormsReadiness,
} from "@getquick/content/forms";
import { renderGravityForm, type GravityFormInput } from "@getquick/content/forms/astro";
import {
  createFormsServer,
  type FormsBindings,
  type FormsServerConfig,
} from "@getquick/content/forms/server";
import { CONTACT_FORM, gravityFormsStub } from "@getquick/content/forms/testing";

const descriptors: FormDescriptor[] = parseFormDescriptors(JSON.stringify([CONTACT_FORM])) ?? [];
const readiness: FormsReadiness = formsReadiness(descriptors, { spam: ["honeypot"] });
const input: GravityFormInput = { descriptor: descriptors[0] ?? null, source: "/", language: "en" };
const html: string = renderGravityForm(input);
const bindings: FormsBindings = { TURNSTILE_SECRET_KEY: "x" };
const config: FormsServerConfig = {
  cmsOrigin: "https://cms.example",
  descriptor: () => CONTACT_FORM,
  bindings: () => bindings,
  fetch: gravityFormsStub([CONTACT_FORM]).fetchFor("https://cms.example"),
};
const handled: Promise<Response | null> = createFormsServer(config).handle(
  new Request("https://x/"),
);
export { readiness, html, handled };
