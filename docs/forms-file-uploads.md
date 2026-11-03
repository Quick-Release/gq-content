# File uploads in headless Gravity Forms

From 0.6.0 a Gravity Forms **File Upload** field renders on the Frontend and
submits its files to Gravity Forms
([ADR 0010](adr/0010-accept-gravity-forms-file-uploads-through-the-site-worker.md)).
Visitors can attach images and PDFs without JavaScript. Gravity Forms validates
the files again, stores them with the entry and lists them in the entry and its
notifications, as it does for its own forms. Adopting forms on a Site is
described in gq-site's forms guide. This page covers configuring the field.

## Configuring the field in Gravity Forms

In the form editor, add a **File Upload** field and set:

| Setting                  | Value                                                                        |
| ------------------------ | ---------------------------------------------------------------------------- |
| Allowed file extensions  | Any of `jpg,jpeg,png,webp,gif,pdf`. Required: an empty list fails readiness. |
| Maximum file size        | In MB. See [Sizing](#sizing). Empty means PHP's limit.                       |
| Enable Multi-File Upload | If visitors may attach several files.                                        |
| Maximum Number of Files  | Required with multi-file upload.                                             |
| Required                 | As the form needs.                                                           |
| Visibility               | Visible. A hidden upload field isn't shown and gets no files.                |

Don't use conditional logic: the Frontend supports it on no field.

The Frontend checks each file's first bytes against the format its extension
names, so it can allow only formats it recognises: JPEG, PNG, GIF, WebP and
PDF. Any other extension (`docx`, `svg`, `heic`, `zip`…) fails readiness with
an `unsupported-file-upload` diagnostic, and the form isn't offered. Post Image
and Signature fields remain unsupported.

## Sizing

Each post, all of its files together, must pass four limits. The largest
possible post is each upload field's maximum file size times its maximum
number of files, added up:

1. **The Site's form endpoint**: `maxUploadBytes` in `createFormsServer`,
   10 MiB by default and 32 MiB at most. Larger posts are refused, and the
   visitor is sent back to the form with a message.
2. **Any proxy in front of the Site**, such as nginx's
   `client_max_body_size`.
3. **The CMS's PHP**: `upload_max_filesize` caps each file (the descriptor
   publishes the lower of the field's limit and PHP's), and `post_max_size` and
   `max_file_uploads` cap the post. PHP drops a post over them without telling
   Gravity Forms, so the CMS reports a form whose largest post exceeds them as
   an `unsupported-file-upload` diagnostic.
4. **Any proxy or WAF in front of the CMS**, including Cloudflare's plan limit.

Choose limits whose largest post fits the smallest of these. With the
endpoint's default 10 MiB, for example, use 3 MB per file and at most 3 files
(9 MB). `formsReadiness(descriptors, { maxUploadBytes })` warns about a form
whose largest post exceeds the endpoint's cap.

## What the visitor sees

The field is a labelled `<input type="file">`. Its `accept` attribute lists the
allowed extensions, and it has `multiple` when the field takes several files.
A hint names the accepted types, the size limit and the number of files, and
the input's `aria-describedby` points to it. The form posts
`multipart/form-data`. Its action also names the page
(`/gq/forms/<id>?gq_source=<path>`), so that a post too large to read still
returns to the page. Browsers can't keep chosen files across that return, so
after an error the hint asks the visitor to choose the files again. The other
fields keep what the visitor typed.

Field errors: a required field without a file, too many files, a file over the
size limit, and a file of another type, or whose content isn't what its
extension says. Gravity Forms' own messages, such as its size or type checks,
are shown as the field's error.

## What the form endpoint does

For a form with an upload field, `createFormsServer`:

- reads at most `maxUploadBytes`, and refuses a larger declared length without
  reading it;
- keeps only the descriptor's inputs and the files posted under an upload
  field's input name (`input_<field>`), so a visitor can't add Gravity Forms'
  `gform_uploaded_files` or other inputs;
- checks the count, size, extension and content signature of every file. It
  ignores the browser's MIME type, and strips any path, quotes and control
  characters from the file name;
- applies the honeypot, Turnstile, the rate limit and the consent rules as for
  any form;
- sends the post to `POST /wp-json/gf/v2/forms/<id>/submissions` as
  `multipart/form-data`, without a credential. A single-file field's file goes
  as `input_<field>` and several files as `input_<field>[]`, each with the MIME
  type its content proved. Gravity Forms reads them from `$_FILES` as it does
  for its own no-JavaScript form.

Forms without an upload field are still sent as JSON.

## Testing a Site's form

`@getquick/content/forms/testing` has `SUBMISSION_FORM` (a form with image and
PDF attachments), `sampleFile(name, kind)`, which builds a file whose first
bytes are `kind`'s signature, `multipartBody(values, files)` and
`submissionValues()`. `gravityFormsStub` accepts multipart posts and records each
file's name, type, size and first bytes. `assertAccessibleForm` also checks that
a file input is described by its hint and sits in a multipart form.
