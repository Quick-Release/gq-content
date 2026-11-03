import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
const metadata = JSON.parse(
  execFileSync(
    "vp",
    [
      "pm",
      "view",
      "@quick-release/design-contract@0.10.4",
      "--json",
      "--",
      "--registry=https://npm.pkg.github.com",
    ],
    { encoding: "utf8" },
  ),
);
assert.equal(metadata.version, "0.10.4");
assert.equal(
  metadata.dist.integrity,
  "sha512-3qPDL2A5+QNH0G49Kbf8abSqd8g1M3cbHvifzs/ekO678KDVMLTfq7aVS67bibFFrNajKj27IkxWVTI9ZsMDWQ==",
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
