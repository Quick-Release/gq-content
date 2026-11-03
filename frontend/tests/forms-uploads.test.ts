// Headless Gravity Forms file uploads (ADR 0010 here): the upload field's
// public settings, its accessible multipart rendering, and the form endpoint's
// checks (total cap, count, size, extension and content signature) before
// the post reaches a stand-in for Gravity Forms' REST submissions endpoint as
// multipart/form-data. The browser proof against the packed package is
// scripts/forms-acceptance.mjs.
import { afterEach, beforeEach, expect, test, vi } from "vite-plus/test";
import {
  formsReadiness,
  largestUpload,
  parseFormDescriptor,
  readFormState,
  sniffFileType,
  uploadFilename,
  validateUploads,
  type FormDescriptor,
  type FormField,
} from "@getquick/content/forms";
import { formatFileSize, renderGravityForm } from "@getquick/content/forms/astro";
import {
  createFormsServer,
  MAX_UPLOAD_BYTES,
  TURNSTILE_SITEVERIFY_URL,
  type FormsServerConfig,
} from "@getquick/content/forms/server";
import {
  CONTACT_FORM,
  IMAGE_AND_PDF_UPLOAD,
  SAMPLE_FILES,
  SUBMISSION_FORM,
  UNSUPPORTED_FORM,
  assertAccessibleForm,
  assertNoEntryReadsOrCredentials,
  assertPublicDescriptor,
  gravityFormsStub,
  multipartBody,
  sampleFile,
  submissionValues,
} from "@getquick/content/forms/testing";

const SITE = "https://www.acme.test";
const CMS = "https://cms.acme.test";

beforeEach(() => {
  vi.spyOn(console, "error").mockImplementation(() => {});
});
afterEach(() => vi.restoreAllMocks());

const uploadField = SUBMISSION_FORM.fields.find((field) => field.type === "fileupload")!;

/** SUBMISSION_FORM with its upload field changed. */
function withUpload(change: Partial<FormField>, id = SUBMISSION_FORM.id): FormDescriptor {
  return {
    ...SUBMISSION_FORM,
    id,
    fields: SUBMISSION_FORM.fields.map((field) =>
      field.id === uploadField.id ? { ...field, ...change } : field,
    ),
  };
}

function setup(
  options: {
    forms?: FormDescriptor[];
    config?: Partial<FormsServerConfig>;
    siteverify?: boolean;
  } = {},
) {
  const descriptors = options.forms ?? [SUBMISSION_FORM, CONTACT_FORM];
  const stub = gravityFormsStub(descriptors);
  const cmsFetch = stub.fetchFor(CMS);
  const fetch: typeof globalThis.fetch = async (input, init) => {
    const request = new Request(input, init);
    if (request.url === TURNSTILE_SITEVERIFY_URL)
      return Response.json({ success: options.siteverify ?? false });
    return cmsFetch(request);
  };
  const server = createFormsServer({
    cmsOrigin: CMS,
    descriptor: ({ formId }) => descriptors.find((each) => each.id === formId) ?? null,
    bindings: () => ({}),
    language: "pt-PT",
    fetch,
    ...options.config,
  });
  return { server, stub };
}

/** A post as a browser sends it: a multipart body arrives as bytes with its boundary. */
async function post(
  body: FormData | string,
  options: { formId?: number; headers?: Record<string, string>; query?: string } = {},
) {
  let bytes: string | Uint8Array<ArrayBuffer> = body as string;
  const headers: Record<string, string> = { Origin: SITE, "Sec-Fetch-Site": "same-origin" };
  if (body instanceof FormData) {
    const encoded = new Response(body);
    headers["Content-Type"] = encoded.headers.get("Content-Type")!;
    bytes = new Uint8Array(await encoded.arrayBuffer());
  }
  return new Request(`${SITE}/gq/forms/${options.formId ?? 6}${options.query ?? ""}`, {
    method: "POST",
    headers: { ...headers, ...options.headers },
    body: bytes,
  });
}

const stateOf = (response: Response) => {
  const url = new URL(response.headers.get("Location")!, SITE);
  const cookie = response.headers.get("Set-Cookie")!.split(";")[0]!;
  return { url, state: readFormState({ url, cookie }, Number(url.searchParams.get("gq-form"))) };
};

test("an upload field publishes its public settings only, and a form with one is ready", () => {
  const delivered = JSON.parse(JSON.stringify(SUBMISSION_FORM)) as Record<string, unknown>;
  (delivered.fields as Array<Record<string, unknown>>)[5]!.upload = {
    ...IMAGE_AND_PDF_UPLOAD,
    allowedExtensions: [".JPG", " png ", "pdf", "pdf", "../x", 7],
    uploadPath: "/srv/uploads",
  };
  const parsed = parseFormDescriptor(delivered)!;
  expect(parsed.fields[5]).toEqual({
    id: 6,
    type: "fileupload",
    label: "Anexos",
    description: "Imagens ou documentos PDF.",
    required: false,
    visibility: "visible",
    inputs: [{ id: "6", name: "input_6", label: "Anexos" }],
    upload: {
      allowedExtensions: ["jpg", "png", "pdf"],
      maxFileSize: 5 * 1024 * 1024,
      multipleFiles: true,
      maxFiles: 5,
    },
  });
  expect(assertPublicDescriptor(JSON.parse(JSON.stringify(SUBMISSION_FORM)))).toEqual(
    SUBMISSION_FORM,
  );
  // A single file upload takes one file, whatever maxFiles says.
  expect(
    parseFormDescriptor(
      withUpload({ upload: { ...IMAGE_AND_PDF_UPLOAD, multipleFiles: false, maxFiles: 9 } }),
    )!.fields[5]!.upload!.maxFiles,
  ).toBe(1);

  const readiness = formsReadiness([SUBMISSION_FORM, UNSUPPORTED_FORM]);
  expect(readiness.forms.map((form) => [form.id, form.ok])).toEqual([
    [6, true],
    [2, false],
  ]);
  expect(readiness.warnings).toEqual([]);

  // Five files of 5 MB can't fit a Site's 10 MiB post: a warning, not a failure.
  expect(largestUpload(SUBMISSION_FORM)).toBe(25 * 1024 * 1024);
  const capped = formsReadiness([SUBMISSION_FORM, CONTACT_FORM], {
    maxUploadBytes: MAX_UPLOAD_BYTES,
  });
  expect(capped.ok).toBe(true);
  expect(capped.warnings).toEqual([
    "Form 6's files can reach 25.0 MB together, more than the 10.0 MB the Site accepts per post: lower its upload fields' size limits or numbers of files.",
  ]);
  const fits = withUpload({
    upload: { ...IMAGE_AND_PDF_UPLOAD, maxFileSize: 3 * 1048576, maxFiles: 3 },
  });
  expect(formsReadiness([fits], { maxUploadBytes: MAX_UPLOAD_BYTES }).warnings).toEqual([]);
});

test("upload settings the endpoint can't honour fail readiness, even when the CMS didn't say so", () => {
  const cases: Array<[Partial<FormField>, RegExp]> = [
    [{ upload: { ...IMAGE_AND_PDF_UPLOAD, allowedExtensions: [] } }, /allowed file extensions/],
    [
      { upload: { ...IMAGE_AND_PDF_UPLOAD, allowedExtensions: ["pdf", "docx", "svg"] } },
      /can't verify docx, svg files/,
    ],
    [{ upload: { ...IMAGE_AND_PDF_UPLOAD, maxFiles: 0 } }, /maximum number of files/],
    [{ upload: { ...IMAGE_AND_PDF_UPLOAD, maxFileSize: 0 } }, /no file size limit/],
    [{ upload: undefined }, /allowed file extensions/],
  ];
  for (const [change, message] of cases) {
    const parsed = parseFormDescriptor(JSON.parse(JSON.stringify(withUpload(change))))!;
    const [form] = formsReadiness([parsed]).forms;
    expect(form!.ok).toBe(false);
    expect(form!.diagnostics).toEqual([
      expect.objectContaining({ code: "unsupported-file-upload", fieldId: 6, type: "fileupload" }),
    ]);
    expect(form!.diagnostics[0]!.message).toMatch(message);
  }
  // The CMS's own diagnostic for the field isn't repeated.
  const reported = {
    ...withUpload({ upload: { ...IMAGE_AND_PDF_UPLOAD, allowedExtensions: ["docx"] } }),
    diagnostics: [
      { code: "unsupported-file-upload" as const, fieldId: 6, type: "fileupload", message: "CMS" },
    ],
  };
  expect(formsReadiness([reported]).forms[0]!.diagnostics.map((each) => each.message)).toEqual([
    "CMS",
  ]);
});

test("an upload field renders as an accessible file input in a multipart form that works without JavaScript", () => {
  const html = renderGravityForm({
    descriptor: SUBMISSION_FORM,
    source: "/partilhe/",
    language: "pt-PT",
  });
  assertAccessibleForm(html);
  expect(html).toContain(
    '<form class="gq-form__form" method="post" action="/gq/forms/6?gq_source=%2Fpartilhe%2F" enctype="multipart/form-data" novalidate',
  );
  expect(html).toContain('<input type="hidden" name="gq_source" value="/partilhe/">');
  expect(html).toContain(
    '<input type="file" id="gq-form-6-input_6" name="input_6" accept=".jpg,.jpeg,.png,.webp,.gif,.pdf" multiple aria-describedby="gq-form-6-field-6-description gq-form-6-field-6-hint">',
  );
  expect(html).toContain(
    '<p class="gq-form__hint" id="gq-form-6-field-6-hint">Tipos de ficheiro aceites: JPG, JPEG, PNG, WEBP, GIF, PDF. Até 5 MB por ficheiro. Até 5 ficheiros.</p>',
  );
  expect(html).toContain('<label class="gq-form__label" for="gq-form-6-input_6">Anexos</label>');
  expect(html).not.toMatch(/<script|gform_|plupload/);

  // A required single file: no `multiple`, required, and the English hint without a count.
  const single = renderGravityForm({
    descriptor: withUpload({
      required: true,
      upload: {
        ...IMAGE_AND_PDF_UPLOAD,
        allowedExtensions: ["pdf"],
        maxFileSize: 2621440,
        multipleFiles: false,
        maxFiles: 1,
      },
    }),
    source: "/partilhe/",
    language: "en",
  });
  assertAccessibleForm(single);
  expect(single).toMatch(
    /<input type="file" id="gq-form-6-input_6" name="input_6" accept=".pdf" aria-describedby="[^"]+" required aria-required="true">/,
  );
  expect(single).toContain("Accepted file types: PDF. Up to 2.5 MB per file.</p>");
  expect(formatFileSize(1536, "pt-PT")).toBe("1 KB");
  expect(formatFileSize(1572864, "pt-PT")).toBe("1,5 MB");

  // Forms without an upload are unchanged: no enctype, and the action names no page.
  const contact = renderGravityForm({
    descriptor: CONTACT_FORM,
    source: "/contactos/",
    language: "en",
  });
  expect(contact).toContain('action="/gq/forms/1" novalidate');
  expect(contact).not.toContain("enctype");

  // A hidden upload field isn't shown, and doesn't make the form multipart.
  const hidden = renderGravityForm({
    descriptor: withUpload({ visibility: "hidden" }),
    source: "/partilhe/",
    language: "en",
  });
  expect(hidden).not.toMatch(/type="file"|enctype/);

  // assertAccessibleForm catches a file input without a hint, or outside a multipart form.
  expect(() =>
    assertAccessibleForm(
      '<form><label for="f">F</label><input type="file" id="f" name="input_1"><button type="submit">x</button></form>',
    ),
  ).toThrow(/doesn't describe which files.*doesn't send files/s);
});

test("valid files reach Gravity Forms as multipart, under its input names, with the type their content proves", async () => {
  const { server, stub } = setup();
  const photo = sampleFile("C:\\fakepath\\feira.JPG", "jpg", { type: "application/x-msdownload" });
  const programme = sampleFile("programa.pdf", "pdf", { type: "image/png" });
  const response = (await server.handle(
    await post(
      multipartBody(
        { ...submissionValues(), input_99: "injected", gform_uploaded_files: '{"input_6":[]}' },
        { input_6: [photo, programme], input_77: sampleFile("x.png", "png") },
      ),
    ),
  ))!;
  expect(response.status).toBe(303);
  const { url, state } = stateOf(response);
  expect(`${url.pathname}${url.search}`).toBe("/partilhe/?gq-form=6");
  expect(state).toMatchObject({
    status: "sent",
    confirmation: "Obrigado. Vamos analisar o seu conteúdo.",
  });

  expect(stub.requests).toHaveLength(1);
  const [request] = stub.requests;
  expect(request!.url).toBe("/wp-json/gf/v2/forms/6/submissions");
  expect(request!.headers["content-type"]).toMatch(/^multipart\/form-data; boundary=/);
  assertNoEntryReadsOrCredentials(stub.requests);
  // Only the descriptor's inputs: no injected input, no Gravity Forms upload token.
  expect(request!.body).toEqual({
    input_1: "Ana Silva",
    input_2: "ana@example.com",
    input_3: "evento",
    input_4: "Feira da bioeconomia",
    input_5: "Um evento sobre bioeconomia circular.",
    input_7_1: "1",
    input_7_2: "Aceito o tratamento dos meus dados para analisar este conteúdo.",
    input_7_3: "2",
    input_8: "",
  });
  // Several files go as input_6[], each with its proven type and its name without a path.
  expect(Object.keys(request!.files!)).toEqual(["input_6[]"]);
  expect(
    request!.files!["input_6[]"]!.map(({ filename, type, size }) => ({ filename, type, size })),
  ).toEqual([
    { filename: "feira.JPG", type: "image/jpeg", size: 256 },
    { filename: "programa.pdf", type: "application/pdf", size: 256 },
  ]);
  expect(stub.entries).toHaveLength(1);
  expect(stub.entries[0]!.files.input_6).toHaveLength(2);

  // A single file goes as input_6; a form without uploads is still sent as JSON.
  const single = withUpload(
    { upload: { ...IMAGE_AND_PDF_UPLOAD, multipleFiles: false, maxFiles: 1 } },
    16,
  );
  const second = setup({ forms: [single, CONTACT_FORM] });
  await second.server.handle(
    await post(multipartBody(submissionValues(), { input_6: sampleFile("a.webp", "webp") }), {
      formId: 16,
    }),
  );
  expect(Object.keys(second.stub.requests[0]!.files!)).toEqual(["input_6"]);
  expect(second.stub.requests[0]!.files!.input_6![0]!.type).toBe("image/webp");
  expect(second.stub.entries).toHaveLength(1);
});

test("an optional upload left empty is sent without files; a required one is refused", async () => {
  const { server, stub } = setup();
  // A browser posts an empty part when no file is chosen.
  const empty = new File([], "", { type: "application/octet-stream" });
  const response = (await server.handle(
    await post(multipartBody(submissionValues(), { input_6: empty })),
  ))!;
  expect(stateOf(response).state!.status).toBe("sent");
  expect(stub.requests[0]!.files).toEqual({});

  const required = withUpload({ required: true }, 26);
  const strict = setup({ forms: [required] });
  const refused = (await strict.server.handle(
    await post(multipartBody(submissionValues(), { input_6: empty }), { formId: 26 }),
  ))!;
  expect(stateOf(refused).state).toMatchObject({ status: "invalid", errors: { 6: "required" } });
  // A form-encoded post can't skip a required upload either.
  const encoded = (await strict.server.handle(
    await post(new URLSearchParams(submissionValues()).toString(), {
      formId: 26,
      headers: { "Content-Type": "application/x-www-form-urlencoded" },
    }),
  ))!;
  expect(stateOf(encoded).state).toMatchObject({ status: "invalid", errors: { 6: "required" } });
  expect(strict.stub.requests).toEqual([]);
});

test("files of the wrong kind, too large or too many are refused before any CMS request", async () => {
  const small = withUpload({ upload: { ...IMAGE_AND_PDF_UPLOAD, maxFileSize: 1024, maxFiles: 2 } });
  const { server, stub } = setup({ forms: [small] });
  const cases: Array<[string, File[], string]> = [
    // A program renamed to an image: its bytes aren't a PNG.
    ["renamed executable", [sampleFile("foto.png", "exe", { type: "image/png" })], "file-type"],
    // A PDF named as a JPEG: the content must be what the extension names.
    ["mismatched content", [sampleFile("foto.jpg", "pdf", { type: "image/jpeg" })], "file-type"],
    ["extension not allowed", [sampleFile("texto.docx", "pdf")], "file-type"],
    ["no extension", [sampleFile("foto", "png")], "file-type"],
    ["double extension", [sampleFile("foto.png.exe", "png")], "file-type"],
    ["empty file", [new File([], "vazio.pdf")], "file-type"],
    ["too large", [sampleFile("grande.png", "png", { size: 1025 })], "file-size"],
    [
      "too many",
      [sampleFile("a.png", "png"), sampleFile("b.png", "png"), sampleFile("c.png", "png")],
      "file-count",
    ],
  ];
  for (const [name, files, code] of cases) {
    const response = (await server.handle(
      await post(multipartBody(submissionValues(), { input_6: files })),
    ))!;
    const { state } = stateOf(response);
    expect([name, state!.status, state!.errors[6]]).toEqual([name, "invalid", code]);
    // Typed values come back; files can't, and the page asks for them again.
    expect(state!.values.input_4).toBe("Feira da bioeconomia");
    const html = renderGravityForm({
      descriptor: small,
      source: "/partilhe/",
      language: "pt-PT",
      state,
    });
    assertAccessibleForm(html);
    expect(html).toMatch(
      /aria-describedby="[^"]*-hint gq-form-6-field-6-error" aria-invalid="true"/,
    );
    expect(html).toContain("Volte a escolher os ficheiros.</p>");
  }
  expect(stub.requests).toEqual([]);
});

test("the multipart body has a hard total cap; a post over it is sent back to its page unread", async () => {
  const { server, stub } = setup({ config: { maxUploadBytes: 64 * 1024 } });
  const big = multipartBody(submissionValues(), {
    input_6: sampleFile("grande.pdf", "pdf", { size: 70 * 1024 }),
  });
  // Without JavaScript the action names the page: the visitor goes back to it.
  const back = (await server.handle(await post(big, { query: "?gq_source=%2Fpartilhe%2F" })))!;
  expect(back.status).toBe(303);
  expect(stateOf(back).state).toMatchObject({ status: "too-large" });
  const html = renderGravityForm({
    descriptor: SUBMISSION_FORM,
    source: "/partilhe/",
    language: "pt-PT",
    state: stateOf(back).state,
  });
  expect(html).toContain("Os ficheiros são demasiado grandes para enviar em conjunto.");
  // A declared length over the cap is refused before reading; so is a page that isn't the Site's.
  const declared = (await server.handle(
    new Request(`${SITE}/gq/forms/6`, {
      method: "POST",
      headers: {
        Origin: SITE,
        "Content-Type": "multipart/form-data; boundary=x",
        "Content-Length": String(64 * 1024 + 1),
      },
      body: "--x--",
    }),
  ))!;
  expect(declared.status).toBe(413);
  const elsewhere = (await server.handle(
    await post(big, { query: "?gq_source=https://evil.test/" }),
  ))!;
  expect(elsewhere.status).toBe(413);
  const scripted = (await server.handle(
    await post(big, {
      query: "?gq_source=%2Fpartilhe%2F",
      headers: { Accept: "application/json" },
    }),
  ))!;
  expect([scripted.status, await scripted.json()]).toEqual([
    413,
    { status: "too-large", errors: {} },
  ]);
  expect(stub.requests).toEqual([]);

  expect(MAX_UPLOAD_BYTES).toBe(10 * 1024 * 1024);
  for (const maxUploadBytes of [33 * 1024 * 1024, 1024, 1.5])
    expect(() => setup({ config: { maxUploadBytes } })).toThrow(/maxUploadBytes/);
  expect((await setup().server.check()).maxUploadBytes).toBe(MAX_UPLOAD_BYTES);
});

test("malformed multipart is refused; the honeypot, Turnstile and unsupported forms still apply", async () => {
  const { server, stub } = setup();
  const malformed = (await server.handle(
    await post("not multipart", { headers: { "Content-Type": "multipart/form-data; boundary=x" } }),
  ))!;
  expect(malformed.status).toBe(400);

  const bot = (await server.handle(
    await post(
      multipartBody(
        { ...submissionValues(), input_8: "https://spam.test" },
        {
          input_6: sampleFile("a.png", "png"),
        },
      ),
    ),
  ))!;
  expect(stateOf(bot).state!.status).toBe("sent");

  const unsupported = withUpload(
    { upload: { ...IMAGE_AND_PDF_UPLOAD, allowedExtensions: ["docx"] } },
    36,
  );
  const refused = setup({ forms: [unsupported] });
  const failed = (await refused.server.handle(
    await post(multipartBody(submissionValues(), { input_6: sampleFile("a.docx", "pdf") }), {
      formId: 36,
    }),
  ))!;
  expect(stateOf(failed).state!.status).toBe("failed");
  expect([...stub.requests, ...refused.stub.requests]).toEqual([]);

  const turnstile = setup({
    config: { spam: { turnstile: true }, bindings: () => ({ TURNSTILE_SECRET_KEY: "s" }) },
  });
  const unverified = (await turnstile.server.handle(
    await post(
      multipartBody(
        { ...submissionValues(), "cf-turnstile-response": "t" },
        { input_6: sampleFile("a.png", "png") },
      ),
    ),
  ))!;
  expect(stateOf(unverified).state!.status).toBe("verification");
  expect(turnstile.stub.requests).toEqual([]);
  const verified = setup({
    siteverify: true,
    config: { spam: { turnstile: true }, bindings: () => ({ TURNSTILE_SECRET_KEY: "s" }) },
  });
  await verified.server.handle(
    await post(
      multipartBody(
        { ...submissionValues(), "cf-turnstile-response": "t" },
        { input_6: sampleFile("a.png", "png") },
      ),
    ),
  );
  expect(verified.stub.entries).toHaveLength(1);
});

test("Gravity Forms' own upload messages, a list for several files, come back as the field's error", async () => {
  // The descriptor allows PNG; Gravity Forms only PDF.
  const cms = gravityFormsStub([
    withUpload({ upload: { ...IMAGE_AND_PDF_UPLOAD, allowedExtensions: ["pdf"] } }),
  ]);
  const server = createFormsServer({
    cmsOrigin: CMS,
    descriptor: () => SUBMISSION_FORM,
    bindings: () => ({}),
    fetch: cms.fetchFor(CMS),
  });
  const response = (await server.handle(
    await post(
      multipartBody(submissionValues(), {
        input_6: [sampleFile("a.png", "png"), sampleFile("b.png", "png")],
      }),
    ),
  ))!;
  const { state } = stateOf(response);
  expect(state).toMatchObject({
    status: "invalid",
    messages: {
      6: "a.png - The uploaded file type is not allowed.\nb.png - The uploaded file type is not allowed.",
    },
  });
  expect(cms.entries).toEqual([]);
});

test("signatures, file names and the upload check as a library", async () => {
  expect(sniffFileType(Uint8Array.from(SAMPLE_FILES.jpg))).toBe("image/jpeg");
  expect(sniffFileType(Uint8Array.from(SAMPLE_FILES.png))).toBe("image/png");
  expect(sniffFileType(Uint8Array.from(SAMPLE_FILES.gif))).toBe("image/gif");
  expect(sniffFileType(Uint8Array.from(SAMPLE_FILES.webp))).toBe("image/webp");
  expect(sniffFileType(Uint8Array.from(SAMPLE_FILES.pdf))).toBe("application/pdf");
  expect(sniffFileType(Uint8Array.from(SAMPLE_FILES.exe))).toBeNull();
  expect(sniffFileType(new TextEncoder().encode("<svg xmlns="))).toBeNull();
  expect(sniffFileType(new Uint8Array())).toBeNull();
  expect(uploadFilename('../../etc/"pass\u0000wd".png')).toBe("passwd.png");
  expect(uploadFilename(`${"a".repeat(300)}.pdf`)).toHaveLength(200);
  expect(uploadFilename(`${"a".repeat(300)}.pdf`).endsWith(".pdf")).toBe(true);
  const check = await validateUploads(
    SUBMISSION_FORM,
    multipartBody({}, { input_6: sampleFile("a.gif", "gif") }),
  );
  expect(check.errors).toEqual({});
  expect(check.files.map(({ name, filename, type }) => ({ name, filename, type }))).toEqual([
    { name: "input_6[]", filename: "a.gif", type: "image/gif" },
  ]);
});
