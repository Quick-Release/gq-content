import type { APIRoute } from "astro";
import { consent } from "../../lib/site";

// POST /gq/consent: the record endpoint, wired straight to the package.
export const ALL: APIRoute = async ({ request }) =>
  (await consent.handle(request)) ?? new Response(null, { status: 404 });
