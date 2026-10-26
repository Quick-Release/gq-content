// The Site's form endpoint, as gq-site's managed adapter binds it.
import type { APIRoute } from "astro";
import { formsServer } from "../../../lib/forms";

export const prerender = false;

export const ALL: APIRoute = async ({ request, params }) => {
  const formId = Number(/^\d+/.exec(params.rest ?? "")?.[0] ?? 0);
  return (await formsServer(formId).handle(request)) ?? new Response(null, { status: 404 });
};
