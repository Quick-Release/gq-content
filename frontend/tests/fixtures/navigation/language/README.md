# Real Polylang Free language-navigation capture

Captured by the guarded existing Polylang runner against the owned disposable
WordPress site, with Polylang Free 3.8.10 active, multilingual support enabled and
the real `polylang/language-switcher` registered. `provenance.json` records source
commit, versions, enabled conditions, registered options, requests and command.

For each of `en` and `fr`:

- `*-layout.json` is the anonymous public language-resolved layout response.
- `*-nodes.json` filters its three switcher nodes without rewriting any values.
- `*-public-rest.json` is the anonymous public translated-page REST response.
- `*-post-nodes.json` preserves that response's ordinary `getquickBlocks` separately.
- `*-saved.html` is the actual published page's saved block comments.
- `*-rendered.html` is that page response's exact `content.rendered`.

The authored modes are names+flags list, flags-only list and dropdown. They use
real resolved English/French home URLs (`force_home:true`), current-language
metadata, flags and labels. The dropdown authors `hide_current:true` but retains
the selected option, matching the real integration. The layouts explicitly
resolve EN/FR current state. Ordinary post REST serialization does not supply
that explicit layout language context; its observed metadata is captured rather
than asserted equal. Treat the neutral and HTML deliveries independently.

`manifest.json` captures the actual enabled conditions; `SHA256SUMS` verifies all
captured payloads. The fixture's existing cleanup removes the owned pages and
restores header content/options/languages; loopback URLs are not persistent.
No Pro plugin or licensed feature was used. These inputs support consumer tests;
they do not themselves establish consumer keyboard or rendering acceptance.
