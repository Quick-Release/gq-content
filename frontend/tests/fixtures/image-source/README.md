# Native Image source evidence

`public.json` is retained byte-for-byte from gq-design commit
`2b40c7eb78b7b7a41f7fc4ebb5158c88e4162f26`, path
`tests/fixtures/media-presentation/public.json`.

SHA-256: `385b5b07f800c9189b7a2a52a98f88ea9d6a7addb0839ff5fd262c50a698f4ff`

Read using immutable `git show` from
`/home/valerio/.t3/worktrees/gq-design/feat-tailwind-77`. No owning runtime
sources or schemas are copied here. The owning Image source contract is
`packages/design-contract/schemas/image-attributes.schema.json` at that commit.

The fixture contains direct public `nodes`, anonymous WordPress REST `restNodes`,
and a request-local `sourceNode` probe whose attributes are recovered using
`WP_HTML_Tag_Processor`. The probe checks intrinsic dimensions, title, responsive
sources, link target and rel, unsafe candidate rejection, and comment URL
spoofing. Tests omit the saved content when exercising the attrs-only boundary;
the separate saved-HTML test verifies that content remains authoritative.

Integration dependency: the currently installed design artifacts do not expose
canonical `ImageAttributes` or the standalone `assertDesignBlocks` validator
requested in gq-design #82. The parent must update the artifact, reexport the
canonical type if needed, and apply that validator at its root input boundary.
This adapter intentionally contains no local contract schema or presentation
parser. Its source-output safety rules are shared by callers of the adapter.
