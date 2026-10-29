# gq-content

The GETQUICK content runtime: how a content Site's CMS tells its Frontend about
published changes, and how the Frontend keeps serving them. Two halves of one
protocol, released together under one version:

- `getquick/gq-content`: a must-use WordPress plugin (publication and settings
  events, delivery retries, `wp gq-events`), from the private Composer registry.
- `@getquick/content`: an npm package for the Frontend (events, delivery,
  publication store, reconciliation, WPGraphQL client, HTML block helpers,
  language helpers and its D1 migrations).

The Frontend helpers, configured client, durable delivery and CMS plugin are
implemented locally; the paired release gates remain pending. Work follows
[#1](https://github.com/Quick-Release/gq-content/issues/1), which extracts it
from gq-site's app skeleton in one cut
([gq-platform ADR 0001](https://github.com/Quick-Release/gq-platform/blob/main/docs/adr/0001-ownership-of-work-across-getquick-repositories.md)).

The [implementation contract](docs/specs/issue-1-content-runtime-extraction.md)
incorporates [#2](https://github.com/Quick-Release/gq-content/issues/2) and
gq-site ADR 0018. [Extraction decisions](docs/adr/0001-release-the-content-runtime-as-a-configured-package-pair.md),
[runtime decisions](docs/adr/0002-preserve-publication-delivery-and-withdrawal-through-extraction.md)
and the [readiness investigation](docs/planning/issue-1-readiness.md) record the
accepted scope and the runnable proofs still required before release.

The [CMS installation instructions](cms/README.md) describe its single entry
point, configuration, diagnostics and supported filters.

Published Design fixture compatibility (P5) is opt-in so ordinary development
and the public consumer remain credential-free. See
[the compatibility workspace](compatibility/README.md) for installation,
scoped registry access and `vp run design-fixtures`.

The [consent foundation](docs/consent.md) (CONSENT-1/LEGAL-1, gq-platform ADR 0008) ships as isolated `@getquick/content/consent*` exports usable by commerce
without the plugin or content runtime, with `legal`/`analytics` settings events
on the CMS side.

Behind a reverse proxy the Site runs, the form and consent endpoints take the
client IP from that proxy only when told to trust it
([`trustedProxies`](docs/client-ip.md)).

Headless Gravity Forms (gq-platform ADR 0009) ships as isolated
`@getquick/content/forms*` exports and a CMS module that is dormant without
Gravity Forms. Form descriptors travel with publications
([ADR 0008](docs/adr/0008-deliver-gravity-forms-descriptors-with-publications.md)),
and submissions go to Gravity Forms' REST submissions endpoint without a
credential. Nothing reads entries.

[Paired release operations](docs/releasing.md) describe building one retained
candidate, validating its exact bytes, and safely resuming publication. Publication
requires exact-revision CI proofs and owner-provided registry enrollment/access;
local checks alone cannot declare the pair released.

CMS-selected patterns and saved blocks use the canonical Design presentation
model. Install the resolved theme and presentation styles once per response:

```ts
import { designThemeStyleSheet, presentationStyleSheet } from "@getquick/content";
const css = designThemeStyleSheet(theme) + presentationStyleSheet(theme);
```

Grid has no implicit track or gap presets. Native layout context and explicit
neutral responsive controls are compiled by the shared renderer; Site per-block
renderers still take precedence. Upgrade both runtime packages together to
0.4.2 through the Site's blueprint-managed pins alongside Design 0.9. See
[the 0.4.2](docs/releases/0.4.2.md), [0.4.1](docs/releases/0.4.1.md) and [0.4.0](docs/releases/0.4.0.md) release notes and
[0.3.2's](docs/releases/0.3.2.md) for rollout and browser mounting.
