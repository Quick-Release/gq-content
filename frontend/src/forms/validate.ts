// Validation of a submission against its form's descriptor, before anything
// reaches the CMS. Gravity Forms validates again and stays the authority; this
// refuses what can't be valid and keeps only the descriptor's inputs.
import type { FormErrorCode } from "./copy";
import type { FormDescriptor, FormField } from "./descriptor";

/** No single value is longer (characters). */
export const MAX_VALUE_LENGTH = 10_000;

/** What the visitor posted: a form body's values by name. */
export type SubmittedValues = Pick<URLSearchParams, "get">;

export interface SubmissionCheck {
  /** Each input's value, by Gravity Forms' input name, for the CMS. */
  input: Record<string, string>;
  /** Field errors, by field id. */
  errors: Record<number, FormErrorCode>;
  /** What to show again in the form after errors (visible fields only). */
  values: Record<string, string>;
}

const EMAIL = /^[^\s@<>()[\]\\,;:"]+@[^\s@<>()[\]\\,;:"]+\.[^\s@<>()[\]\\,;:"]+$/;

function webAddress(value: string): boolean {
  try {
    const url = new URL(value);
    return (url.protocol === "https:" || url.protocol === "http:") && url.hostname.includes(".");
  } catch {
    return false;
  }
}

/**
 * A number as visitors type it in either convention (1234.5, 1,234.5, 1.234,5,
 * 1 234,5): the last separator is the decimal one when both appear. NaN when
 * it isn't one; Gravity Forms checks its own number format again.
 */
export function parseNumber(value: string): number {
  let text = value.replace(/[\s\u00a0']/g, "");
  const dot = text.lastIndexOf(".");
  const comma = text.lastIndexOf(",");
  if (dot >= 0 && comma >= 0)
    text = dot > comma ? text.replaceAll(",", "") : text.replaceAll(".", "").replace(",", ".");
  else if (comma >= 0)
    // One comma is a decimal comma; several are thousands separators.
    text = text.indexOf(",") === comma ? text.replace(",", ".") : text.replaceAll(",", "");
  else if ((text.match(/\./g) ?? []).length > 1) text = text.replaceAll(".", "");
  return /^-?\d+(\.\d+)?$/.test(text) ? Number(text) : Number.NaN;
}

/** A posted value, without surrounding whitespace, bounded. */
function read(values: SubmittedValues, name: string): string {
  return (values.get(name) ?? "").trim().slice(0, MAX_VALUE_LENGTH);
}

function check(
  field: FormField,
  values: SubmittedValues,
  input: Record<string, string>,
  shown: Record<string, string>,
): FormErrorCode | null {
  const take = (name: string) => {
    const value = read(values, name);
    input[name] = value;
    if (field.visibility === "visible" && field.type !== "hidden") shown[name] = value;
    return value;
  };
  const first = field.inputs[0];
  switch (field.type) {
    case "html":
    case "section":
      return null;
    case "hidden": {
      if (!first) return null;
      const value = values.get(first.name) === null ? (field.defaultValue ?? "") : take(first.name);
      input[first.name] = value;
      return null;
    }
    case "checkbox": {
      const chosen = field.inputs.filter((each) => {
        const value = read(values, each.name);
        if (value === "") return false;
        input[each.name] = value;
        shown[each.name] = value;
        return true;
      });
      if (chosen.some((each) => read(values, each.name) !== each.value)) return "choice";
      return field.required && chosen.length === 0 ? "required" : null;
    }
    case "consent": {
      if (!first) return null;
      const checked = read(values, first.name) === "1";
      if (field.required && !checked) return "required";
      if (checked) {
        input[first.name] = "1";
        shown[first.name] = "1";
        // The text agreed to and its revision come from the descriptor, never the visitor.
        const [, label, revision] = field.inputs;
        if (label) input[label.name] = field.consent?.checkboxLabel ?? "";
        if (revision) input[revision.name] = field.consent?.revisionId ?? "";
      }
      return null;
    }
    case "name": {
      const given = field.inputs.map((each) => ({ each, value: take(each.name) }));
      if (!field.required) return null;
      // Gravity Forms requires the first and last names (or the one simple input).
      const essential = given.filter(({ each }) => given.length === 1 || /\.(3|6)$/.test(each.id));
      return (essential.length ? essential : given).some(({ value }) => value === "")
        ? "required"
        : null;
    }
    default: {
      if (!first) return null;
      const value = take(first.name);
      if (value === "") {
        if (field.type === "email" && field.inputs[1]) take(field.inputs[1].name);
        return field.required ? "required" : null;
      }
      // Characters as Gravity Forms counts them (code points, mb_strlen).
      if (field.maxLength !== undefined && Array.from(value).length > field.maxLength)
        return "too-long";
      if (field.type === "email") {
        if (!EMAIL.test(value)) return "email";
        const confirmation = field.inputs[1];
        if (confirmation && take(confirmation.name) !== value) return "email-mismatch";
      }
      if (field.type === "website" && !webAddress(value)) return "url";
      if (field.type === "number") {
        const number = parseNumber(value);
        if (!Number.isFinite(number)) return "number";
        if (
          (field.range?.min !== undefined && number < field.range.min) ||
          (field.range?.max !== undefined && number > field.range.max)
        )
          return "range";
      }
      if (
        (field.type === "select" || field.type === "radio") &&
        !(field.choices ?? []).some((choice) => choice.value === value)
      )
        return "choice";
      return null;
    }
  }
}

/**
 * Checks a submission against the descriptor: required fields, formats,
 * choices and lengths. Only the descriptor's inputs are kept; the honeypot is
 * passed through, empty, for Gravity Forms' own check.
 */
export function validateSubmission(
  descriptor: FormDescriptor,
  values: SubmittedValues,
): SubmissionCheck {
  const input: Record<string, string> = {};
  const shown: Record<string, string> = {};
  const errors: Record<number, FormErrorCode> = {};
  for (const field of descriptor.fields) {
    const error = check(field, values, input, shown);
    if (error) errors[field.id] = error;
  }
  if (descriptor.honeypot) input[descriptor.honeypot.name] = "";
  return { input, errors, values: shown };
}

/** Whether the honeypot was filled in: a bot. Such a submission never reaches the CMS. */
export function honeypotFilled(descriptor: FormDescriptor, values: SubmittedValues): boolean {
  return descriptor.honeypot !== null && (values.get(descriptor.honeypot.name) ?? "") !== "";
}
