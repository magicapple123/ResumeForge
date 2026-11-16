// SPDX-License-Identifier: Apache-2.0
"use strict";

// Self-check for scripts/bump_version.py (audit PR-05, 2026-10-13).
//
// The desktop shell has its own version source (desktop/package.json); a bump
// that misses it leaves the shipped shell reporting an old version and the
// updater comparing against the wrong number. This test runs the real bump
// script against a minimal fixture repo (RF_BUMP_REPO_ROOT) and asserts the
// desktop version moved in lockstep with the rest.
//
// Lockfiles are deliberately NOT part of the fixture. After the pnpm migration
// the dependency truth lives in `pnpm-lock.yaml`, whose importers section does
// not record the root package version at all -- the npm-era sync points
// (`lock.version`, `lock.packages[""].version`) no longer exist, so
// bump_version.py no longer writes any lockfile. Lockfile freshness is guarded
// by `pnpm install --frozen-lockfile` in CI instead.
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
  write("desktop/package.json", JSON.stringify({ name: "resumeforge-desktop", version: old }, null, 2) + "\n");
  write("README.md", "# ResumeForge\n\nVersion: `0.18.0`\n");
  write("README.zh-CN.md", "# 简历通 ResumeForge\n\n当前版本：`0.18.0`\n");
  write("CHANGELOG.md", "# 变更记录\n\n## Unreleased\n\n### Fixed\n\n- test entry\n");

  execFileSync("git", ["init", "-q"], { cwd: root });
  execFileSync("git", ["config", "user.email", "fixture@example.invalid"], { cwd: root });
  execFileSync("git", ["config", "user.name", "fixture"], { cwd: root });
  execFileSync("git", ["add", "-A"], { cwd: root });
  execFileSync("git", ["commit", "-q", "-m", "fix: fixture baseline"], { cwd: root });
}

test("bump_version keeps desktop/package.json in lockstep with the other version sources", () => {
  const script = fs.readFileSync(BUMP_SCRIPT, "utf-8");
  assert.ok(
    script.includes("RF_BUMP_REPO_ROOT"),
    "bump_version.py does not support RF_BUMP_REPO_ROOT yet -- refusing to run " +
      "so the real repository's version files are never touched by this test",
  );
  assert.ok(
    !script.includes("package-lock"),
    "bump_version.py must not reference package-lock.json any more (pnpm migration)",
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
    const frontend = readJson(path.join(root, "frontend", "package.json"));
    const config = fs.readFileSync(path.join(root, "backend", "app", "config.py"), "utf-8");
    const readme = fs.readFileSync(path.join(root, "README.md"), "utf-8");
    const readmeZh = fs.readFileSync(path.join(root, "README.zh-CN.md"), "utf-8");

    assert.strictEqual(desktop.version, expected,
      "desktop/package.json must be bumped in lockstep");
    assert.strictEqual(frontend.version, expected);
    assert.ok(config.includes(`app_version: str = "${expected}"`));
    assert.ok(readme.includes(`Version: \`${expected}\``));
    assert.ok(readmeZh.includes(`当前版本：\`${expected}\``),
      "README.zh-CN.md must be bumped together with the English README");

    // The bump must not fabricate any lockfile: the pnpm lockfile carries no
    // root version, so a bumped lockfile would be a regression to npm thinking.
    for (const stale of ["frontend/package-lock.json", "desktop/package-lock.json"]) {
      assert.ok(!fs.existsSync(path.join(root, stale)),
        `bump_version.py must not create ${stale}`);
    }

    // Cross-file consistency self-check: the desktop version (what the
    // packaged shell / payload reports as app.getVersion) must equal the
    // release version everywhere else.
    assert.strictEqual(
      new Set([desktop.version, frontend.version]).size,
      1,
      "all package manifests must agree after the bump",
    );
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("the real repository's desktop version matches the release version (invariant)", () => {
  const pkg = readJson(path.join(REPO_ROOT, "desktop", "package.json"));
  assert.strictEqual(pkg.version, CURRENT_VERSION,
    "desktop version must match the frontend release version");
  assert.ok(
    fs.existsSync(path.join(REPO_ROOT, "desktop", "pnpm-lock.yaml")),
    "desktop dependency truth must live in pnpm-lock.yaml",
  );
  assert.ok(
    !fs.existsSync(path.join(REPO_ROOT, "desktop", "package-lock.json")),
    "desktop/package-lock.json must stay deleted after the pnpm migration",
  );
});
