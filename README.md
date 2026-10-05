# gq-content

The GETQUICK content runtime: how a content Site's CMS tells its Frontend about
published changes, and how the Frontend keeps serving them. Two halves of one
protocol, released together under one version:

- `getquick/gq-content`: a must-use WordPress plugin (publication and settings
  events, delivery retries, `wp gq-events`), from the private Composer registry.
- `@getquick/content`: an npm package for the Frontend (events, delivery,
  publication store, reconciliation, and its D1 migrations).

The code is being extracted from gq-site's app skeleton
([gq-platform ADR 0001](https://github.com/Quick-Release/gq-platform/blob/main/docs/adr/0001-ownership-of-work-across-getquick-repositories.md)).
