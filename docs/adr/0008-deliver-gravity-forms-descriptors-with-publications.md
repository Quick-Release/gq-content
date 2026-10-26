# Deliver Gravity Forms descriptors with publications

Status: accepted for this provider, 2026-10-26, under
[gq-platform ADR 0009](https://github.com/Quick-Release/gq-platform/blob/main/docs/adr/0009-headless-gravity-forms.md)
(accepted 2026-10-26), which assigns headless Gravity Forms to this repository
and delegates the delivery mechanism and its refresh.

A Site's `gravityforms/form` blocks need the form's fields to render, and its
form endpoint needs them to validate a post, without any Gravity Forms
credential on the Frontend. Reading a form definition through Gravity Forms'
REST API needs a consumer key.

The CMS module `modules/forms.php` stays dormant unless Gravity Forms is
active. Then it adds `getquickForms` to WPGraphQL's `ContentNode`: the public
descriptors (JSON) of the forms that a published, unprotected entry's content
references. References come from blocks (including nested blocks and synced
patterns) and from `[gravityform]` shortcodes. A Site opts in with
`createContentRuntime({ forms: true })`. Its reads then select the field with
the blocks, and each publication stores the descriptors as `forms`, so forms
are served through CMS outages like the rest of the page. `publishedForm(path,
formId)` reads them back for the form endpoint. A CMS without Gravity Forms is
read without the field, as a CMS without `getquickBlocksJson` already is.
Without the option, queries and stored bodies are byte-identical.

Saving a form or its confirmations, or activating, deactivating, trashing,
restoring or deleting it, sends a publication event for every public entry
that references it, so the Frontend reads the new descriptor.

The descriptor parser keeps an allow-list of public keys. Notifications,
entries, feeds and admin settings can't reach a publication, even if the CMS
sent them. Unsupported fields and settings travel as diagnostics, which
readiness fails on.

`@getquick/content` gains `/forms` (descriptor, validation, readiness, outcome
state), `/forms/astro` (HTML renderer, no Astro import), `/forms/server`
(`createFormsServer`) and `/forms/testing`. Their import closure contains no
content runtime, consent runtime, framework or zod. A packed-artifact proof
builds them into an Astro Worker. Submissions go to Gravity Forms' REST
submissions endpoint, whose permission check is open, so Gravity Forms stays
the authority for validation, entries, spam filtering and notifications.
Nothing reads entries.

Considered:

- A public CMS REST route serving descriptors at render time. Rendering would
  depend on the CMS being available, and the route would enumerate forms
  outside published content.
- Rewriting the block's rendered HTML at GraphQL time. It is coupled to which
  block-delivery plugin a Site uses, and Nomia renders from parsed blocks, not
  that HTML.
- WPGraphQL for Gravity Forms. It is a third-party schema with entry and
  definition access the Site would have to lock down, and it still needs this
  rendering, spam and consent work.
