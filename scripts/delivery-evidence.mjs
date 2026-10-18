import { execFileSync } from "node:child_process";
import { readFileSync, writeFileSync, mkdirSync } from "node:fs";
import { createHash } from "node:crypto";
import assert from "node:assert/strict";
import { resolve } from "node:path";
const source = resolve(process.argv[2] ?? "../gq-site");
const checkpoint = "eaec13488d57b3d04059309b5b36de5d016f3de1";
const base = "blueprint/templates/apps/frontend/";
const git = (...args) => execFileSync("git", ["-C", source, ...args]);
const paths = [
  "src/lib/delivery.ts",
  "src/lib/publications.ts",
  "src/test/sqlite-d1.ts",
  "src/test/wordpress-stub.ts",
  ...["homepage", "entries", "routes", "languages"].map((name) => `src/${name}.test.ts`),
  ...[
    "0001_publications.sql",
    "0002_entries.sql",
    "0003_publication_events.sql",
    "0004_withdrawals.sql",
    "0005_reconciliation.sql",
  ].map((name) => `migrations/${name}`),
];
assert.equal(
  git("diff", checkpoint, "origin/main", "--", ...paths.map((path) => base + path)).length,
  0,
);
const files = paths.map((path) => {
  const bytes = git("show", `${checkpoint}:${base}${path}`);
  if (path.startsWith("migrations/")) assert.deepEqual(readFileSync(`frontend/${path}`), bytes);
  return {
    sourcePath: base + path,
    sourceBlob: git("rev-parse", `${checkpoint}:${base}${path}`).toString().trim(),
    sha256: createHash("sha256").update(bytes).digest("hex"),
    destination: path.startsWith("migrations/")
      ? `frontend/${path}`
      : path.startsWith("src/test/")
        ? `frontend/tests/support/${path.split("/").at(-1)}`
        : path.endsWith(".test.ts")
          ? "frontend/tests/delivery.test.ts (public DTO projection; protocol and presentation allocation below)"
          : `frontend/${path} (configured private subset)`,
  };
});
const baseline = JSON.parse(
  readFileSync("docs/evidence/issue-3/assertion-allocation.json", "utf8"),
);
// Only public-read assertions move in this slice. Refresh/event/provisioning
// assertions keep their recorded later-ticket or Blueprint responsibility.
const rules = [
  [/looked up and served in English/, "an English cold lookup queries and serves its own language"],
  [/never refreshed/, "unprepared store refuses home and entries before contacting CMS"],
  [
    /front page, menu, logo and design presets are served/,
    "stored home and chrome survive missing secrets and CMS outages without an age limit",
  ],
  [
    /outlive|outlives|survives a Worker restart/,
    "publication data survives closing and reopening the database",
  ],
  [/healthy cold path/, "cold lookup reads once then serves durable content through outage"],
  [/uncached entry while the CMS is down/, "cold failed lookup is unavailable, never missing"],
  [
    /URL WordPress confirms isn't published/,
    "cold confirmed missing stores no negative row and may later become published",
  ],
  [/unreadable store.*not.*CMS/, "store failures never trigger live fallback even in development"],
  [/content stored in a format/, "unreadable %s format %s fails safely"],
  [
    /built Frontend without a publication store/,
    "production without a database refuses every live delivery path",
  ],
  [
    /local development renders WordPress/,
    "only explicit development permits live home, entry and chrome without a database",
  ],
  [
    /percent-encoded route is the same/,
    "cold route aliases redirect to canonical paths including absolute and percent encoded CMS URIs",
  ],
  [
    /each language's home|each home links|render in their language, with hreflang/,
    "two language homes and entries retain canonical alternates and their own chrome",
  ],
  [
    /language whose home was never stored|no fallback across languages|entry stored before the Site listed/,
    "language homes never held, wrong-language entries and legacy entries keep language isolation",
  ],
  [
    /withdrawn translation is no longer an alternate/,
    "two language homes and entries retain canonical alternates and their own chrome",
  ],
];
const testSource = readFileSync("frontend/tests/delivery.test.ts", "utf8");
const allocation = baseline.files
  .filter(
    (file) => paths.some((path) => base + path === file.path) && file.path.endsWith(".test.ts"),
  )
  .map((file) => ({
    sourcePath: file.path,
    assertions: file.assertions.map((row) => {
      const destination = rules.find(([pattern]) => pattern.test(row.context))?.[1];
      if (!destination)
        return {
          ...row,
          status: "retained for later slice / Blueprint",
          note: /refresh|prepar/i.test(row.context)
            ? "Refresh mutation/protocol assertions remain #6/#7/#9; #4 seeds prior stored state and proves public delivery only."
            : "See original allocation; not claimed migrated by #4.",
        };
      assert.ok(testSource.includes(destination), destination);
      return {
        sourceLines: row.sourceLines,
        context: row.context,
        status: "public delivery behavior migrated #4",
        destination: `frontend/tests/delivery.test.ts: ${destination}`,
        note: "DTO/status/language behavior replaces the source's rendering projection; HTML composition, metadata, copy and CSS stay gq-site#77. Refresh setup/protocol remains #6/#7/#9.",
      };
    }),
  }));
mkdirSync("docs/evidence/issue-4", { recursive: true });
writeFileSync(
  "docs/evidence/issue-4/provenance.json",
  JSON.stringify(
    {
      checkpoint,
      upstream: git("rev-parse", "origin/main").toString().trim(),
      relevantDelta: "empty",
      files,
    },
    null,
    2,
  ) + "\n",
);
writeFileSync(
  "docs/evidence/issue-4/assertion-allocation.json",
  JSON.stringify(
    {
      checkpoint,
      baseline: "../issue-3/assertion-allocation.json",
      note: "Overlay for #4. The six #3 suites remain byte/assertion-preserved. Rows describe runtime guarantee projection, not copied HTML assertion expressions. Later mutation/protocol and real-CMS proofs remain required.",
      files: allocation,
    },
    null,
    2,
  ) + "\n",
);
console.log(
  `Verified ${files.length} immutable source paths and all five SQL byte identities; recorded public delivery assertion allocation.`,
);
