# Canonical Design build inputs

Immutable owning pair from clean gq-design integration
`634f58c8e42c8a1e7f8334e937126b472387d405`, Design 0.9.0 / wire 2.0.0.
These are tarball build dependencies, not mutable source copies. Content bundles
them into its public package; consuming Sites install only `@getquick/content`.
No absolute local path or unpublished managed Site pin is part of the package.

- Contract SHA256: `5d9b953a33fb64f68c7d38dfe5d7357c4650cc6f9c700c622f43428c9c26938d`
- Renderer SHA256: `6ecae5e42a0813c0cb63c7bf6769061c55109af26a5fecf206f1dda2ad2af7f4`

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
