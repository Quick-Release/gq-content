# Canonical Design build inputs

Immutable owning pair from clean gq-design integration
`c4bcc5a9ef72ecad2b48495596464c9d4daa8c8b`, Design 0.9.0 / wire 2.0.0.
These are tarball build dependencies, not mutable source copies. Content bundles
them into its public package; consuming Sites install only `@getquick/content`.
No absolute local path or unpublished managed Site pin is part of the package.

- Contract SHA256: `36e168141d4bafa3c57cdb7e7e4cb2f42b68d354caa2e41431fbf420282ba0b7`
- Renderer SHA256: `b54225888df2d4b4ceaae3f902a22f59af484300985a4791f135c98809e033f1`

Both archives must be installed together. The root override ensures the renderer
uses the exact matching contract. The Hero browser facade uses the public pure
`/video-hero` export, avoiding client-validator bootstrap in browser bundles.

This pair includes contextual native Group variables and gap chronology,
Navigation, strict canonical list validation, source Image DTOs and canonical
media/Hero CSS. It also includes native Columns structural rules/context and the sanitized
Heading/Paragraph inline source DTOs. Owning and consumer acceptance remain
separate from artifact adoption.

This stage also includes the canonical Cover 430px omission baseline and the
refreshed actual Hero REST-dispatcher fixture with canonical inline child DTOs.

Final functional stage adds plain-tag identity isolation (7ede/d052), combined
23 producer snapshots (aa716), and refreshed Hero/Carousel inline fixtures.
Facade interfaces are unchanged. Root performance/orchestration and coordinated
release evidence remain separate gates; this is not a published package pin.
