// A commerce-style Worker consumer (#28): only the neutral consent export and
// its server pieces, with no Composer plugin, CMS binding, content runtime
// initialisation or Design package. The storefront adapter's server side.
import {
  consentConfiguration,
  consentCookie,
  consentRecordRequest,
  decide,
  promptReason,
  readConsentCookie,
  serviceGranted,
} from "@getquick/content/consent";
import { createConsentServer, type ConsentBindings } from "@getquick/content/consent/server";

type Env = ConsentBindings & { REVISION: string };

// Turnstile is necessary on checkout; GA4 is switched on by settings.
const configuration = consentConfiguration({
  services: ["turnstile"],
  analytics: { enabled: true, measurementId: "G-SHOP1234" },
  controller: "Shop, SA",
});
const consent = (env: Env) => createConsentServer({ siteId: "shop", bindings: () => env });

export default {
  async fetch(request: Request, env: Env): Promise<Response> {
    const handled = await consent(env).handle(request);
    if (handled) return handled;
    const url = new URL(request.url);
    const previous = readConsentCookie(request.headers.get("Cookie"));
    if (url.pathname === "/state") {
      return Response.json({
        revision: env.REVISION,
        prompt: promptReason(configuration, previous),
        analytics: serviceGranted(configuration, previous, "ga4"),
        turnstile: serviceGranted(configuration, previous, "turnstile"),
        categories: configuration.categories,
        version: configuration.version,
      });
    }
    if (url.pathname === "/decide" && request.method === "POST") {
      const accept = url.searchParams.get("choice") === "accept_all";
      const { state, action } = decide(
        configuration,
        previous,
        accept ? { kind: "accept_all" } : { kind: "reject_all" },
      );
      return Response.json(
        {
          record: consentRecordRequest(state, action, {
            language: "pt-PT",
            uiVersion: "storefront-proof",
          }),
        },
        { headers: { "Set-Cookie": consentCookie(state, { secure: false }) } },
      );
    }
    // Test-only routes: rows as stored, and a decision recorded years ago.
    if (url.pathname === "/rows") {
      const { results } = await env
        .CONSENT_DB!.prepare("SELECT * FROM consent_records ORDER BY id")
        .all();
      return Response.json(results);
    }
    if (url.pathname === "/seed-old" && request.method === "POST") {
      await env
        .CONSENT_DB!.prepare(
          `INSERT INTO consent_records (consent_id, site_id, recorded_at, decided_at, expires_at, config_version,
            legal_revisions, preferences, analytics, marketing, external_media, action, language, ui_version)
           VALUES ('11111111-1111-4111-8111-111111111111', 'shop', '2019-01-01T00:00:00.000Z',
            '2019-01-01T00:00:00.000Z', '2019-07-02T00:00:00.000Z', 'abcdef0123456789', '{}', 0, 1, 0, 0,
            'accept_all', 'pt-PT', 'old')`,
        )
        .run();
      return Response.json({ seeded: true });
    }
    if (url.pathname === "/purge" && request.method === "POST")
      return Response.json(await consent(env).purge());
    return new Response("Not found", { status: 404 });
  },
  // The Site's purge schedule (gq-site provisions the cron trigger).
  async scheduled(_controller: unknown, env: Env): Promise<void> {
    await consent(env).purge();
  },
};
