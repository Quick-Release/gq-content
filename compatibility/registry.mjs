import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const metadata = JSON.parse(
  execFileSync(
    "vp",
    [
      "pm",
      "view",
      "@quick-release/design-contract@0.4.0",
      "--json",
      "--",
      "--registry=https://npm.pkg.github.com",
    ],
    { encoding: "utf8" },
  ),
);
assert.equal(metadata.version, "0.4.0");
assert.equal(
  metadata.dist.integrity,
  "sha512-BnMqr09gF1tqXBqh92T7rezUHqQef0Pp3HYizZz3JZw7hGTrAEOa71GQ3aKHjMrgxSMRoAa1i/p59Ged9Hld7A==",
);
console.log(
  JSON.stringify(
    {
      name: metadata.name,
      version: metadata.version,
      dist: metadata.dist,
      verifiedAt: new Date().toISOString(),
      repository: process.env.GITHUB_REPOSITORY ?? null,
      runId: process.env.GITHUB_RUN_ID ?? null,
      access:
        process.env.GITHUB_ACTIONS === "true"
          ? "repository Actions credential"
          : "local approved token helper; CI access unverified",
    },
    null,
    2,
  ),
);
