import { test, expect } from "vite-plus/test";
import { publicBundleComments } from "./public-bundle.ts";

test("public bundle strips generated private paths while retaining legal notices and code", () => {
  const code =
    '/*! @license MIT Copyright Example */\n//#region node_modules/.pnpm/@quick-release+design-renderer@0.9.0/node_modules/@quick-release/design-renderer/dist/theme.js\nexport const value = "unchanged";\n//#endregion\n';
  expect(publicBundleComments(code)).toBe(
    '/*! @license MIT Copyright Example */\nexport const value = "unchanged";\n//#endregion\n',
  );
  expect(publicBundleComments('export const path = "@quick-release/design-renderer";')).toBe(
    'export const path = "@quick-release/design-renderer";',
  );
});

test("public bundle retains other region comments and is idempotent", () => {
  const code = "//#region frontend/src/example.ts\nexport type Value = string;\n//#endregion\n";
  expect(publicBundleComments(code)).toBe(code);
  expect(publicBundleComments(publicBundleComments(code))).toBe(code);
});
