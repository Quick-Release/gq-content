# Render blocks with gq-design's injected HTML adapter

Status: proposed, 2026-10-24; decisions below agreed in
maintainer interview, 2026-11-02. The consolidated design awaits final
maintainer confirmation before acceptance, with the Query withdrawal exception
below still open. Originally proposed as ADR 0007 in PR #41; renumbered because
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
Both parsers need explicit compatibility coverage. The current Design
serializer emits saved leaf content, not complete WordPress-rendered HTML for every subtree. This proposal requires a provider
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
retain precedence. Existing Site renderers returning strings remain compatible:
a string means successful rendering, while explicit result objects allow decline.
Existing context fields stay available, with the runtime-owned media function
added. Existing Site-generated media keeps its current Site responsibility; the
new helper is available to those renderers too. Exact TypeScript names are
implementation details; the public contract expresses the outcomes without
importing private Design types.

Child composition must be demand-driven so a parent selecting complete fallback
does not first render or preload descendants solely for adapter output. A
declining Site override selects fallback under the same rules.

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
Extend the existing publication body without changing its format number or D1
migrations, following ADRs 0004 and 0006. New metadata must distinguish a legacy
tree from an incomplete new-contract tree; missing new fields must not silently
downgrade a damaged new tree into the legacy path.

## Agreed consent boundary

An injected renderer receives a runtime-owned media transformation function.
It gates the media that renderer generates before combining it with children
already processed by the runtime. Do not reprocess the final composed HTML:
that can damage trusted placeholder hooks. Complete WordPress fallback receives
the same policy at delivery. Stored data stays as published under ADR 0003.

With consent enabled, unapproved external media stays inert, including unknown
or inactive services. Tests cover generated and fallback media, nesting,
activation, revocation and language. Without consent configured, preserve the
existing media behavior. Consent transformation failure makes the response
unavailable (503); it must not be swallowed as an ordinary renderer exception
and return raw media. See the failure policy below.

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

## Agreed failure and Query behavior

New-contract reads require complete fallback metadata for every node. Missing
metadata, malformed envelopes or exceeded bounds fail the read and keep the
last-known-good publication; they cannot promote partial content. Explicitly
empty fallback HTML remains valid. Legacy rows retain their compatibility path.

At delivery, an unrenderable node with no usable fallback makes the response
unavailable (503). Do not silently omit it, return a partial successful response,
or attempt a fresh CMS read to repair an existing row during an ordinary visit.
This preserves ADR 0002's distinction between missing and unavailable content.
It does not add a store of earlier publication revisions or override withdrawals.

Query selection and ordering come from stored producer data. Referenced
Post/Page publications use the existing loader and last-known-good rules; only
a never-held reference can invoke cold lookup. Hydration stays outside the
synchronous adapter. A failed dependency selects the Query block's entire
WordPress subtree fallback rather than dropping an item. This requires hydration
failures to remain attributable to their owning Query block. Missing fallback
then follows the 503 rule above. Custom post type loading remains explicitly
caller-owned; this decision does not silently expand the default loader.

One WPGraphQL request means one per entry/home source read. It is not a promise
that an entire page's dependent Query hydration makes only one request. Existing
request budgets, withdrawal handling and independently refreshed child
publications still apply.

## Open exception: Query snapshots after confirmed absence

The agreed hydration fallback policy needs one explicit qualification. A stored
WordPress Query subtree can contain copies of selected entries, including Post
Content. If a selected entry is later withdrawn, neutral hydration currently
refuses it, but unconditional fallback can expose the old snapshot. ADR 0002
explicitly protects the entry's routes; it does not specify copied Query output.

The current preload boundary reduces missing, withdrawn, unavailable and moved
results to null, so the implementation must retain distinct outcomes to enforce
a qualified policy. Pending maintainer decision: whether authoritative absence
makes snapshots containing that reference unusable (including ancestor
fallback), yielding 503 under the no-partial-output rule, while temporary
unavailability can still use eligible fallback. Preserve enough dependency
identity to apply the chosen policy even if a wrapper uses complete fallback.
This is a consumer contract requirement for coordination with the provider.

## Agreed performance and rollout gates

Render stored source data at delivery without adding a rendered HTML cache in
this implementation. Retain whole-page `content` until complete per-node
fallback and measurements justify removing it. Measure CMS response cost and
Worker CPU and memory for representative mixed/nested pages and bounded maximum
fixtures, including the aggregate cost of complete fallback HTML at every node.
Document numerical CPU, memory, tree and payload limits and acceptance results
before release. Budget failure requires a design review, not silently adding a
cache. Any future rendered cache needs a separate decision accounting for
publication identity, adapter and Site override versions, theme, language,
consent configuration and preloaded context.

Rollout requires an inventory of affected content Sites and verified upgrade and
rollback combinations. Plugin and adapter installed pins are exact pairs;
temporary deployment drift is supported only for tested combinations. WordPress
fallback must preserve essential presentation and browser behavior under those
combinations, including the CSS and browser entries actually deployed. If that
fails, plugin-first deployment or Frontend rollback cannot be called safe.
Do not infer readiness from the unverified claim that no Site is in production.
Blueprint and Site owners own their adoption and deployment evidence.

## Acceptance and owner handoff

Content implementation criteria are consolidated in
[issue #42](https://github.com/Quick-Release/gq-content/issues/42). That issue
requires acceptance of this ADR plus the published provider capabilities listed
above; it does not depend on merging unrelated fleet acceptance work.

Owner-side follow-up requirements are recorded here and in #42:

- Design #83: supported native and Design capability scope; complete rendered
  subtree fallback and its metadata; supported older data and version decline;
  CSS/browser entries; consent integration; Worker and real fixture evidence.
- Blueprint #125: injection and Site override wiring, registry read access,
  exact pin pairing, affected-Site inventory and tested rollout/rollback gates.
- gq-site ADR 0018 and the shared platform ownership/vocabulary records: reconcile
  the superseded content rendering statements through their owning sessions.

No cross-repository writes, renderer implementation, release, deployment or PR
merge are authorized by this interview. Those owner-side updates are pending;
the consumer requirements here do not claim their providers have delivered them.

## Upstream status checked 2026-11-02

[gq-design#82](https://github.com/Quick-Release/gq-design/issues/82) is open.
Its comments report published 0.9.0 packages and merged content, Blueprint,
Nomia and Ekis adoption, while acceptance evidence remains outstanding. It is
not an unpublished release waiting for these helpers.
[gq-design#83](https://github.com/Quick-Release/gq-design/issues/83) is open with
no discussion evidence of an implemented HTML adapter. Its current scope must
be reconciled with the agreed native-capability and subtree-fallback boundary.
