import assert from "node:assert/strict";
import { execFileSync } from "node:child_process";
import { createHash } from "node:crypto";
import { readFileSync } from "node:fs";

const [tarball, zip] = process.argv.slice(2);
const npmFiles = execFileSync("tar", ["-tzf", tarball], { encoding: "utf8" }).trim().split("\n");
const zipFiles = JSON.parse(
  execFileSync(
    "python3",
    [
      "-c",
      "import json,sys,zipfile; z=zipfile.ZipFile(sys.argv[1]); print(json.dumps({n:z.read(n).decode() for n in z.namelist()}))",
      zip,
    ],
    { encoding: "utf8" },
  ),
);
const forbidden =
  /@quick-release\/|npm\.pkg\.github\.com|(?:gh[pousr]_[A-Za-z0-9]{20,}|github_pat_[A-Za-z0-9_]{20,})|_authToken\s*=/;
// Exactly the SQL each migrations export ships: the publication store's and consent's.
const sql = [
  "package/migrations/0001_publications.sql",
  "package/migrations/0002_entries.sql",
  "package/migrations/0003_publication_events.sql",
  "package/migrations/0004_withdrawals.sql",
  "package/migrations/0005_reconciliation.sql",
  "package/consent-migrations/0001_consent_records.sql",
];
assert.deepEqual(npmFiles.filter((file) => file.endsWith(".sql")).sort(), sql.toSorted());
for (const file of npmFiles) {
  if (!sql.includes(file))
    assert.match(file, /^package\/((?:package\.json|README\.md)|dist\/[\w-]+\.(js|d\.ts))$/);
  const text = execFileSync("tar", ["-xOzf", tarball, file], { encoding: "utf8" });
  assert.doesNotMatch(text, forbidden, file);
  if (file === "package/package.json") {
    const manifest = JSON.parse(text);
    assert.deepEqual(manifest.dependencies, { zod: "3.25.76" });
    for (const field of ["peerDependencies", "optionalDependencies", "devDependencies"]) {
      assert.deepEqual(manifest[field] ?? {}, {}, field);
    }
  }
}
assert.equal(Object.keys(zipFiles).length, 7);
for (const [file, text] of Object.entries(zipFiles)) {
  assert.match(
    file,
    /^(?:composer\.json|gq-content\.php|README\.md|LICENSE|modules\/(?:publication-events|settings-events|delivery-retries)\.php)$/,
  );
  assert.doesNotMatch(text, forbidden, file);
}
const sha256 = (path) => createHash("sha256").update(readFileSync(path)).digest("hex");
console.log(
  JSON.stringify(
    {
      npm: { files: npmFiles, sha256: sha256(tarball) },
      cms: { files: Object.keys(zipFiles), sha256: sha256(zip) },
    },
    null,
    2,
  ),
);
