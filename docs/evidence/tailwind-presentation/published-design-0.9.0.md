# Published Design release build inputs

Both exact build dependencies are published Design 0.9.0 from the official
`v0.9.0` release on `0852b6c306edaf219edf4aa8d3fd98b0676b843f`.
Root devDependencies and the contract override use 0.9.0; root and isolated
compatibility lockfiles retain registry integrity. Content bundles the renderer,
so Sites install only the public `@getquick/content` package.

- @quick-release/design-contract: `sha512-2K8c51w5UjQXXk852t1DpGfRbeTHCnR24NL1kUpbaYGYdsLfr0ZrV+XmuCWXGrh3trQ/wbyBZ6LlD2hiU+OgJA==`
- @quick-release/design-renderer: `sha512-weBgGrIWhmTFwXsYV/hyj8AUBrsJAO7/sdRzv9AjIh6FYC6vKXhdUaJPvEhzAPsPBhJsh1zhSuoIi7+ZQdDyQA==`

Registry metadata was read through the approved package-manager credential
helper. No credential is stored in the repository or packed facade. This replaces
the immutable prepublication c4bcc5a archives, retained in git history. The public
fixture workspace also pins the same published contract version.
