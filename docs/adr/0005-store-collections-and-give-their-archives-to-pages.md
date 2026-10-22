# Store a Site's collections, and give their archives to Pages

Status: accepted, 2026-10-22.

Nomia (nomia.bnq.pt) registers about a dozen custom post types with
`has_archive`. Their archives claim the URIs of Pages published at the same
address (`/biblioteca/`), so `nodeByUri` and `pageBy` resolve the archive, the
runtime stores those Pages as missing and reconciliation reads them again on
every run. The runtime also read only pages and posts, so the types' items
had no place in the publication store and every archive address was a 404.
A Site needs an archive to be a Page its editors lay out with blocks, with a
listing block of the type's items, served, as everything else, from the store.

## An archive is a Page (CMS)

GETQUICK → Archives (`cms/modules/archives.php`, under Settings without
gq-config's menu) assigns a Page to each public custom post type, as
WordPress's `page_for_posts` does for posts. The mapping is the option
`gq_archive_pages` (post type → page id): one type per existing Page; pages
and posts have none.

- A type with a Page assigned registers without its own archive
  (`register_post_type_args`, `has_archive` false), so WordPress and
  WPGraphQL resolve the Page at the archive's URI. Its items keep their
  rewrite rules (`/biblioteca/<slug>/`). A change to the mapping deletes the
  rewrite rules; the next request regenerates them with the new arguments.
- `getquickArchives` (WPGraphQL) lists each public custom post type's archive:
  its Page's URI while the Page is published and public, else the type's own
  archive's, else null; and the `page` itself. A trashed Page is no archive
  (null) until restored; a deleted one is unassigned, and the type has its
  own archive again.
- Saving the mapping, or saving, trashing or deleting an assigned Page, sends
  an `archives` settings event (settings-events.php's shared-setting events).

The setting only frees the archive's own URI. A Page under it that a type's
single-item rule claims (`/biblioteca/legislacao/` against
`biblioteca/<slug>/`) is the Site's to resolve, by giving its items another
rewrite slug (Nomia moves them to `biblioteca/documento/<slug>/`); the runtime
doesn't rewrite them generically. Site Health's "Pages reachable at their
addresses" names every published Page whose URI WordPress resolves to
something else.

Publication events, withdrawals and delivery retries cover every public custom
post type shown in WPGraphQL, besides pages and posts. The CMS doesn't know
which a Frontend stores: one that doesn't store a type finds its items missing
and stores nothing for them.

## Collections are entries (Frontend)

`ContentConfig.collections` names the types the runtime stores, by the Site's
name for each: `{ biblioteca: { postType: "biblioteca", graphqlType:
"Biblioteca", taxonomies: ["categoria_biblioteca"] } }`. Both type names are
needed: WPGraphQL's `ContentTypeEnum` is derived from the post type's name
(listing), the archives are keyed by it, and a type's `terms` (and the Site's
fields) are only selectable on its GraphQL type.

An item is an entry: stored at `entry:<route>` in the same rows, so
publication events, withdrawals, moves, cold lookups, rotating rereads and
reconciliation apply unchanged, and `publishedEntry` serves it. Its body adds
`collection: { name, terms }` (terms by taxonomy, as slug and name) and the
text a search matches (`collection.search`, not served). Reconciliation lists
the collections' types with pages and posts.

On a Site with collections an entry is read as the node at its URI
(`nodeByUri`), one request as before: what a type may lack (its title,
content, excerpt, featured image) is selected on the interfaces that have it,
so a type without excerpts isn't a GraphQL error; what is a type's own (an
item's terms, the Site's extension fields, a multilingual Site's language)
on that type. The node is a page, a post or an item of a stored collection,
or missing. Sites without collections keep `postBy`/`pageBy`.

The extension (ADR 0004) applies to items: `fields.collections[<name>]`
selects their fields, and `read` gets `{ kind: "item", collection }`.

Where each collection's archive is (`archiveUri`) is a shared row,
`archives`: read by a full refresh, an `archives` settings event and every
reconciliation (one more request in its budget), compared and promoted like
the design presets. The same read checks that WPGraphQL shows each
collection's post type and taxonomies; one it doesn't fails the read
(`schema`, naming them), so refreshes, reconciliation and the CMS's delivery
health report it, and what is stored stays served. Its terms would otherwise
be stored empty, silently. A CMS without Archives yet gives no archives.

## Listings are SQL over the store

`list({ collection, terms?, search?, page?, perPage?, language? })`,
`terms(collection, taxonomy)` and `archiveUri(collection)` read the store
alone, never WordPress, so a listing is served through outages as its items
are; without a store (explicit development) a listing is unavailable, not
read live. D1 filters and pages them with `json_extract`/`json_each` over the
entries' bodies, newest first by WordPress's date: any slug of a taxonomy, and
every taxonomy given; `count(*) OVER ()` gives the total with the page.

Search is a substring of the item's title and its excerpt without markup,
lowercased and without accents on both sides (`legislacao` finds
"Legislação"). There is no FTS index: Nomia's published items, measured live
on 2026-10-22, are biblioteca 10, indicadores 7, infografias 6, eventos 5,
oportunidades 5, recursos_educativos 3, plataformas 3, glossario 2, podcasts
1, videos 1 (with 188 posts and 42 pages), so a listing scans a few hundred
rows. The D1 migrations are unchanged: no index or column is added. A Site
with thousands of items would add a migration (a generated `collection`
column and its index, or FTS5) and revisit this.

## Compatibility and deployment

Rows, events and the stored formats of pages and posts are unchanged; a Site
without collections reads, stores and checks as before. The `archives`
settings event is new: deploy the Frontend before the CMS plugin, or an
older Frontend refuses it (the CMS records it failed and retries).

Considered: storing items in a table of their own (a second promotion,
withdrawal and reconciliation path to keep in step with entries); a migration
for a generated collection column (unneeded at the measured volume, and every
Site would carry it); reading items with a second query only when
`postBy`/`pageBy` find nothing (two requests per item, a larger
reconciliation budget); selecting items' optional fields on their type (a
type without excerpts fails every entry read); rewriting single-item URIs to
make way for child Pages (each Site's post types decide their URIs).
