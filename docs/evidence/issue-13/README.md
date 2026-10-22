# Issue #13: paired release 0.1.0

`getquick/gq-content` and `@getquick/content` 0.1.0 were published from tag
`v0.1.0` at `51a9f3eb36f90cf069fca8e6fe20a875e452d570` on 2026-10-22. The full
record, including recovery and fresh verification, is on #13:
https://github.com/Quick-Release/gq-content/issues/13#issuecomment-6336904617

## Retained candidate

`release-candidate/` is the entire `paired-release-candidate` artifact from
validation run [39749078958](https://github.com/Quick-Release/gq-content/actions/runs/39749078958),
kept unmodified as `docs/releasing.md` requires: manifest, ZIP, tarball,
`validation.json` and proof `logs/`. This is the bundle that was published. It
is retained bytes, not a recipe: never rebuild over it or publish from a rebuild.

| file                         | SHA-256                                                            |
| ---------------------------- | ------------------------------------------------------------------ |
| `getquick-content-0.1.0.tgz` | `837b2e390dcb7606b4acbb4b62b781eba88a58f87d637dd176817a831faf8318` |
| `gq-content-0.1.0.zip`       | `f892d974d80cde9bb9a36e4595f509661fb37f63e0102b1506483fcfc2c78a5e` |
| `release-manifest.json`      | `d9c58ba865c080bf6cb1bfe3deecd13a2c2eed019c2271dddcddab2fbecc5ef1` |
| `validation.json`            | `19800660e792db522242cccc13a72a3bb6fca9b3418c60e96a7e0a20a1b9acfc` |

npm integrity: `sha512-lxzkdqcdgf4Ag1bTDLi59jUZmadU7dgW1Z6+aWWcKuMBvrMt5LWumHTntOEMmZhKYeCwvg4gCaWjAybbPvRX2w==`.

## Live registry snapshots

Captured after `publish` returned `status: complete`, `handoff: true`. Contains
no credentials.

- `live/npm-getquick-content-0.1.0.json`: public npm metadata (identity fields only).
- `live/composer-p2-gq-content.json`: `https://proxy.composer.getquick.io/p2/getquick/gq-content.json`.
  The ZIP it served was byte-identical to `release-candidate/gq-content-0.1.0.zip`.

## Publication path

The CLI's npm step could not complete npm's browser 2FA (#32). The retained
tarball was checked against the manifest and published with
`npm publish <tgz> --access public --ignore-scripts --auth-type=web`. Rerunning
`release.mjs publish` with the same bundle and run ID then verified the matching
npm identity, dispatched the registry rebuild
([39751284578](https://github.com/Quick-Release/getquick-registry/actions/runs/39751284578)),
returned `partial`, and completed on retry.
