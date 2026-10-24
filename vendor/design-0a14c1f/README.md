# Canonical Design build inputs

Immutable owning pair from clean gq-design integration
`0a14c1fabdde666988b9c7678d41a3ec312c1fdc`, Design 0.9.0 / wire 2.0.0.
These are tarball build dependencies, not mutable source copies. Content bundles
them into its public package; consuming Sites install only `@getquick/content`.
No absolute local path or unpublished managed Site pin is part of the package.

- Contract SHA256: `4d653777703f279f652aeff7acb3dc293a959b2c47108b0a102b5e1359c0f456`
- Renderer SHA256: `17e23650faf5ef315f5232ac2dbe86d5bcb374a42a090cb0a3cc026581e8cb37`

Both archives must be installed together. The root override ensures the renderer
uses the exact matching contract. The Hero browser facade uses the public pure
`/video-hero` export, avoiding client-validator bootstrap in browser bundles.

This pair includes contextual native Group variables and gap chronology,
Navigation, strict canonical list validation, source Image DTOs and canonical
media/Hero CSS. It also includes native Columns structural rules/context and the sanitized
Heading/Paragraph inline source DTOs. Owning and consumer acceptance remain
separate from artifact adoption.
