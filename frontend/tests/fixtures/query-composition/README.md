# Saved Query composition

These artifacts come from `tests/authoring/query-composition-fixture.php` on the
isolated WordPress 7.0 fixture, using real registered blocks and the public REST
`getquickBlocks` field. Numeric reference/item identities belong to this fixture;
they are not live production IDs.

`saved.html` selects two published `gqd81_item` entries by title ascending with
offset one: Beta, then Gamma. `item-pattern.html` contains Post Title, Post Content
and a synced reference to `grid.html`. The Grid has Base one column, md two columns
and gap four, with styled Heading and Buttons children inside two Containers.

`public.json` carries the delivered Query tree plus the two selected item contexts.
Each item's `blocks` is its authorized Post Content resolved by the same public
block-tree resolver, including a nested synced paragraph. Supply these contexts
to the actual adapter when repeating the Query template; use the item's own title
and content, preserve ordering and logical identities, and render synced reference
nodes without a layout-changing wrapper. Do not treat the numeric IDs as fetch
authorization.

`tests/browser/query-composition.spec.mjs` creates fresh documents from the same
fixture, checks schema validity and native editor save/reload, then measures the
real WordPress HTML at 767/768/1000px. Site adapters must separately verify their
own repetition, Post Content resolution, computed CSS and link behavior. This
fixture alone is no claim of fleet acceptance.

`post-saved.html` and `post-public.json` are the standard Post companion. This
Query uses `postType: "post"` and selects `00081 Beta`, then `00081 Gamma`.
Each item's `publishedPost` is the actual public WPGraphQL Post response with
`databaseId`, `title` and `getquickBlocksJson`; `blocks` is that response's parsed
block tree. Use this variant to prove the existing published Post content loader
end to end. The agent draft acceptance uses this standard Post variant too.

The original `gqd81_item` fixture only proves query selection and neutral
composition. Its item contexts are explicitly preloaded fixture records; it
does not claim an existing published CPT GraphQL loader. Do not infer CPT
fetch support from the standard Post/Page-only `getquickBlocksJson` field.

The refreshed snapshots were captured from the real producer at integration
`91c775a` (local merge `15232f1`), after the Image/Button source-attribute
producer changes. Button nodes retain `url: "#details"`, `text: "Read item"` and
`tagName: "a"` as neutral attributes; the content HTML remains separate.
The Post companion still preserves each untouched published GraphQL record.
