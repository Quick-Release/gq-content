# Render blocks with gq-design's injected HTML adapter

Status: proposed, 2026-10-24; decisions below agreed in
maintainer interview, 2026-11-02. Remaining decisions below must be settled
before acceptance. Originally proposed as ADR 0007 in PR #41; renumbered because
main now uses 0007 for development nightlies and 0008 for forms.

## Current baseline

[ADR 0006](0006-serve-cms-selected-header-and-footer-patterns-with-site-chrome.md),
including its accepted Tailwind amendment, already stores optional neutral
`designBlocks` on publications and reads `getquickBlocksJson` through WPGraphQL.
It bundles immutable Design renderer and contract build inputs into the public
content package; Sites do not install private Design packages for that path.
The implementation now covers native text/media/navigation, Grid, Query,
Carousel and Hero, presentation styles and browser behavior. The original
Video-Hero-only account in this proposal predates those changes.

The existing `DesignBlockRenderer` returns a string. Its declared node has
name, attributes, content and children, without explicit version or complete
rendered fallback metadata. Body parsing preserves additional validated fields;
chrome parsing currently reconstructs the node and drops additional fields.
Both parsers need explicit compatibility coverage. The current Design serializer emits saved leaf content, not complete
WordPress-rendered HTML for every subtree. This proposal requires a provider
contract change; merely switching GraphQL selections cannot supply fallback.

## Agreed ownership

GQ Design owns markup, presentation CSS and required browser behavior for its
supported block capabilities, including supported native `core/*` blocks.
This is broader than the `getquick-design/*` namespace. Its framework-neutral
HTML adapter renders synchronously from supplied context and never fetches.
Browser behavior must have a separately usable browser entry; the HTML adapter
must run in a Worker without React, Astro, DOM or Node runtime dependencies.

GQ Content owns publication storage, traversal, fallback selection, consent
enforcement and data preloading. Sites retain renderers that take precedence
over the Design adapter. Native capabilities not covered by Design and
third-party blocks use WordPress fallback unless a Site supplies a renderer.

The adapter is injected by the Site and stays private on GitHub Packages.
The public `@getquick/content` artifact retains its installation contract:
no private runtime, peer or type dependency and no registry credentials needed
to install it. Site wiring imports the adapter; Blueprint provisioning and
version pins belong to gq-site.

On acceptance, this replaces ADR 0006's bundled Design integration for these
rendering responsibilities, and the content-rendering/private-package parts of
[gq-site ADR 0018](https://github.com/Quick-Release/gq-site/blob/main/docs/adr/0018-ship-gq-designs-contract-and-renderer-as-lockstep-packages.md).
The provider adapter and its contract belong to gq-design (#83); Blueprint
adoption belongs to gq-site (#125). Those owners must reconcile their own
records and tickets in their own repository sessions.

## Agreed fallback semantics

WordPress fallback is complete rendered HTML for the node's entire subtree.
Selecting it terminates adapter traversal below that node: descendants are not
rendered again, appended or inserted into guessed wrapper positions. This
preserves WordPress's child placement and avoids duplicate descendants.

A supported Design or Site renderer can compose its children through the
runtime. A nested unsupported or dynamic child can therefore use its complete
WordPress subtree fallback. Conversely, if an unsupported wrapper contains a
Design Hero, the entire wrapper including that Hero uses WordPress HTML.
There is no whole-page rendering mode switch.

Structurally malformed trees fail the read and preserve last-known-good content,
as ADR 0006 requires for chrome. Unsupported or invalid block capabilities in an
otherwise valid envelope are a separate per-node fallback case. Empty rendered
HTML is a valid successful result and is distinct from a missing fallback.

## Agreed adapter outcomes

The injected interface explicitly distinguishes rendered HTML from a decline
with a reason. A successful empty string is valid. Exceptions are reported and
select WordPress subtree fallback, just as explicit declines do. Site overrides
retain precedence. Exact TypeScript names are implementation details; the public
contract must express these outcomes without importing private Design types.

## Agreed stored compatibility

Extend the existing optional tree with version and complete-fallback metadata;
do not introduce a second competing publication tree. Saved leaf content is not
implicitly complete rendered fallback. Keep older HTML-only rows and existing
neutral trees servable until refreshed. The adapter supports older stored data
within its supported contract major. Unknown additive attributes alone do not
force rejection; incompatible versions or unsupported capabilities may decline.

Plugin-first upgrades and Frontend rollback must be tested with newer stored
nodes using WordPress fallback. Preserve producer/wire version and fallback
metadata through parsing, JSON round-trip and delivery. Contract-major and
capability compatibility must be distinguishable from exact package pairing.
The case where no renderer and no usable fallback exists remains open below.

## Agreed consent boundary

An injected renderer receives a runtime-owned media transformation function.
It gates the media that renderer generates before combining it with children
already processed by the runtime. Do not reprocess the final composed HTML:
that can damage trusted placeholder hooks. Complete WordPress fallback receives
the same policy at delivery. Stored data stays as published under ADR 0003.

With consent enabled, unapproved external media stays inert, including unknown
or inactive services. Tests cover generated and fallback media, nesting,
activation, revocation and language. Without consent configured, preserve the
existing media behavior. Exceptions in consent enforcement must not expose raw
media; their exact delivery failure behavior remains to be settled.

## Agreed upstream gates

Implementation readiness and Site rollout are separate gates. This change
requires the published provider capabilities it consumes: an adapter covering
supported Design and native capabilities, complete rendered subtree fallback,
version metadata, CSS and browser entries, and consent integration, with
compatibility evidence. Relevant unresolved Tailwind defects still block.
Closure of every fleet-acceptance item in Design #82 is not a blanket blocker
for content implementation. Its published 0.9.0 packages are already baseline.

Design #83 and Blueprint #125 need corresponding owner-side scope updates.
This ADR records the consumer requirements; their records and tickets must be
changed only in sessions bound to their owning repositories.

## Remaining decisions before acceptance

- Failure when neither renderer nor usable fallback can serve a node, and
  consent transformation fails: promotion, last-known-good and HTTP behavior.
- Legacy Site renderer compatibility, exact package pairing versus stored wire
  compatibility, and CSS/browser behavior during fallback and rollout.
- Data and performance: preserve preloaded Query/Post context, clarify that one
  GraphQL request is per source read (Query hydration can read more entries),
  measure any removal of whole-page `content`, bound rendering and decide any
  rendered-output cache identity.
- Existing-Site inventory, upgrade/rollback evidence and the final acceptance
  matrix. Do not infer rollout safety from the unverified claim that no Site
  is in production.

## Upstream status checked 2026-11-02

[gq-design#82](https://github.com/Quick-Release/gq-design/issues/82) is open.
Its comments report published 0.9.0 packages and merged content, Blueprint,
Nomia and Ekis adoption, while acceptance evidence remains outstanding. It is
not an unpublished release waiting for these helpers.
[gq-design#83](https://github.com/Quick-Release/gq-design/issues/83) is open with
no discussion evidence of an implemented HTML adapter. Its current scope must
be reconciled with the agreed native-capability and subtree-fallback boundary.
