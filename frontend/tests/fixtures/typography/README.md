`public.json` is an immutable, byte-for-byte copy of
`Quick-Release/gq-design` commit
`b11b763dba06ddd2006b1f406c516c3d8e22ef1c`, path
`tests/fixtures/typography-presentation-delivery.json`.
SHA-256: `55916b46bbfed0bb4ee64bd89a0ff9c39ab5f4e8fe8039db0099dc3a94a32d77`.

It contains the actual default/override WordPress save/reopen capture, neutral
nodes, tokens, post/Site context and preview output. See its embedded provenance
for producer/harness hashes and original source revisions. Do not format the JSON.
The fixture explicitly does **not** establish `/layouts/page` acceptance: its
preview-only template lacks the required header/content/footer region references
and the captured endpoint returns 422.

Tests exercise the public `renderDesignPattern` built-ins. Saved leaf HTML stays
authoritative; null-content Lists, List Items and Buttons wrappers are restored
from actual sources. These server HTML tests do not establish computed browser
parity or fleet acceptance.

Site Title/Tagline use captured settings context. Source-only paragraph/heading,
rich List Item/Button and safety cases supplement the fixture. Post Date/Excerpt
are absent from this fixture and its producer's enabled BlockRegistry; their
supplied-value behavior is supplemental coverage, not real producer evidence.
Post Title/Content remain owned by `design-query.ts`.

Integration exports needed: `renderDesignText` and type `DesignTextContext`.
Pass rendered children as argument three and loaded context as argument four.
Call only when no authoritative saved shell exists. `undefined` must flow to the
existing unrendered reporting path. Context supplies `site.title`,
`site.description`, `site.url` (plain text settings), plus optional `post.uri`,
`post.date: { text, dateTime }` and `post.excerpt` (inline rich text). Date selection,
formatting and timezone belong to the caller, using the actual block attributes.
No post body truncation, date guessing or data fetching occurs in this adapter.

`safeDesignRichText` is also exported as a small shared source sanitation boundary.
Image captions reuse this same boundary.

`inline-public.json` is the refreshed actual producer capture at `57f5ba6`,
SHA256 `de1acd7589c1ef52d95bf212f21e20e18be4cb243d45d5f6dbd49d80593b7921`.
It adds sanitized Heading/Paragraph inline DTOs while retaining saved wrappers.
Attrs-only adapter variants are explicitly labelled in tests.
