import type { APIRoute } from "astro";
import { consent } from "../../../lib/site";

// The authenticated read endpoints.
export const ALL: APIRoute = async ({ request }) =>
  (await consent.handle(request)) ?? new Response(null, { status: 404 });
