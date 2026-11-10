# Issue 42: injected renderer interface

Status: reconciled consumer proposal, revision 2, 2026-11-02. Implements the interface obligations of
[accepted ADR 0009](../adr/0009-render-gq-design-blocks-with-gq-designs-html-adapter.md).
This document specifies the gq-content side, not the Design wire schema. The dedicated gq-design session has aligned the provider proposal and this
consumer surface; see [provider PR #126](https://github.com/Quick-Release/gq-design/pull/126).
These are coordinated implementation specifications, not published runtime
capabilities. There is no renderer implementation in this change.

## Ownership and installation

GQ Content owns the public injection interface and the delivery policy behind
it. GQ Design owns the provider wire schema and the adapter implementation.
A Site imports the private adapter and passes its registry into the runtime.
Its own registry takes precedence by block name. The content public declarations
reference only content-owned or standard JavaScript types; no private imports.

Keep `DesignBlock`'s existing name, attributes, content and children fields.
The [provider proposal](https://github.com/Quick-Release/gq-design/blob/docs/issue-83-content-rendering-contract/docs/specs/issue-83-content-rendering-contract.md)
places the negotiated metadata in `attributes.gqDesign`. Content validates and
preserves that object without giving saved leaf `content` complete-subtree
semantics. The existing node type already accepts attributes structurally; new
profile validation is an additional read requirement, not a new node tree.

Propose `designDelivery?: "html-subtree-v1"` on `ContentConfig`. When configured,
request `getquickBlocksJson(delivery: HTML_SUBTREE_V1)` and the corresponding
chrome profile in the existing source query. The configured profile is selected
from supported version pins or deployment-time capability discovery. Ordinary
visitor delivery and source reads do not add a discovery request. An old CMS
rejecting the argument fails the strict source read and preserves last-known-good
content; do not silently retry as legacy or promote a partial result. Omission
keeps the existing legacy source query and behavior.

Store `designBlockDelivery: "html-subtree-v1"` beside the existing `designBlocks`
on an entry or front page body, and beside `blocks` on each selected chrome
pattern. This additive stored marker preserves the validation requirement even
if every per-node marker is missing or the tree is empty. Legacy rows omit it.
Known new-profile metadata anywhere also prevents legacy reinterpretation.
Reject a disagreement between stored/read profile and node metadata. Preserve
unknown additive keys while validating known fields; unknown profile semantics
cannot be assumed to provide a usable fallback. Keep format and migrations.

The provider owns exact field semantics, including fallback completeness and
dependency identity. Content never invents or infers copied identities by
rendering a tree. Provider source identity must map to configured CMS/loaders;
metadata does not authorize fetching arbitrary origins or URIs.

## Renderer and context

The following TypeScript is a proposed extension of the existing public seam.
`DesignBlock`, `DesignPostContext` and `DesignTextContext` refer to content-owned
public types. The concrete source shapes below retain existing public fields and add optional
per-item native text. The wire schema remains provider-owned.

```ts
export interface DesignQueryItem {
  id: number | string;
  type?: string;
  slug?: string;
  uri?: string;
}

export interface DesignTextContext {
  site?: { title?: string; description?: string; url?: string };
  post?: {
    uri?: string;
    date?: { text: string; dateTime: string };
    excerpt?: string;
  };
}

export interface DesignPostContext {
  id: number | string;
  title: string;
  blocks: DesignBlock[];
  uri?: string;
  featuredImage?: { sourceUrl: string; altText: string } | null;
  // Added, optional: native text sources belonging to this delivered item.
  textContext?: DesignTextContext;
}

export type DesignRenderResult =
  | { kind: "rendered"; html: string }
  | { kind: "declined"; reason: string };

export type DesignBlockRenderer = (
  block: DesignBlock,
  context: DesignRenderContext,
) => string | DesignRenderResult;

export type DesignPostOutcome =
  | { kind: "found"; post: DesignPostContext }
  | { kind: "missing" }
  | { kind: "withdrawn" }
  | { kind: "unavailable" }
  | { kind: "moved"; uri: string }
  | { kind: "invalid"; reason: string };

export interface DesignRenderContext {
  // Existing fields retain their meanings and availability.
  colorScheme?: "light" | "dark";
  siteTitle?: string;
  post?: DesignPostContext;
  children: string;
  ancestors: DesignBlock[];
  render(blocks: DesignBlock[], post?: DesignPostContext): string;
  href(url: unknown): string;
  home: string;

  // Added capabilities; every runtime-created context supplies these functions.
  mediaHtml(html: string): string;
  resolvePost(item: DesignQueryItem): DesignPostOutcome;
  textContext?: DesignTextContext;
}
```

The provider registry remains `Record<string, DesignBlockRenderer>`. Keep the
existing `blocks` option for Site overrides. The new injected Design registry is
distinct from it so callers need not reproduce precedence:

```ts
export type DesignRendererRegistry = Record<string, DesignBlockRenderer>;
export type DesignRendererSource =
  | DesignRendererRegistry
  | ((sources: { presets: DesignPresets }) => DesignRendererRegistry);
```

`DesignPresets` is the existing content-owned public type containing the served
resolved theme, palette, spacing and typography. Add
`designRenderers?: DesignRendererSource` to `ContentConfig` and
`DesignRenderOptions`. The runtime resolves a factory against the served presets
snapshot without fetching; Site wiring maps those structural values into the
provider factory. A registry value is suitable when independent of changing
theme inputs. Static Site capability extensions/manifest can remain captured by
the Site factory. The same snapshot must drive the corresponding stylesheet.

Runtime-owned body and chrome rendering use the configured registry source;
a per-call `designRenderers` value replaces that source for that call. Per-call
Site `blocks` overrides take precedence over the resolved Design registry.
Where a Site already passes a composed registry through `blocks`, keep that
usage working. Do not install a wildcard renderer to claim catalog coverage.

`children` is a memoized lazy getter. The runtime evaluates it only when a
selected renderer reads it. `render` recursively composes a subset or a Query
item template using the same registries, contextual post and delivery policy.
Choosing fallback never appends or renders descendants solely for adapter output.
Dependency eligibility checks are independent and must still run for fallback.

`resolvePost` reads only preloaded outcomes. It cannot initiate a fetch, decide
selection or refresh content. A redirect/move is not silently treated as missing,
unavailable or a successful identity match: preloading must resolve it under
existing delivery rules and verify the final identity before returning found.
The existing `DesignQueryResolverOptions.resolvePost` callback remains a legacy
input; normalize its post-or-null result at the runtime seam without converting
null into authoritative absence. The runtime loader preserves known missing,
withdrawn and unavailable outcomes before adapting to legacy callers. Bind each
legacy selection to its full provider identity (source, post type, database ID
and language), including verified locator, before returning found; an ID-only
match is insufficient. A legacy null cannot establish current eligibility.

When `render(blocks, post)` changes the contextual post, retain Site-global native
sources and replace the native Post sources with that item's `textContext.post`.
Do not inherit the enclosing page's date/excerpt when an item lacks those sources.
Dates remain explicitly preformatted `{text,dateTime}` values; no Worker locale
or timezone defaults and no newly invented date source. Required absent sources
select reported fallback.

Native Site title/tagline, Post date/excerpt and other source-only values remain
preloaded caller data. The adapter must decline when required context is absent;
it must not invent a date, fetch a logo, select posts or derive an excerpt from
an arbitrary body. Provider reconciliation must account for every existing
native capability, current theme/logo inputs and Query item context.

Design owns presentation processing. The Site constructs the adapter registry with
resolved theme, capability extensions, tokens and CSS configuration from the
provider factory. Reconstruct it for a changed resolved theme when needed; do
not capture a process-global theme for all stored revisions or languages.
Delivery-specific post/native sources use context, not factory globals. Content must not apply its old presentation renderer to
adapter output again. Unrelated Site-owned renderer behavior remains compatible.

## Outcomes and delivery policy

A string is a successful legacy result, including the empty string. Explicit
`rendered` has the same meaning. `declined.reason` is a stable machine-readable
code, not markup; proposed common codes are `unsupported-capability`,
`unsupported-version`, `invalid-attributes` and `missing-context`.
Ordinary renderer exceptions are reported and select eligible complete fallback.
Malformed result objects are invalid adapter output and use that same reported
fallback path. A declining Site override selects fallback rather than silently
falling through to a different renderer.

The runtime reports issues with block path/name, relevant versions and a reason.
Diagnostics must distinguish decline, ordinary exception, incompatible metadata,
unavailable dependency and forbidden fallback. Reporting cannot break successful
fallback delivery. Do not label this a pre-existing live manifest comparison.

Fallback eligibility and consent are runtime-owned policy. They are not ordinary
renderer exceptions. If `render`, `children`, `resolvePost` policy checks or
`mediaHtml` encounter a fatal delivery condition, the runtime preserves it even
if adapter code catches an exception or returns a decline. An implementation can
retain fatal state for the render operation and check it before returning output;
the contract does not require trusting an adapter to rethrow correctly.

Before any fallback, check all Query identities copied by that snapshot, including
under wrappers that the adapter cannot render. Known missing or withdrawn content
makes that snapshot unusable and the response 503. Transient unavailability may
use eligible fallback. A node with no renderer and no usable fallback returns
503. No branch can return a partial 200 or repair an existing row via a visitor
CMS read. Legacy HTML-only delivery keeps its established compatibility path.

## Media composition examples

The examples show call order rather than a block implementation:

```ts
// Renderer validates support and attributes before asking for children.
if (!supported) return { kind: "declined", reason: "unsupported-capability" };

// Gate the newly generated media fragment, then compose trusted child output.
const media = context.mediaHtml(generatedMediaFragment);
const children = context.children;
return { kind: "rendered", html: composeShell(media, children) };
```

Do not pass `children` or the final composed output through `mediaHtml` again.
The runtime binds configuration, served language and first-party hosts. Without
consent it supplies the identity transform; with consent it blocks unapproved
external media. Stored fallback receives the same policy exactly once at delivery.
Consent-processing failure is fatal, not a reason to serve raw fallback media.
Site renderers receive the same helper while retaining responsibility for their
own generated media, as before.

## Evidence required before integration

- Structurally type-check the real provider registry against this public seam,
  without importing private types into the packed content declarations.
- Verify a legacy string Site override, an explicit decline and valid empty HTML.
- Prove that a parent decline does not evaluate children but cannot bypass Query
  fallback eligibility, including known withdrawal under an unsupported wrapper.
- Prove fatal consent/authorization failures survive renderer catches, result
  conversion and ancestor fallback; no raw media or partial 200 escapes.
- Round-trip provider-owned new and legacy examples through body/chrome storage;
  do not use consumer-invented payloads as proof of producer compatibility.
- Use the real provider native-family fixtures and Worker/browser acceptance.
  Current proposal examples alone are not evidence that an adapter exists.

Full functional, compatibility, performance and rollout acceptance remains in
[issue #42](https://github.com/Quick-Release/gq-content/issues/42).
