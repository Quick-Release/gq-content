// The forms capability's own text, in the Runtime's copy languages. Labels,
// choices, descriptions and confirmations are the editor's, from the CMS.

export type FormsCopyLanguage = "en" | "pt-PT";

export type FormErrorCode =
  | "required"
  | "email"
  | "email-mismatch"
  | "number"
  | "range"
  | "url"
  | "choice"
  | "too-long";

export interface FormsCopy {
  required: string;
  requiredFields: string;
  errorSummary: string;
  errors: Record<FormErrorCode, string>;
  /** The submission was refused before reaching the CMS, or the CMS failed. */
  failed: string;
  /** Turnstile failed or was missing. */
  verification: string;
  /** A submission arrived too fast or too often. */
  tooMany: string;
  sent: string;
  unavailable: string;
  submit: string;
  privacyPolicy: string;
  /** Visible to assistive technology only, on the honeypot (Gravity Forms' wording). */
  honeypot: string;
  /** With Turnstile and no JavaScript. */
  needsJavaScript: string;
}

export const FORMS_COPY: Record<FormsCopyLanguage, FormsCopy> = {
  en: {
    required: "required",
    requiredFields: "Fields marked with * are required.",
    errorSummary: "There was a problem with your submission. Please review the fields below.",
    errors: {
      required: "This field is required.",
      email: "Enter a valid email address.",
      "email-mismatch": "The email addresses don't match.",
      number: "Enter a number.",
      range: "Enter a number in the allowed range.",
      url: "Enter a valid web address, starting with https://.",
      choice: "Choose one of the options.",
      "too-long": "This is longer than allowed.",
    },
    failed: "Your message couldn't be sent. Please try again later.",
    verification: "We couldn't verify that you're not a robot. Please try again.",
    tooMany: "Too many submissions. Please try again later.",
    sent: "Thank you. Your message has been sent.",
    unavailable: "This form isn't available.",
    submit: "Submit",
    privacyPolicy: "Privacy policy",
    honeypot: "This field is for validation purposes and should be left unchanged.",
    needsJavaScript: "This form needs JavaScript to verify you're not a robot.",
  },
  "pt-PT": {
    required: "obrigatório",
    requiredFields: "Os campos assinalados com * são obrigatórios.",
    errorSummary: "Houve um problema com o envio. Reveja os campos abaixo.",
    errors: {
      required: "Este campo é obrigatório.",
      email: "Introduza um endereço de email válido.",
      "email-mismatch": "Os endereços de email não coincidem.",
      number: "Introduza um número.",
      range: "Introduza um número dentro do intervalo permitido.",
      url: "Introduza um endereço web válido, começado por https://.",
      choice: "Escolha uma das opções.",
      "too-long": "Excede o comprimento permitido.",
    },
    failed: "Não foi possível enviar a sua mensagem. Tente novamente mais tarde.",
    verification: "Não foi possível verificar que não é um robô. Tente novamente.",
    tooMany: "Demasiados envios. Tente novamente mais tarde.",
    sent: "Obrigado. A sua mensagem foi enviada.",
    unavailable: "Este formulário não está disponível.",
    submit: "Enviar",
    privacyPolicy: "Política de privacidade",
    honeypot: "Este campo serve para validação e deve ser deixado em branco.",
    needsJavaScript: "Este formulário precisa de JavaScript para verificar que não é um robô.",
  },
};

/** The copy language for a page's `lang`: Portuguese for `pt*`, else English. */
export function formsCopyLanguage(language: string | null | undefined): FormsCopyLanguage {
  return /^pt\b/i.test(language ?? "") ? "pt-PT" : "en";
}
