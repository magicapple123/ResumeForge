"use strict";

// R11: the double-click update entry shipped at the install root.
//
// Why this exists: `update.cmd` / `update.command` are *generated* during packaging
// (the repo-root files update a source checkout via git, which does not exist in an
// installed app). Nothing in the normal unit suite exercises electron-builder, so a
// refactor could drop the generation step or the extraFiles wiring and the only
// symptom would be "the file is missing after install" -- discovered by a user.
//
// These checks pin the four pieces that must all be present:
//   1. main.js understands --check-update and forwards it from a second instance;
//   2. the Windows build writes payload/update.cmd (ASCII, CRLF, no BOM);
//   3. the macOS build writes payload/update.command and marks it executable;
//   4. electron-builder copies both to the app root (not into resources/payload).

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const DESKTOP = path.join(__dirname, "..");
const ROOT = path.join(DESKTOP, "..");

function read(file) {
  return fs.readFileSync(path.join(ROOT, file), "utf8");
}

test("the updater owns --check-update and main.js routes both launch paths", () => {
  const main = read("desktop/main.js");
  const updater = read("desktop/updater.js");

  assert.match(updater, /CHECK_UPDATE_FLAG\s*=\s*"--check-update"/);
  assert.match(updater, /function runManualUpdateCheck\(/);
  // "Already up to date" needs a visible answer on a manual check.
  assert.match(updater, /onUpToDate/);
  // Both launch paths must call it: a second instance (flag forwarded in argv)
  // and a fresh launch (flag in this process's argv).
  assert.match(main, /wantsManualUpdateCheck\(argv\)\) runManualUpdateCheck\(/);
  assert.match(main, /if \(wantsManualUpdateCheck\(\)\) runManualUpdateCheck\(/);
});

test("the Windows build writes an ASCII/CRLF update.cmd into the payload", () => {
  const build = read("scripts/Build-Desktop.ps1");

  assert.match(build, /payloadDir "update\.cmd"/);
  // ASCII + explicit CRLF: cmd.exe must never see a BOM, and LF-only batch files
  // break labels/`start` parsing on some Windows versions.
  assert.match(build, /System\.Text\.Encoding\]::ASCII/);
  assert.match(build, /`r`n/);
  assert.match(build, /ResumeForge\.exe" --check-update/);
});

test("the macOS build writes an executable update.command into the payload", () => {
  const build = read("scripts/build-desktop-mac.sh");

  assert.match(build, /PAYLOAD_DIR\/update\.command/);
  assert.match(build, /chmod \+x "\$PAYLOAD_DIR\/update\.command"/);
  // Never claim an automatic update on macOS (there is no NSIS installer protocol).
  assert.match(build, /releases\/latest/);
});

test("electron-builder copies both entries to the install root", () => {
  const yaml = read("desktop/electron-builder.yml");
  const extraFiles = /extraFiles:\s*\n([\s\S]*?)\n\w/.exec(yaml);
  assert.ok(extraFiles, "electron-builder.yml must declare extraFiles");
  const block = extraFiles[1];

  assert.match(block, /from: payload/);
  assert.match(block, /to: \./);
  assert.match(block, /update\.cmd/);
  assert.match(block, /update\.command/);
});
