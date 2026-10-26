// Run only inside the approved per-command Sigillo scopes. Credentials stay in
// memory and are supplied only to the existing fail-closed release services.
import assert from "node:assert/strict";
import { execFileSync, spawnSync } from "node:child_process";
import { mkdtempSync, writeFileSync, rmSync } from "node:fs";
import { tmpdir } from "node:os";
import { join } from "node:path";
import { root } from "./candidate.mjs";

const [action, bundle, ciRun] = process.argv.slice(2);
const output = (args) =>
  execFileSync("gh", args, { encoding: "utf8", stdio: ["ignore", "pipe", "pipe"] }).trim();
let directory;
try {
  assert(["probe", "publish"].includes(action), "use probe or publish BUNDLE CI_RUN");
  assert(
    process.env.SIGILLO === "1" && process.env.NPM_TOKEN,
    "approved Sigillo npm scope required",
  );
  let composer;
  try {
    composer = JSON.parse(process.env.COMPOSER_AUTH ?? "{}")["http-basic"]?.[
      "proxy.composer.getquick.io"
    ];
  } catch {
    throw Error("approved Composer credential mapping is invalid");
  }
  assert(
    typeof composer?.username === "string" &&
      composer.username &&
      typeof composer.password === "string" &&
      composer.password,
    "approved proxy Composer credential missing",
  );
  let operatorToken;
  try {
    const permissions = JSON.parse(
      output(["api", "repos/Quick-Release/getquick-registry"]),
    ).permissions;
    assert(permissions?.push, "registry dispatch permission required");
    operatorToken = output(["auth", "token"]);
  } catch {
    throw Error("approved GitHub operator lacks registry dispatch capability");
  }
  assert(operatorToken, "GitHub operator credential missing");
  directory = mkdtempSync(join(tmpdir(), "gq-content-release-"));
  const npmrc = join(directory, "npmrc");
  writeFileSync(npmrc, "//registry.npmjs.org/:_authToken=${NPM_TOKEN}\n", { mode: 0o600 });
  const environment = {};
  for (const key of [
    "PATH",
    "HOME",
    "USER",
    "LOGNAME",
    "SHELL",
    "LANG",
    "LC_ALL",
    "TMPDIR",
    "PNPM_HOME",
    "NODE_EXTRA_CA_CERTS",
    "SSH_AUTH_SOCK",
    "CI",
    "VP_GIT_HOOKS",
    "NO_COLOR",
  ])
    if (process.env[key] !== undefined) environment[key] = process.env[key];
  Object.assign(environment, {
    GH_TOKEN: operatorToken,
    GQ_REGISTRY_TOKEN: operatorToken,
    GQ_COMPOSER_USERNAME: composer.username,
    GQ_COMPOSER_PASSWORD: composer.password,
    NPM_TOKEN: process.env.NPM_TOKEN,
    NPM_CONFIG_USERCONFIG: npmrc,
  });
  if (action === "probe") {
    const response = await fetch("https://proxy.composer.getquick.io/p2/getquick/gq-design.json", {
      redirect: "error",
      headers: {
        Authorization:
          "Basic " + Buffer.from(`${composer.username}:${composer.password}`).toString("base64"),
      },
    });
    assert(response.ok, `Composer probe HTTP ${response.status}`);
    const versions = (await response.json()).packages?.["getquick/gq-design"];
    assert(
      Array.isArray(versions) &&
        versions.some((item) => item.version.replace(/^v/, "") === "0.9.4"),
      "published Design 0.9.4 Composer record missing",
    );
    const npm = spawnSync("vp", ["pm", "whoami", "--", "--registry=https://registry.npmjs.org"], {
      cwd: root,
      env: environment,
      stdio: "ignore",
    });
    assert.equal(npm.status, 0, "approved npm publishing identity unavailable");
    console.log(
      JSON.stringify({
        status: "ready",
        designComposer: "0.9.4",
        npm: true,
        registryDispatch: true,
      }),
    );
  } else {
    assert(
      bundle && /^\d+$/.test(ciRun ?? ""),
      "publish requires retained bundle and successful CI run",
    );
    const result = spawnSync(process.execPath, ["scripts/release.mjs", "publish", bundle, ciRun], {
      cwd: root,
      env: environment,
      stdio: "inherit",
    });
    process.exitCode = result.status ?? 1;
  }
} catch (error) {
  // Never include input JSON, command output, headers or environment values.
  console.error(
    JSON.stringify({
      status: "incomplete",
      handoff: false,
      error:
        error instanceof assert.AssertionError
          ? error.message
          : "approved release transport failed",
    }),
  );
  process.exitCode = 1;
} finally {
  if (directory) rmSync(directory, { recursive: true, force: true });
}
