// The pair's version: the npm package's, which the Composer package, the
// plugin header and its VERSION constant agree with (scripts/inspect-artifacts.mjs).
import { readFileSync } from "node:fs";
import { resolve } from "node:path";

export const version = JSON.parse(
  readFileSync(resolve(import.meta.dirname, "../frontend/package.json"), "utf8"),
).version;
export const npmFilename = `getquick-content-${version}.tgz`;
export const cmsFilename = `gq-content-${version}.zip`;
