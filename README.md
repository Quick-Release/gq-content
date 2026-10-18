# gq-content

The GETQUICK content runtime: how a content Site's CMS tells its Frontend about
published changes, and how the Frontend keeps serving them. Two halves of one
protocol, released together under one version:

- `getquick/gq-content`: a must-use WordPress plugin (publication and settings
  events, delivery retries, `wp gq-events`), from the private Composer registry.
- `@getquick/content`: an npm package for the Frontend (events, delivery,
  publication store, reconciliation, WPGraphQL client, HTML block helpers,
  language helpers and its D1 migrations).

This repository holds no code yet. The code arrives through
[#1](https://github.com/Quick-Release/gq-content/issues/1), which extracts it
from gq-site's app skeleton in one cut
([gq-platform ADR 0001](https://github.com/Quick-Release/gq-platform/blob/main/docs/adr/0001-ownership-of-work-across-getquick-repositories.md)).

The [implementation contract](docs/specs/issue-1-content-runtime-extraction.md)
incorporates [#2](https://github.com/Quick-Release/gq-content/issues/2) and
gq-site ADR 0018. [Extraction decisions](docs/adr/0001-release-the-content-runtime-as-a-configured-package-pair.md),
[runtime decisions](docs/adr/0002-preserve-publication-delivery-and-withdrawal-through-extraction.md)
and the [readiness investigation](docs/planning/issue-1-readiness.md) record the
accepted scope and the runnable proofs still required before release.
