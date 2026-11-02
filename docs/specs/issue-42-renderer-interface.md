# Issue 42: injected renderer interface

Status: consumer proposal, 2026-11-02. Implements the interface obligations of
[accepted ADR 0009](../adr/0009-render-gq-design-blocks-with-gq-designs-html-adapter.md).
This document specifies the gq-content side, not the Design wire schema. Provider
field names, versions and payload examples must be reconciled with the dedicated
gq-design session before this proposal is called an agreed integration contract.
There is no renderer implementation in this change.

## Ownership and installation

GQ Content owns the public injection interface and the delivery policy behind
it. GQ Design owns the provider wire schema and the adapter implementation.
A Site imports the private adapter and passes its registry into the runtime.
Its own registry takes precedence by block name. The content public declarations
reference only content-owned or standard JavaScript types; no private imports.

Keep `DesignBlock`'s existing name, attributes, content and children fields.
Preserve and validate provider metadata separately from saved leaf `content`;
that field does not acquire complete-subtree fallback semantics. Both body and
chrome parsers must retain the agreed version, fallback and dependency metadata.
The provider's new-contract discriminator is checked before legacy parsing.
The exact normalized metadata shape follows provider reconciliation.

## Renderer and context

The following TypeScript is a proposed extension of the existing public seam.
`DesignBlock`, `DesignPostContext` and `DesignTextContext` refer to content-owned
public types. The latter two currently carry preloaded post identity, title,
blocks, URI and featured image; and native Site/Post text sources respectively.

```ts
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

The registry remains `Record<string, DesignBlockRenderer>`. Keep the existing
`blocks` option for Site overrides. The new injected Design registry is distinct
from it so callers need not reproduce precedence; propose `designRenderers` on
`ContentConfig` and `DesignRenderOptions`. Runtime-owned body and chrome rendering
use the configured registry; per-call Site overrides retain precedence. Where a
Site already passes a composed registry through `blocks`, keep that usage working.
Do not install a wildcard renderer to claim catalog coverage.

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
withdrawn and unavailable outcomes before adapting to legacy callers.

Native Site title/tagline, Post date/excerpt and other source-only values remain
preloaded caller data. The adapter must decline when required context is absent;
it must not invent a date, fetch a logo, select posts or derive an excerpt from
an arbitrary body. Provider reconciliation must account for every existing
native capability, current theme/logo inputs and Query item context.

Design owns presentation processing. Theme, capability extensions and CSS
configuration can be captured when the Site constructs the adapter registry;
if per-delivery values are required, specify their structural context types
before implementation. Content must not apply its old presentation renderer to
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
