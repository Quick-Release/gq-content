# Consent and legal links (CONSENT-1, LEGAL-1)

Provider documentation for the consent foundation in `@getquick/content` and
the `legal`/`analytics` settings events in `getquick/gq-content`. Criteria are
owned by gq-platform's [CONSENT-1](https://github.com/Quick-Release/gq-platform/blob/claude/cookie-consent-foundation/docs/foundations/consent.md)
and [LEGAL-1](https://github.com/Quick-Release/gq-platform/blob/claude/cookie-consent-foundation/docs/foundations/legal-pages.md)
(Proposed; legal review pending). Decision: [ADR 0003](adr/0003-ship-the-consent-foundation-as-isolated-exports.md).

## Exports

For the neutral HTML entry and adoption guidance, see the platform-owned
[consent HTML reference](https://github.com/Quick-Release/gq-platform/blob/main/docs/runtime/gq-content/consent-html.md)
([platform PR #273](https://github.com/Quick-Release/gq-platform/pull/273)).

| Entry                                  | Runs in           | Contents                                                                                                                                                                                                                                                                                                                                                                                               |
| -------------------------------------- | ----------------- | ------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------------ |
| `@getquick/content/consent`            | anywhere          | `CONSENT_CATEGORIES`, `OPTIONAL_CATEGORIES`, `SERVICE_CATALOG`, `consentConfiguration`, `needsBanner`, `CONSENT_COOKIE`, `readConsentCookie`, `consentCookie`, `promptReason`, `serviceGranted`, `grantedCategories`, `decide`, `consentRecordRequest`, `parseConsentRecordRequest`, `CONSENT_COPY`, `rewriteEmbeds`, `embedPlaceholder`, `parseLegalLanguage`, `legalRevisions`, `CONSENT_UI_VERSION` |
| `@getquick/content/consent/client`     | browser           | `startConsent()`: reads the rendered configuration, applies decisions, loads catalog services after their grant, records decisions                                                                                                                                                                                                                                                                     |
| `@getquick/content/consent/server`     | Worker / server   | `createConsentServer({ siteId, bindings, siteOrigins?, trustedProxies?, retentionDays? })` → `handle`, `handleRecord`, `handleRead`, `purge`, `check`; `CONSENT_EXPORT_COLUMNS`                                                                                                                                                                                                                        |
| `@getquick/content/consent/migrations` | Node (infra) only | `consentMigrationsDirectory`                                                                                                                                                                                                                                                                                                                                                                           |
| `@getquick/content/consent/html`       | server (any)      | `ConsentPageInput`, `ConsentPage`, `consentPage`, `legalFooter`, `CONSENT_STYLES`                                                                                                                                                                                                                                                                                                                      |
| `@getquick/content/consent/astro`      | server (any)      | Compatible re-export of `/consent/html`                                                                                                                                                                                                                                                                                                                                                                |
| `@getquick/content/consent/testing`    | Node + Playwright | `runConsentAcceptance`, `capture`, `scanConsentHtml`, `isThirdPartyUrl`, `failures`                                                                                                                                                                                                                                                                                                                    |

The neutral entries import no framework, WordPress client, publication store,
zod or Node module. Commerce uses `/consent`, `/consent/server` and
`/consent/migrations` without the Composer plugin or content runtime.

## Categories, catalog and configuration

Categories are fixed: `necessary`, `preferences`, `analytics`, `marketing`,
`external_media`. The catalog is closed: `consent` and `turnstile`
(necessary), `ga4` (analytics), `youtube`, `vimeo`, `google_maps`
(external_media). Each entry names its provider, purpose, storage, retention
and hosts. Sites declare services in code; GA4 becomes active only from
gq-config's toggle with a valid `G-` measurement ID (`analytics` setting). An
unknown service throws.

`consentConfiguration({ services, analytics, controller })` returns the
active services and categories and a 16-hex configuration version: a SHA-256 of
the active categories, services, a controller hash and `CONSENT_COPY_REVISION`.
Copy edits keep the revision; only a reviewed material copy change bumps it.

## Decisions and the consent cookie

`gq_consent` is first party, `Path=/`, `SameSite=Lax`, `Secure` on HTTPS,
`Max-Age` 395 days (13 months). Its value is base64url JSON: version, consent
ID (UUID v4), decision time, the four optional decisions, the active services
and controller hash at decision time, the configuration version, the record
action and whether the Worker confirmed the record. It is written only when the
visitor decides.

- A decision is valid for 6 months; a rejection is not re-asked sooner.
- Material changes prompt again: a new category, a new service in a granted
  category, or another controller (an unknown controller, before the Legal
  Contract names one, is not a change). A new service in a rejected category and a
  removed service do not. Until the new decision, a service the visitor never
  saw is denied.
- Actions: `accept_all`, `reject_all`, `custom`; `withdraw` when a category in
  force is no longer granted; `renew` when deciding after expiry or a material
  change. The consent ID is kept across decisions.
- Withdrawal removes the first-party storage the catalog lists for withdrawn
  categories (e.g. `_ga*` cookies) and disables further loading; third-party
  cookies are listed as such.

## Embeds

With `createContentRuntime({ consent: { services, firstPartyHosts?, cmsSettings? } })`
every published home and entry body passes through `rewriteEmbeds` at delivery
(stored rows stay as published). Iframes of active catalog services become
placeholders: no live `src`, the provider and purpose, **Load once** and
**Always allow external media**. Third-party iframes, embeds and objects of
unknown hosts or inactive services, and every third-party or inline executable
script, are replaced by a generic blocked placeholder carrying
`data-gq-consent-blocked="<host>"`. Opaque sources (`data:`, `javascript:`, `srcdoc`) and
objects/embeds without a first-party source are blocked too. First-party
(relative, CMS origin, configured hosts, `about:blank`) and non-executable
content is untouched. Published HTML cannot carry the Runtime's hooks:
`data-gq-consent-*`, `data-gq-embed` and similar attributes in it are renamed
`data-gq-published-*` before rewriting, and the client only acts on decision
buttons inside its own banner/panel and loads an embed only when its HTTPS URL
belongs to the catalog service the placeholder names. The Getquick Design
video hero becomes a decorative placeholder (no notice, loads on a grant).
Site components call `embedPlaceholder({ service, src, title, width, height, language })`.
`scanConsentHtml(html, { siteOrigin })` returns live third-party sources and
blocked placeholders: the diagnostic report for acceptance and readiness.
Images and other media from third-party hosts are reported as live sources but
not rewritten.

## Astro wiring

```astro
---
import { consentPage } from "@getquick/content/consent/astro";
const configuration = content.consentConfiguration(chrome);
const ui = consentPage({ configuration, language: lang, legal: chrome?.legal, cookie: Astro.request.headers.get("cookie") });
---
<html lang={lang}><head><Fragment set:html={ui.head} /></head>
<body><Fragment set:html={ui.body} /> … <footer><Fragment set:html={ui.footer} /></footer>
<script>import { startConsent } from "@getquick/content/consent/client"; startConsent();</script></body></html>
```

`body` is the banner (first in focus order, non-modal so legal pages stay
readable, `hidden` while a decision is in force) and the preferences
`<dialog>`; `footer` is the legal links and the **Cookie settings** control.
Without an optional service there is no banner and nothing is recorded; the
control still lists the necessary storage. The client re-applies grants on
`astro:page-load`. Sites restyle through the `--gq-consent-*` custom properties.

### Replacement UI markup Contract

A replacement UI keeps these hooks and passes `runConsentAcceptance`:
`#gq-consent-config` (JSON from `consentPage().head`), `#gq-consent-banner`,
`#gq-consent-preferences` (`<dialog>`), buttons with `data-gq-consent-accept-all`,
`-reject-all`, `-customise`, `-open`, `-save`, `-close`, checkboxes
`input[data-gq-consent-category][value=<category>]`, `[data-gq-consent-id]`,
and placeholders' `data-gq-consent-load-once` / `data-gq-consent-allow`.

## Records endpoint

`POST /gq/consent`, same origin only: `Origin` must equal the request origin,
a configured Site origin, or the `Host` header; `Sec-Fetch-Site`, when sent,
must be `same-origin`. `Content-Type: application/json`, at most 2048 bytes,
exactly these fields:

```json
{
  "consentId": "uuid-v4",
  "decidedAt": "ISO UTC",
  "configVersion": "hex",
  "legalRevisions": { "cookie_policy": "…" },
  "decisions": {
    "preferences": false,
    "analytics": false,
    "marketing": false,
    "external_media": true
  },
  "action": "custom",
  "language": "pt-PT",
  "uiVersion": "gq-content@0.3.0"
}
```

The Worker adds the Site ID and its own UTC time. `201` appended, `200`
duplicate (same consent ID and decision time), `400` invalid, `403` not same
origin, `405`, `413` too large, `415`, `429` rate limited, `503` not
configured or storage failed (the browser retries; the choice stays applied).
With `CONSENT_RATE_LIMITER` (a Workers Rate Limiting binding), the limit is
keyed on the client IP for that request (`CF-Connecting-IP`, or a trusted
proxy's forwarded address; an IPv6 client by its /64; see
[client-ip.md](client-ip.md)); no IP or user agent is stored.

## Read endpoints

`Authorization: Bearer <CONSENT_READ_TOKEN>` (at least 32 characters; held by
the CMS as `GETQUICK_CONSENT_READ_TOKEN`). All responses `Cache-Control: no-store`.

- `GET /gq/consent/records/<consentId>` → `{ consentId, records: ConsentRecord[] }`
  oldest first; `404` when none.
- `GET /gq/consent/export?from=YYYY-MM-DD&to=YYYY-MM-DD` → `text/csv`, UTC days
  inclusive, at most 366 days. Columns: `recorded_at,consent_id,site_id,action,config_version,language,ui_version,preferences,analytics,marketing,external_media,legal_revisions`
  (booleans `true`/`false`, revisions as a JSON object, RFC 4180 quoting, CRLF).
- `GET /gq/consent/stats?from&to` → `{ from, to, total, byAction: {…5 actions}, byCategory: { <category>: { granted, denied } } }`.
- `401` missing/invalid bearer, `400` invalid ID or range, `503` not configured
  or storage failure.

`ConsentRecord` is `{ consentId, siteId, recordedAt, configVersion,
legalRevisions, decisions, action, language, uiVersion }`.

## Database and retention

`CONSENT_DB` is its own D1 database per Site and stage, created with
`jurisdiction: "eu"` by the Blueprint (this package cannot set or verify it),
migrated from `consentMigrationsDirectory`. Rows are append-only (an update
trigger aborts). `purge()` deletes records whose decision stopped being in
force (superseded by a later record for the same consent ID, or 6 months after
it was recorded) more than `retentionDays` ago (default and maximum 1826, i.e.
5 years). Wire it to the Worker's scheduled handler.

## Legal links

With `consent.cmsSettings: true` each language's chrome read also queries
gq-config's `getquickLegal(language: <slug>)` and `googleAnalytics`, stored as
`chrome.legal` and `chrome.analytics`. Requires gq-config with the
`getquickLegal` field: when gq-config's schema lacks it, the chrome is still
read with no Contract and GA4 off (a warning is logged); any other failure keeps
the last stored chrome. A null `googleAnalytics` reads as disabled. The CMS
sends `legal` and `analytics` settings events, which refresh every language's
chrome; visitor requests read D1 only.

## Proofs

`vp run consent` (Astro fixture in Chromium), `vp run consent-worker` (workerd
and local D1, isolation), `vp run consent-tanstack` (TanStack Start build and
browser), plus unit suites under `frontend/tests/consent-*.test.ts`. Evidence
is written to `.proofs/consent/`.

## Not covered here

D1 jurisdiction provisioning, the rate-limit binding, the purge cron trigger,
readiness checks and Site wiring (gq-site); the Consent tab and Legal Contract
(gq-config); the TanStack/React adapter and default UI (gq-storefront); legal
review of copy, validity and retention (ADR 0008 open items).
