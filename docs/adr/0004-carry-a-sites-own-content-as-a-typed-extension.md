# Carry a Site's own content as a typed extension of its publications

Status: accepted, 2026-10-22.

A Site can add its own content to WordPress through a plugin: a block tree its
components render (exposed as JSON), a page setting. In 0.1.0 the runtime's
queries and stored shapes are fixed, so such a Site (Nomia, on gq-site 0.19.0's
copied runtime) can't move onto the package pair without losing that content,
or its outage guarantees for it.

`createContentRuntime` takes an optional `extension: ContentExtension<X>`:

- `fields: { page?, post? }`: GraphQL selections added to each kind of node the
  runtime reads (front pages and pages; posts), inside an inline fragment
  included with the blocks (`... @include(if: $withBlocks) { … }`). A read
  WordPress can only complete without its blocks leaves them out too; it is
  partial and, as before, never stored.
- `read(node)`: the Site's value for a node WordPress returned (`kind`, and its
  fields, the runtime's among them), or undefined for none. Throwing fails the
  read as a `schema` failure, so what is stored stays served.
- `parse(stored)`: the value read back as JSON, or undefined when the Site
  can't serve it.

The value is stored with the publication, in the row's body (`page.extension`
for a language's front page, `extension` for an entry), and served on
`publishedHome` / `publishedEntry` and live reads, typed `X` throughout
(`ContentRuntime<X>`, `HomeDelivery<X>`, `EntryDelivery<X>`). It follows every
existing rule: a read is promoted only when its extension survives JSON and
`parse` (as the rest of the body must parse), events, refreshes and withdrawals
treat it as part of the page, and the front page's shared-row reconciliation
compares it with the stored one in its canonical JSON. Entries reconcile by
WordPress's id, URI and modification time, plus the rotating rereads of
unchanged entries, as for the rest of their content.

Compatibility: rows stored without an extension (before a Site declared one)
still serve, without it; a Site that stops declaring one serves its rows
without it. A stored extension the Site's `parse` rejects makes the row
unusable, as any body that doesn't parse: a Site changing its stored shape
parses both, or refreshes. The D1 migrations and the publication format are
unchanged; the five 0.1.0 migrations ship byte-identical.

Pages a Site renders itself also need what its pages are served with, so the
runtime exposes `designPresets()` (the stored design presets, live in explicit
development, like `pageChrome()`) and `internalOrigins(siteOrigin?)` (WordPress's
origin and the Frontend's, for `menuItemHref`). `blockPresetStyles` takes the
container `scope` (default `.prose-wp`), and `presetRootStyle` declares the
presets on `:root`.

The consent embed rewriting applies to the runtime's HTML only; the extension
is served as `read` made it, and a Site rendering HTML from it rewrites that
itself.

Considered: named per-Site keys (types become mapped over a key parameter, and
the runtime would carry each Site's vocabulary); passing raw GraphQL documents
or Zod schemas (ties Sites to the runtime's query structure or its Zod major);
storing extensions in their own rows (a second read per page and a second
promotion that could disagree with the first); a fingerprint of the extension
in the entry index (needs a migration, while modification times and rereads
already cover the entry's content).
