import { expect, test } from "vite-plus/test";
import * as html from "@getquick/content/consent/html";
import * as astro from "@getquick/content/consent/astro";
import { consentConfiguration } from "@getquick/content/consent";

test("Astro retains the same HTML UI exports and markup", () => {
  expect(astro).toEqual(html);
  const input = {
    configuration: consentConfiguration({ controller: "Example" }),
    language: "pt-PT",
  };
  expect(astro.consentPage(input)).toEqual(html.consentPage(input));
});
