import { test, expect } from "vite-plus/test";
import { spawnSync } from "node:child_process";

const marker = "test-private-value-never-log";
const probe = (env) =>
  spawnSync(process.execPath, ["scripts/release/operator.mjs", "probe"], {
    encoding: "utf8",
    env: { PATH: process.env.PATH, HOME: process.env.HOME, ...env },
  });

test("release operator requires the approved scope and redacts credential input", () => {
  const result = probe({ SIGILLO: "0", NPM_TOKEN: marker });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('"handoff":false');
  expect(result.stderr).toContain("approved Sigillo npm scope required");
  expect(result.stdout + result.stderr).not.toContain(marker);
});

test("malformed Composer secret input is not included in release errors", () => {
  const result = probe({ SIGILLO: "1", NPM_TOKEN: marker, COMPOSER_AUTH: `{${marker}` });
  expect(result.status).toBe(1);
  expect(result.stderr).toContain('"handoff":false');
  expect(result.stdout + result.stderr).not.toContain(marker);
});
