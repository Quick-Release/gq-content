# Immutable presentation fixtures

These are owning gq-design snapshots, not copied runtime source. Read with
`git show <commit>:<path>` from owning Design worktrees.

| Local file | Owning commit and path |
| --- | --- |
| container-saved.html | 4db472b, tests/fixtures/container-presentation.html |
| container-rendered.html | 4db472b, tests/fixtures/container-presentation-rendered.html |
| container-public.json | 4db472b, packages/design-contract/fixtures/blocks/container-presentation.json |
| carousel.json | 0be23e8, tests/fixtures/carousel-presentation.json |
| carousel-public.json | 3232d3c, packages/design-contract/fixtures/blocks/carousel-presentation.json |
| media-public.json | c5dc50a, tests/fixtures/media-presentation/public.json |
| native-columns.json | 3a5d6be, tests/fixtures/native-columns-structural-saved.json |
| layout-final.json | 893ea2d, tests/fixtures/layout-presentation-saved.json |
| layout.json | 720b84a, tests/fixtures/layout-presentation-saved.json |
| video-hero.html | 4e6f3dd, tests/fixtures/video-hero-presentation.html |
| video-hero-youtube.html | 4e6f3dd, tests/fixtures/video-hero-youtube.html |

Container saved HTML SHA256:
`4dfa37339a789fbc2708f183f8050aed723160ebc0068baecef472f1a62bc7e9`.
Rendered HTML: `4de246453e6ed3977082cb51676565b21723cba2ee22e46224887f750b82992d`.
Public JSON: `25ea94c114c1d9381b78a95a2043f9e67d459cabce29674a773886ccf3f966a4`.
Carousel standalone public JSON:
`ddb58fb636e28b3da412575775b22a0f73aae30f3afbb5d1728a007a4a7cc6f2`.

The Container snapshots prove real Gutenberg controls/save/reopen, owning WP
rendering and public serialization. The standalone Carousel snapshot additionally
has actual HTTP REST/GraphQL provenance from its owner. The initial layout file
has five roots; final six-root/Group context/gap chronology acceptance needs the
newer layout-final.json (893ea2d) snapshot and matching canonical compiler. Media's initial public
fixture deliberately has no Post Featured Image or Branding logo context; tests
must supply actual Site contexts independently. Supplemental context/safety
variants do not become additional producer captures.

`video-hero-public.json` is the refreshed registered real REST-dispatcher capture
at e696635 (packages/design-contract/fixtures/blocks/video-hero-saved.json), SHA256
`0fc5b229f2e67658fb2844098bfa56eea3891b658747990d678a399b377a9cc2`.
Its presentation document is poster-only; the playable native stream is a separate
supporting context. This is not an external HTTP Hero capture.
