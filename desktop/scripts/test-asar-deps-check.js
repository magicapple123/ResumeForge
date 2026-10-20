// SPDX-License-Identifier: Apache-2.0
"use strict";

// Tests for scripts/check-asar-deps.js (audit PR-04, 2026-10-13).
//
// No test framework dependency: node:test ships with Node 18+ and the repo's
// desktop toolchain is Node 22. Run with:
//   node scripts/test-asar-deps-check.js
//   (or: node --test scripts/)
//
// Coverage:
//   1. Source mode against the real desktop/ directory: every local module in
//      main.js's recursive require graph must be covered by the
//      electron-builder.yml files manifest. This is the regression gate for
//      the updater.js packaging bug -- it failed before the manifest fix and
//      passes after.
//   2. Plain-directory fixtures with a missing local require -> exit 1 and
//      the missing module is named.
//   3. Complete fixtures -> exit 0, including a nested (lib/ + shared/)
//      require graph to prove recursion and subdirectory resolution.
//   4. Real app.asar fixtures (built with @electron/asar, already present as
//      a transitive dependency of electron-builder): missing module -> exit 1;
//      complete archive -> exit 0.
//   5. Unpacked-dir auto-detection: a win-unpacked layout (dir/resources/
//      app.asar) is routed to archive checking; a plain app-root dir falls
//      back to filesystem checking.

const assert = require("assert");
const { spawnSync } = require("child_process");
const fs = require("fs");
const os = require("os");
const path = require("path");
const { test } = require("node:test");

const SCRIPT = path.join(__dirname, "check-asar-deps.js");
const REPO_DESKTOP = path.join(__dirname, "..");

function runCheck(args) {
  const result = spawnSync(process.execPath, [SCRIPT, ...args], {
    encoding: "utf-8",
    timeout: 60_000,
  });
  return {
    code: result.status === null ? -1 : result.status,
    stdout: result.stdout || "",
    stderr: result.stderr || "",
  };
}

function makeTempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `asar-deps-${label}-`));
}

// Minimal app-root fixture mirroring the real shell's require shape:
// main.js -> ./backend-manager, ./updater.
function writeShellFixture(root, { withUpdater }) {
  fs.writeFileSync(
    path.join(root, "main.js"),
    'const { app } = require("electron");\n' +
      'const { BackendManager } = require("./backend-manager");\n' +
      'const { scheduleUpdateCheck } = require("./updater");\n' +
      "app.whenReady();\n",
  );
  fs.writeFileSync(
    path.join(root, "backend-manager.js"),
    'const fs = require("fs");\nmodule.exports = { BackendManager: fs.constants };\n',
  );
  if (withUpdater) {
    fs.writeFileSync(
      path.join(root, "updater.js"),
      'const crypto = require("crypto");\nmodule.exports = { scheduleUpdateCheck: crypto.randomBytes };\n',
    );
  }
  fs.writeFileSync(path.join(root, "package.json"), '{"name":"fixture","main":"main.js"}\n');
}

// Nested fixture: main -> ./lib/logger -> ../shared/version, proving the
// walk follows requires into subdirectories in both directions.
function writeNestedFixture(root) {
  fs.mkdirSync(path.join(root, "lib"));
  fs.mkdirSync(path.join(root, "shared"));
  fs.writeFileSync(
    path.join(root, "main.js"),
    'const { version } = require("./lib/logger");\nmodule.exports = version;\n',
  );
  fs.writeFileSync(
    path.join(root, "lib", "logger.js"),
    'module.exports = { version: require("../shared/version") };\n',
  );
  fs.writeFileSync(path.join(root, "shared", "version.js"), "module.exports = '0.18.0';\n");
}

function buildAsar(srcDir, destFile) {
  // @electron/asar is a transitive dependency of electron-builder (no new
  // npm dependency is introduced by using it in tests).
  const asar = require("@electron/asar");
  return asar.createPackage(srcDir, destFile).then(() => destFile);
}

// --- 1. Real repo: source-mode regression gate -------------------------------

test("source mode: desktop require graph fully covered by builder manifest", () => {
  const result = runCheck(["--source", REPO_DESKTOP]);
  assert.strictEqual(
    result.code,
    0,
    `expected exit 0\nstdout:\n${result.stdout}\nstderr:\n${result.stderr}`,
  );
  assert.ok(result.stdout.includes("updater.js"), "updater.js should appear in verified modules");
});

// --- 2. Plain-directory fixtures ---------------------------------------------

test("directory mode: missing local require fails with module named", () => {
  const root = makeTempRoot("missing");
  try {
    writeShellFixture(root, { withUpdater: false });
    const result = runCheck(["--unpacked", root]);
    assert.strictEqual(result.code, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    // updater.js is absent on disk, so the require is reported as
    // unresolvable and the message names the specifier "./updater".
    assert.ok(result.stderr.includes('"./updater"'), `stderr should name ./updater:\n${result.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("directory mode: complete fixture passes", () => {
  const root = makeTempRoot("complete");
  try {
    writeShellFixture(root, { withUpdater: true });
    const result = runCheck(["--unpacked", root]);
    assert.strictEqual(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.ok(result.stdout.includes("updater.js"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("directory mode: nested require graph resolves across subdirectories", () => {
  const root = makeTempRoot("nested");
  try {
    writeNestedFixture(root);
    const result = runCheck(["--unpacked", root]);
    assert.strictEqual(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.ok(result.stdout.includes("lib/logger.js"));
    assert.ok(result.stdout.includes("shared/version.js"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("directory mode: missing entry module is an error", () => {
  const root = makeTempRoot("noentry");
  try {
    const result = runCheck(["--unpacked", root]);
    assert.strictEqual(result.code, 1);
    assert.ok(result.stderr.includes("main.js"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 3. Archive fixtures ------------------------------------------------------

test("asar mode: archive missing a required module fails and names it", async () => {
  const root = makeTempRoot("asar-missing");
  try {
    writeShellFixture(root, { withUpdater: false });
    const archive = await buildAsar(root, path.join(root, "..", `asar-missing-${Date.now()}.asar`));
    const result = runCheck(["--asar", archive]);
    assert.strictEqual(result.code, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.ok(result.stderr.includes('"./updater"'), `stderr should name ./updater:\n${result.stderr}`);
    fs.rmSync(archive, { force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("asar mode: complete archive passes", async () => {
  const root = makeTempRoot("asar-complete");
  try {
    writeShellFixture(root, { withUpdater: true });
    const archive = await buildAsar(root, path.join(root, "..", `asar-complete-${Date.now()}.asar`));
    const result = runCheck(["--asar", archive]);
    assert.strictEqual(result.code, 0, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.ok(result.stdout.includes("updater.js"));
    fs.rmSync(archive, { force: true });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 4. win-unpacked auto-detection -------------------------------------------

test("unpacked mode: win-unpacked layout routes to archive checking", async () => {
  const root = makeTempRoot("unpacked-layout");
  try {
    const appRoot = path.join(root, "resources");
    fs.mkdirSync(appRoot);
    writeShellFixture(appRoot, { withUpdater: false });
    const archive = await buildAsar(appRoot, path.join(appRoot, "app.asar"));
    const result = runCheck(["--unpacked", root]);
    assert.strictEqual(result.code, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.ok(result.stderr.includes(archive) || result.stderr.includes("updater.js"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 5. Source mode against fixtures with a builder manifest ------------------

test("source mode: manifest omission is caught statically", () => {
  const root = makeTempRoot("src-manifest");
  try {
    writeShellFixture(root, { withUpdater: false });
    fs.writeFileSync(
      path.join(root, "electron-builder.yml"),
      "files:\n  - main.js\n  - backend-manager.js\n  - package.json\n",
    );
    const result = runCheck(["--source", root]);
    assert.strictEqual(result.code, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.ok(result.stderr.includes('"./updater"'), `stderr should name ./updater:\n${result.stderr}`);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("source mode: stale manifest entry (listed file missing on disk) fails", () => {
  const root = makeTempRoot("src-stale");
  try {
    writeShellFixture(root, { withUpdater: true });
    fs.writeFileSync(
      path.join(root, "electron-builder.yml"),
      "files:\n  - main.js\n  - backend-manager.js\n  - updater.js\n  - ghost.js\n  - package.json\n",
    );
    const result = runCheck(["--source", root]);
    assert.strictEqual(result.code, 1, `stdout:\n${result.stdout}\nstderr:\n${result.stderr}`);
    assert.ok(result.stderr.includes("ghost.js"));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("usage errors exit with code 2", () => {
  const bogus = runCheck(["--asar", path.join(os.tmpdir(), `no-such-${Date.now()}.asar`)]);
  assert.strictEqual(bogus.code, 2);
  const unknown = runCheck(["--frobnicate"]);
  assert.strictEqual(unknown.code, 2);
});
