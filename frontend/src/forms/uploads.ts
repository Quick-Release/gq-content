// Checks the files of a submission against its form's upload fields, before
// anything reaches the CMS (ADR 0010 here): how many, how large, the extension
// the field allows, and the format the file's first bytes prove. The client's
// MIME type is never trusted. Gravity Forms validates again and stores the
// files; this refuses what can't be valid.
import type { FormErrorCode } from "./copy";
import type { FormDescriptor, VerifiableFileExtension } from "./descriptor";

/** The format each allowed extension's content must prove, as a MIME type. */
export const FILE_TYPES: Readonly<Record<VerifiableFileExtension, string>> = {
  jpg: "image/jpeg",
  jpeg: "image/jpeg",
  png: "image/png",
  gif: "image/gif",
  webp: "image/webp",
  pdf: "application/pdf",
};

/** Bytes read from the start of a file to identify it. */
const SIGNATURE_BYTES = 12;

const ascii = (text: string) => new TextEncoder().encode(text);
const JPEG = [0xff, 0xd8, 0xff];
const PNG = [0x89, 0x50, 0x4e, 0x47, 0x0d, 0x0a, 0x1a, 0x0a];
const GIF87 = ascii("GIF87a");
const GIF89 = ascii("GIF89a");
const RIFF = ascii("RIFF");
const WEBP = ascii("WEBP");
const PDF = ascii("%PDF-");

function startsWith(bytes: Uint8Array, offset: number, expected: ArrayLike<number>): boolean {
  for (let index = 0; index < expected.length; index++)
    if (bytes[offset + index] !== expected[index]) return false;
  return true;
}

/** The format a file's first bytes prove (a MIME type of FILE_TYPES), or null. */
export function sniffFileType(bytes: Uint8Array): string | null {
  if (startsWith(bytes, 0, JPEG)) return "image/jpeg";
  if (startsWith(bytes, 0, PNG)) return "image/png";
  if (startsWith(bytes, 0, GIF87) || startsWith(bytes, 0, GIF89)) return "image/gif";
  if (startsWith(bytes, 0, RIFF) && startsWith(bytes, 8, WEBP)) return "image/webp";
  if (startsWith(bytes, 0, PDF)) return "application/pdf";
  return null;
}

/** A posted file (a `File` from `FormData`): a Blob with the visitor's file name. */
export type SubmittedFile = Blob & { readonly name: string };

/** What the visitor posted: a multipart body's entries by name (`FormData`). */
export interface SubmittedFiles {
  getAll(name: string): ReadonlyArray<unknown>;
}

/** A checked file, as it is sent to Gravity Forms. */
export interface CheckedFile {
  /** The name it is posted under: `input_<field>`, or `input_<field>[]` for several. */
  name: string;
  file: SubmittedFile;
  /** The visitor's file name, without any path or control characters. */
  filename: string;
  /** The format its content proves; never the client's. */
  type: string;
}

export interface UploadCheck {
  files: CheckedFile[];
  /** Field errors, by field id. */
  errors: Record<number, FormErrorCode>;
}

const isFile = (value: unknown): value is SubmittedFile =>
  value instanceof Blob && typeof (value as SubmittedFile).name === "string";

/** The file name without a path, quotes or control characters, keeping its end (the extension). */
export function uploadFilename(name: string): string {
  const base = name.split(/[\\/]/).pop() ?? "";
  // oxlint-disable-next-line no-control-regex -- control characters are what it removes.
  return Array.from(base.replace(/[\u0000-\u001f\u007f"]/g, "").trim())
    .slice(-200)
    .join("");
}

const extensionOf = (filename: string) => /\.([^.]+)$/.exec(filename)?.[1]?.toLowerCase() ?? "";

/**
 * Checks each visible upload field's files: a required field has one, a field
 * takes at most its maximum, and each file has an allowed extension, fits the
 * field's size limit and is what its extension names. Files posted under any
 * other name are ignored. An empty part (no file chosen) isn't a file.
 */
export async function validateUploads(
  descriptor: FormDescriptor,
  posted: SubmittedFiles,
): Promise<UploadCheck> {
  const files: CheckedFile[] = [];
  const errors: Record<number, FormErrorCode> = {};
  for (const field of descriptor.fields) {
    const input = field.inputs[0];
    const upload = field.upload;
    if (field.type !== "fileupload" || field.visibility !== "visible" || !input || !upload)
      continue;
    const chosen = posted
      .getAll(input.name)
      .filter(isFile)
      .filter((file) => file.size > 0 || file.name !== "");
    if (chosen.length === 0) {
      if (field.required) errors[field.id] = "required";
      continue;
    }
    if (chosen.length > Math.max(upload.maxFiles, 1)) {
      errors[field.id] = "file-count";
      continue;
    }
    const checked: CheckedFile[] = [];
    for (const file of chosen) {
      const filename = uploadFilename(file.name);
      const extension = extensionOf(filename);
      const expected = upload.allowedExtensions.includes(extension)
        ? FILE_TYPES[extension as VerifiableFileExtension]
        : undefined;
      if (!expected || file.size === 0) {
        errors[field.id] = "file-type";
        break;
      }
      if (file.size > upload.maxFileSize) {
        errors[field.id] = "file-size";
        break;
      }
      const head = new Uint8Array(await file.slice(0, SIGNATURE_BYTES).arrayBuffer());
      if (sniffFileType(head) !== expected) {
        errors[field.id] = "file-type";
        break;
      }
      checked.push({
        name: upload.multipleFiles ? `${input.name}[]` : input.name,
        file,
        filename,
        type: expected,
      });
    }
    if (!errors[field.id]) files.push(...checked);
  }
  return { files, errors };
}
