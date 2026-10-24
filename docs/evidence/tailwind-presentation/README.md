# Content consumer evidence

This branch implements the reusable content consumer of gq-design #72–#82.
The review starting point is `cbf29256bf854ea64d5b21382683979b0c3693f5`;
`970afc5` is the first Container-only adoption commit. No result below implies
complete catalog, Site fleet, release or deployment acceptance.

## Fixture boundaries

Immutable fixtures live under `frontend/tests/fixtures`, with upstream commits
and hashes in their provenance files or tests. The Container snapshots originate
in real Gutenberg sidebar controls, serialize/parse validity, WP `do_blocks`,
and the owning public serializer. The standalone Carousel public snapshot is
separately proven through actual HTTP REST and GraphQL by its producer owner.
Layout snapshots contain real saved content, WordPress HTML and REST nodes.
The typography capture records actual save/reopen, rendered HTML, neutral nodes
and both themes; its incomplete layout request returned 422. It is not evidence
of successful layout publication. Query standard Post records are untouched
actual GraphQL fields inside the refreshed `6b5f746` fixture. The original custom
post type fixture is evidence only for explicit preloaded contexts.

`frontend/tests` exercise public HTML adapters, canonical validation and the
existing publication read/store/delivery boundary with fixture-backed GraphQL
responses. These responses are test stubs, not new HTTP producer captures.

## Production consumer checks

`scripts/consent-acceptance.mjs` packs and installs the content package into a
separate Astro consumer, builds it, serves it and runs Chromium. Presentation
routes render actual immutable fixture nodes through public `renderDesignPattern`
and parsed block APIs and compare available WordPress HTML. Scoped theme/reset
and presentation CSS are emitted by the actual page. Supporting synthetic shell
matrices remain separately labelled in `presentation-acceptance.mjs`.

The saved Hero case verifies no initial iframe/request before consent, direct
canonical deferred iframe restoration, reduced-motion gating and preference
changes, 256px media geometry and withdrawal restoring the placeholder. The
configured runtime also gates generated null-content chrome Hero media before
composing already-gated child HTML. Canonical publication block trees pass the
same delivery transform before preloaded Post Content rendering.

## Review and remaining acceptance

Initial Container Standards review found no hard violations and an escape-helper
duplication smell, subsequently removed. Its Spec review retained the real
editor/public/Site evidence gap; later owning fixtures and consumer checks are
recorded separately from that initial synthetic geometry test.

The family preliminary Standards review found no hard violations; shared URL
safety duplication was removed. Separate family dispatch chains retain different
traversal policies while sharing actual renderers. The preliminary Spec review
identified saved native Navigation shells lacking lifecycle hooks; a follow-up
implementation addresses that path; production Astro and delivery tests now pass.

Native Columns now use the final owning baseline (3a5d6be/b06e019/a5df8d8)
from immutable 0a14c1f. The production consumer without WP core CSS passes the
781/782/783 boundary, equal growth, non-stacking 25/75, vertical alignment and
explicit neutral overrides, including RTL. No Site policy fork is present.

## Bounded final matrix

| Family               | Content-owned evidence                                                                                                                                                      | Limits                                                                                                                                                            |
| -------------------- | --------------------------------------------------------------------------------------------------------------------------------------------------------------------------- | ----------------------------------------------------------------------------------------------------------------------------------------------------------------- |
| Container            | Saved/serializer snapshots; pattern/parsed/shell geometry, all breakpoint edges, RTL, native alignment and reset                                                            | Site owners separately prove workerd/editor/public journeys                                                                                                       |
| Theme                | Typed GraphQL → store → offline delivery; settings refresh; actual default/override CSS                                                                                     | Theme authoring remains Design-owned                                                                                                                              |
| Layout               | Actual 893ea2d six-root Grid/Group/narrow-parent gap chronology; actual 3a5d6be native Columns without core CSS; Spacer/Separator                                           | Full Site CSS matrices run independently                                                                                                                          |
| Typography           | Actual b11b763 and 57f5ba6 captures, both themes; null Lists/List Items; inline source attrs-only variants; Button                                                          | Captured layout endpoint remains 422, not a published layout                                                                                                      |
| Media                | Actual sourced Image fixture; null-content Cover reconstruction; canonical structural CSS                                                                                   | Featured Image and Branding are explicit loaded Site context variants, not invented producer captures                                                             |
| Carousel             | Real saved document and standalone HTTP neutral node; pattern/parsed paths; literal height/linked images; inactive state, controls, keyboard, pause, reduced motion, colors | Visible controls are a labelled variant of saved visible=false; no raw WPGraphQL capture claim                                                                    |
| Hero                 | Real saved YouTube fixture, consent grant/motion/revoke; generated chrome gate; real native video playback supporting clip                                                  | Native playback clip is a local first-party test resource, not an additional CMS save capture                                                                     |
| Navigation           | Actual 802c9a1 nodes/HTML, source-preserving shared hooks; overlay/theme boundary/RTL/focus/Escape; saved shells and delivery integration                                   | WP body may retain draft labels/omit dynamic descendants while neutral resolver differs; each source contract is asserted independently                           |
| Query                | Refreshed 6b5f746 untouched Post GraphQL records → existing URI read/store/offline preload → matching recursive Post Content and transparent references                     | No new live HTTP capture, custom post type loader or query selection engine                                                                                       |
| Conditional language | Supplied links, flag-only accessible labels, filtering, dropdown, RTL and keyboard in production Astro                                                                      | Actual e1984c7/ed0afd9 FREE captures now prove resolved links, current state, dropdown keyboard and exact PNG decoding; no Pro or broad HTML/neutral parity claim |

Verification at preview7: build/typecheck/lint pass; `pnpm exec vp test` passes
501 tests (3 skipped); `node scripts/consumer.mjs` passes 496 installed-package
tests plus public declaration/runtime checks. `node scripts/consent-acceptance.mjs`
passes the production presentation routes and all 48 shared consent checks,
additional record/navigation/legal scenarios and saved Hero grant/motion/revoke.
The subsequent supporting native playback context also passes.

Immutable preview7 is `getquick-content-0a14c1f-preview7.tgz`, SHA256
`04e9829eb935dbbdda9db85c07559843bcf1acff7f911a72d14d76160ca75851`.
It bundles the verified Design 0.9.0 / wire 2.0.0 pair at
`0a14c1fabdde666988b9c7678d41a3ec312c1fdc`. It is a local preview, not a
published package pin. No PR, tag, deployment or live Site content change was made.

## Follow-up corrections and current stage

Preview8 bundles exact Design stage `634f58c8e42c8a1e7f8334e937126b472387d405`.
Archive `getquick-content-634f58c-preview8.tgz`, SHA256
`b6b4db473c00f6ade0d7c379ea83d4bb9e76a2360e0ee8ebbc6cfd32b627bebf`.
The main family commit is `bc267fbe3435dd821c02a9bf883b5cb90ba721c5`.

The final review caught an overlay-disabled native shell becoming mobile-overlay
navigation during ordinary HTML delivery. The follow-up infers policy from the
original shell before adding hooks. Actual conditional language captures then
exposed `noTranslation` being treated as eligibility: the renderer now trusts
already resolved public URLs, including force-home and Polylang filter results.
It never derives URLs or alters the captured DTO. e1984c7 null flags prove an
accessible label fallback; ed0afd9 supplies actual PNG assets, served byte-for-byte
at their original URLs by the test transport. Both EN/FR current states, all three
modes and dropdown keyboard behavior pass. Captured native WP HTML retains its
own inline select change controller; initial SSR navigation is tested separately
from the neutral adapter, without asserting arbitrary HTML client-swap parity.

The refreshed actual Hero dispatcher capture e696635 retains explicit native
foreground/background colors and canonical nested inline child links. Only
reconstructed native shells restore those native support attributes; complete
saved shells and Site renderer output stay authoritative. Presentation still
uses the canonical compiler. Opening-tag mutation now has one shared primitive.

Cover checks independently prove canonical omitted 430px, saved HTML inline
500px, authored neutral height 192px and 16:9 at 600px (337.5px). Per the parent
scope decision, attrs-only legacy native minHeight/minHeightUnit is intentionally
unsupported: no legacy DTO, appearance compatibility layer or numeric CSS grammar
was added. Current neutral minHeight remains canonical and supported.

The final Carousel review found that shortcuts from foreground links could hide
focused content. Shortcuts now apply only to persistent navigation controls;
foreground Arrow/Home/End retain their native behavior and focus. The production
Astro regression failed before this correction and passes for both pattern and
parsed-block paths afterward.

The separate actual native null-flag accessibility capture `2e7e447` is retained
unchanged under `frontend/tests/fixtures/navigation/language-a11y/`; all 14 payload
hashes match. Its future native HTML supplies the missing accessible language
names. Production body checks use that capture independently of the historical
null-flag capture and the actual PNG capture; no source or URL is rewritten.
Root Site title/tagline rendering remains supplied context through existing
`publishedHome.settings`, since the typography capture's layout endpoint is 422.
No valid published dynamic layout is inferred from that supporting context.

## Native decorative Cover motion follow-up

A supporting real first-party WebM case exposed saved native Cover's eager
`autoplay` and the absence of a Cover playback lifecycle. Neutral output already
had no eager attribute, but stayed paused even when motion was allowed. The shared
presentation/delivery paths now remove only direct decorative Cover autoplay;
`mountDesignCoverVideos(root?)` owns preference-driven play/pause/resume and
cleanup. Production Astro tests cover neutral, saved and parsed paths, retain
poster/source/foreground, and verify no resume after cleanup. An ordinary
publication/store/offline regression retains the stored source while deferring
playback on delivery. This is a labelled supporting video context, not a new
saved WordPress producer capture; native foreground videos keep their own policy.

The configured publication seam subsequently exposed native Polylang's missing
inline controller after content sanitation. The same actual ed0afd9 HTML is now
seeded unchanged into the production fixture publication store and read through
`publishedEntry`, with the captured script absent. Its select change was red
(no navigation), then green with recognized native-select support in the existing
`mountDesignNavigation`. Tests retain delivered URLs, labels and options, reject
unsafe supporting option values, and exercise cleanup/remount. This closes the
scriptless delivery path without executing captured scripts or deriving URLs;
it is distinct from the earlier independent raw-HTML initial-SSR check.
