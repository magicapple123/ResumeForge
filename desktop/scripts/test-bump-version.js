// SPDX-License-Identifier: Apache-2.0
"use strict";

// Self-check for scripts/bump_version.py (audit PR-05, 2026-10-13).
//
// The desktop shell has its own version sources (desktop/package.json and its
// lockfile); a bump that misses them leaves the shipped shell reporting an old
// version and the updater comparing against the wrong number. This test runs
// the real bump script against a minimal fixture repo (RF_BUMP_REPO_ROOT) and
// asserts the desktop version moved in lockstep with the rest.
//
// Safety: the fixture is only used when bump_version.py supports
// RF_BUMP_REPO_ROOT. If it does not (pre-PR-05 script), the test fails
// WITHOUT executing anything -- so running it red can never mutate the real
// repository's version files.

const assert = require("assert");
const { execFileSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");

const REPO_ROOT = path.join(__dirname, "..", "..");
const BUMP_SCRIPT = path.join(REPO_ROOT, "scripts", "bump_version.py");
const CURRENT_VERSION = JSON.parse(
  fs.readFileSync(path.join(REPO_ROOT, "frontend", "package.json"), "utf-8"),
).version;

function nextPatchVersion(version) {
  const parts = version.split(".").map(Number);
  return [parts[0], parts[1], parts[2] + 1].join(".");
}

function pythonExecutable() {
  const venvPython = path.join(REPO_ROOT, "backend", ".venv", "Scripts", "python.exe");
  if (fs.existsSync(venvPython)) return venvPython;
  return "python";
}

function readJson(file) {
  return JSON.parse(fs.readFileSync(file, "utf-8"));
}

function buildFixtureRepo(root) {
  const old = "0.18.0";
  const write = (rel, content) => {
    fs.mkdirSync(path.dirname(path.join(root, rel)), { recursive: true });
    fs.writeFileSync(path.join(root, rel), content);
  };

  write(
    "backend/app/config.py",
    `from pydantic import Field\n\nclass Settings:\n    app_version: str = "${old}"\n`,
  );
  write("frontend/package.json", JSON.stringify({ name: "rf", version: old }, null, 2) + "\n");
  write(
    "frontend/package-lock.json",
    JSON.stringify({ name: "rf", version: old, packages: { "": { version: old } } }, null, 2) + "\n",
  );
  write("desktop/package.json", JSON.stringify({ name: "resumeforge-desktop", version: old }, null, 2) + "\n");
  write(
    "desktop/package-lock.json",
    JSON.stringify({ name: "resumeforge-desktop", version: old, packages: { "": { version: old } } }, null, 2) + "\n",
  );
  write("README.md", "# ResumeForge\n\n当前版本：`0.18.0`\n");
  write("CHANGELOG.md", "# 变更记录\n\n## Unreleased\n\n### Fixed\n\n- test entry\n");

  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "fixture"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "fix: fixture baseline"], { cwd: root });
}

test("bump_version keeps desktop/package.json and its lockfile in lockstep", () => {
  const script = fs.readFileSync(BUMP_SCRIPT, "utf-8");
  assert.ok(
    script.includes("RF_BUMP_REPO_ROOT"),
    "bump_version.py does not support RF_BUMP_REPO_ROOT yet -- refusing to run " +
      "so the real repository's version files are never touched by this test",
  );

  const root = fs.mkdtempSync(path.join(os.tmpdir(), "rf-bump-fixture-"));
  try {
    buildFixtureRepo(root);
    const expected = nextPatchVersion("0.18.0");

    execFileSync(
      pythonExecutable(),
      [BUMP_SCRIPT, "--bump", "patch"],
      { cwd: REPO_ROOT, env: { ...process.env, RF_BUMP_REPO_ROOT: root }, encoding: "utf-8" },
    );

    const desktop = readJson(path.join(root, "desktop", "package.json"));
    const desktopLock = readJson(path.join(root, "desktop", "package-lock.json"));
    const frontend = readJson(path.join(root, "frontend", "package.json"));
    const frontendLock = readJson(path.join(root, "frontend", "package-lock.json"));
    const config = fs.readFileSync(path.join(root, "backend", "app", "config.py"), "utf-8");
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf-8");

    assert.strictEqual(desktop.version, expected,
      "desktop/package.json must be bumped in lockstep");
    assert.strictEqual(desktopLock.version, expected,
      "desktop/package-lock.json root version must be bumped in lockstep");
    assert.strictEqual(desktopLock.packages[""].version, expected,
      "desktop/package-lock.json packages[''] version must be bumped in lockstep");
    assert.strictEqual(frontend.version, expected);
    assert.strictEqual(frontendLock.version, expected);
    assert.ok(config.includes(`app_version: str = "${expected}"`));
    assert.ok(readme.includes(`当前版本：\`${expected}\``));

    // Cross-file consistency self-check: the desktop version (what the
    // packaged shell / payload reports as app.getVersion) must equal the
    // release version everywhere else.
    assert.strictEqual(
      new Set([desktop.version, desktopLock.version, frontend.version, frontendLock.version]).size,
      1,
      "all package manifests must agree after the bump",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the real repository's desktop version matches its lockfile (invariant)", () => {
  const pkg = readJson(path.join(REPO_ROOT, "desktop", "package.json"));
  const lock = readJson(path.join(REPO_ROOT, "desktop", "package-lock.json"));
  assert.strictEqual(lock.version, pkg.version,
    "desktop/package-lock.json root version must match desktop/package.json");
  assert.strictEqual(lock.packages[""].version, pkg.version,
    "desktop/package-lock.json packages[''] version must match desktop/package.json");
  assert.strictEqual(pkg.version, CURRENT_VERSION,
    "desktop version must match the frontend release version");
});
