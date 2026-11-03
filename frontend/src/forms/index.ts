// @getquick/content/forms: headless Gravity Forms' public form descriptor
// (ADR 0009): its types, parsing, submission and upload validation and the
// readiness diagnostics. No content runtime, consent runtime, framework or zod.
export {
  FORMS_PATH,
  FORM_DESCRIPTOR_SCHEMA,
  GRAVITY_FORMS_BLOCK,
  SUPPORTED_FIELD_TYPES,
  VERIFIABLE_FILE_EXTENSIONS,
  blockFormId,
  findForm,
  formAction,
  formDiagnostics,
  formsReadiness,
  hasUploads,
  largestUpload,
  parseFormDescriptor,
  parseFormDescriptors,
  type FormChoice,
  type FormConfirmation,
  type FormConsent,
  type FormDescriptor,
  type FormDiagnostic,
  type FormDiagnosticCode,
  type FormField,
  type FormFieldType,
  type FormInput,
  type FormSpamControl,
  type FormUpload,
  type FormsReadiness,
  type VerifiableFileExtension,
} from "./descriptor";
export {
  FILE_TYPES,
  sniffFileType,
  uploadFilename,
  validateUploads,
  type CheckedFile,
  type SubmittedFile,
  type SubmittedFiles,
  type UploadCheck,
} from "./uploads";
export {
  MAX_VALUE_LENGTH,
  honeypotFilled,
  validateSubmission,
  type SubmissionCheck,
  type SubmittedValues,
} from "./validate";
export {
  FORM_STATE_MAX_AGE,
  FORM_STATE_PARAM,
  clearFormStateCookie,
  formStateCookie,
  formStateCookieName,
  formStateLocation,
  readFormState,
  type FormState,
  type FormStatus,
} from "./state";
export {
  FORMS_COPY,
  formsCopyLanguage,
  type FormErrorCode,
  type FormsCopy,
  type FormsCopyLanguage,
} from "./copy";
