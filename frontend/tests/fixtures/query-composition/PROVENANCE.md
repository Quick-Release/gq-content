# Content adapter evidence

`README.md`, `saved.html`, `grid.html`, `item-pattern.html`, and `public.json`
are byte-for-byte copies from gq-design commit
`6b5f746`, path
`tests/fixtures/query-composition/`, obtained with `git show` from
`/home/valerio/.t3/worktrees/gq-design/feat-tailwind-81`.
No mutable runtime source was copied.

The refreshed public.json/saved.html/README.md come from 6b5f746; the supporting
grid.html/item-pattern.html remain the original 8b60b33 snapshots. Tests exercise
public content adapters and the built-in `renderDesignPattern` composition.
Synchronous contexts are supplied before rendering. Query selection belongs to
the producer; identities, duplicates, order and count are retained.

Missing Query identities, missing preloaded posts, and post blocks without a
post context throw explicit errors. There is no read, query engine, or Site
fallback. The caller must give its own block renderers precedence, propagate
post context through recursive render calls, and handle the transparent
`core/block` branch before generic container rendering. Linked Post Title
uses `post.uri` and optional caller URL normalization followed by the shared
safe URL helper.

Run `pnpm exec vp test frontend/tests/query-composition.test.ts`.
These are HTML adapter checks; browser computed CSS, native editor roundtrips,
and fleet acceptance remain separate checks as described in the upstream README.
