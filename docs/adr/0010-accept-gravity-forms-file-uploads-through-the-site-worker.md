# Accept Gravity Forms file uploads through the Site Worker

Status: accepted for this provider, 2026-11-03, under
[gq-platform ADR 0009](https://github.com/Quick-Release/gq-platform/blob/main/docs/adr/0009-headless-gravity-forms.md),
which lists file upload among the field types that fail readiness "until
supported", and [ADR 0008](0008-deliver-gravity-forms-descriptors-with-publications.md).

A Site's public submission form (Nomia's `/partilhe/`) needs visitors to attach
images and PDFs that editors review in Gravity Forms. Until now the form
endpoint accepted only `application/x-www-form-urlencoded` bodies of at most
64 KiB, and sent Gravity Forms JSON. An upload brings a new trust boundary:
untrusted binary bodies of several megabytes pass through the Site's Worker on
their way to the CMS.

Gravity Forms 3.1 and 3.2 accept uploads on the same anonymous endpoint.
`POST /gf/v2/forms/<id>/submissions` falls back to `$_POST` when the body isn't
JSON, `GFAPI::submit_form` marks the post as a submission
(`is_submit_<id>`), and `GF_Field_FileUpload::get_submission_files()` reads new
files from `$_FILES['input_<field>']`, as one file or as an `input_<field>[]`
array. Gravity Forms then checks the count, size, extension and content
(`wp_check_filetype_and_ext`) and stores the files, as for its own no-JavaScript
web form. No credential, upload endpoint or temporary-file token is needed.

The CMS module now describes a `fileupload` field: its allowed extensions, its
effective per-file limit (the field's limit, capped by PHP's
`wp_max_upload_size()`), whether it takes several files and how many. The
renderer posts a form that has one as `multipart/form-data`, with `accept`
from the extensions and the limits as an accessible hint. The handler then:

- accepts `multipart/form-data` up to a hard total cap per post
  (`maxUploadBytes`, 10 MiB unless the Site sets less or more, never above
  32 MiB), refusing a larger declared length unread and stopping a longer
  stream;
- keeps only the descriptor's inputs, as before, and only files posted under an
  upload field's input name;
- checks each file's count, size and extension against the descriptor, and its
  first bytes against the format its extension names. The client's MIME type
  is ignored; the file is forwarded with the type its content proves;
- forwards the post to the same endpoint as `multipart/form-data` (files under
  `input_<field>` or `input_<field>[]`), keeping the honeypot, Turnstile, rate
  limit and consent rules. Forms without an upload are still sent as JSON.

Only formats whose signatures the handler verifies can be allowed: JPEG, PNG,
GIF, WebP and PDF (`jpg`, `jpeg`, `png`, `gif`, `webp`, `pdf`). Settings the
handler can't honour stay `unsupported-file-upload` diagnostics and fail
readiness: no allowed extensions (Gravity Forms would then accept any type it
doesn't block), an extension outside that list, several files without a
maximum, and a form whose largest possible upload exceeds the CMS's PHP
`post_max_size` or `max_file_uploads`, which PHP would drop silently. Post
image and signature fields stay unsupported.

The descriptor's schema stays 1: the field is additive and the pair is
released together (ADR 0001). A Frontend older than this release drops the
field it doesn't know, so a Site must not adopt the CMS without the Frontend.

Considered:

- Gravity Forms' chunked upload endpoint (`?gf_page=upload`) and
  `gform_uploaded_files`. It needs a nonce and an HMAC from a rendered form,
  and two requests per file.
- Uploading to the CMS's media library or to R2 and submitting URLs. It creates
  a second store and copies of personal data outside Gravity Forms, and a
  credential with write access.
- Trusting Gravity Forms alone, without checks in the Worker. Every request
  would carry megabytes to the CMS before any check, and a renamed file would
  reach PHP. Gravity Forms still validates again and stays the authority.
