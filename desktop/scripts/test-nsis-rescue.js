// SPDX-License-Identifier: Apache-2.0
"use strict";

// Tests for nsis/legacy-data-rescue.nsh (2026-10-14, 1.0.0 upgrade data-preservation fix).
//
// Why this exists: the published 0.18.0 installer wrote user data inside the install
// payload, and an NSIS in-place upgrade runs the OLD uninstaller first -- which moves
// the whole install directory away and deletes it. Without the rescue hook the user's
// database/attachments/backups are destroyed before the new shell can migrate them.
//
// The .nsh itself is only compiled during packaging (CI's desktop-shell job builds the
// installer right after running this suite, so a syntax error still fails the build).
// These checks pin the properties a refactor could silently drop:
//   1. electron-builder.yml actually includes the file (an un-referenced .nsh is dead code);
//   2. the file carries a UTF-8 BOM (Unicode NSIS reads BOM-less files in the system
//      codepage, which would garble the Chinese user-facing message boxes);
//   3. the whole file is wrapped in !ifndef BUILD_UNINSTALLER (electron-builder compiles
//      custom includes into the uninstaller build too, where non-`un.` Functions are
//      invalid);
//   4. both customInit and customInstall macros are defined (electron-builder's hooks);
//   5. the failure paths are fail-closed: abort on a running app, abort on copy/verify
//      failure, never overwrite an existing database at the destination.

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");

const DESKTOP = path.join(__dirname, "..");
const RESCUE = path.join(DESKTOP, "nsis", "legacy-data-rescue.nsh");
const YAML = path.join(DESKTOP, "electron-builder.yml");

function readRescue() {
  return fs.readFileSync(RESCUE, "utf8");
}

test("electron-builder.yml includes the rescue script", () => {
  const yaml = fs.readFileSync(YAML, "utf8");
  const match = /^\s*include:\s*(\S+)\s*$/m.exec(yaml);
  assert.ok(match, "electron-builder.yml must declare nsis.include");
  const target = path.join(DESKTOP, match[1]);
  assert.strictEqual(target, RESCUE, `nsis.include should point at ${RESCUE}`);
  assert.ok(fs.existsSync(RESCUE), "the include file must exist on disk");
});

test("the rescue script starts with a UTF-8 BOM", () => {
  const bytes = fs.readFileSync(RESCUE);
  assert.deepStrictEqual(
    [...bytes.subarray(0, 3)],
    [0xef, 0xbb, 0xbf],
    "Unicode NSIS reads BOM-less sources in the ANSI codepage; Chinese messages would be garbled",
  );
});

test("the rescue script compiles into the installer only", () => {
  const source = readRescue();
  const guards = source.match(/!ifndef\s+BUILD_UNINSTALLER/g) || [];
  assert.strictEqual(guards.length, 1, "exactly one BUILD_UNINSTALLER guard");
  const lastLine = source.trimEnd().split("\n").pop().trim();
  assert.strictEqual(
    lastLine,
    "!endif",
    "the BUILD_UNINSTALLER guard must stay open for the whole file and close at the end",
  );
});

test("both electron-builder hooks are defined", () => {
  const source = readRescue();
  assert.match(source, /^!macro customInit$/m, "customInit runs before the old uninstaller");
  assert.match(source, /^!macro customInstall$/m, "customInstall restores the data afterwards");
});

test("the rescue is keyed on resume_forge.db and never overwrites an existing database", () => {
  const source = readRescue();
  assert.match(source, /resume_forge\.db/, "the migration criterion is the database file");
  // Destination guard: restore only when the target does not already hold a database.
  assert.match(
    source,
    /IfFileExists\s+"\$INSTDIR\\\$\{RF_LEGACY_RELATIVE\}\\resume_forge\.db"\s+rf_restore_done\s+0/,
    "customInstall must skip the copy when the new payload already has a database",
  );
  // Already-migrated guard: the app writes migrated-away.json into the legacy dir
  // after a successful migration (desktop/lib/data-migration.js), and the hook must
  // decide from install-directory files alone -- never by guessing the app's user
  // data path (%APPDATA% can hold another install's database, and the shell
  // supports --user-data-dir; the 2026-10-14 drill skipped a rescue exactly that way).
  assert.match(
    source,
    /IfFileExists\s+"\$RFOldDataDir\\migrated-away\.json"/,
    "customInit must skip the rescue only on the app-written archival marker",
  );
  // ($APPDATA is still allowed as a last-resort *write* target when the restore
  // fails; what the hook must never do is READ a user-profile database to decide.)
  assert.doesNotMatch(
    source,
    /\$APPDATA[^\n]*resume_forge\.db/,
    "the skip decision must not read a user-profile database path",
  );
});

test("the rescue fails closed on a running app and on copy failure", () => {
  const source = readRescue();
  // Running app: wait, then abort with an explanation instead of copying a live database.
  assert.match(source, /\$\{nsProcess::FindProcess\}/, "must check whether the app is running");
  const aborts = source.match(/\bAbort\b/g) || [];
  assert.strictEqual(aborts.length, 2, "exactly two abort paths: app running, rescue copy failed");
  assert.match(
    source,
    /MessageBox[^\n]*(原样保留|保持原样)/,
    "the abort message must promise the old data is untouched",
  );
  // Byte-for-byte verification while copying is what makes the abort meaningful.
  assert.match(source, /StrCmp\s+\$R6\s+\$R7/, "copy verification compares source and destination sizes");
});

test("the recursive copy detects directories without IfFileExists", () => {
  const source = readRescue();
  // An empty directory (data/exports is one in practice) is "not found" by
  // IfFileExists "<dir>\*.*", so the copy would try to FileOpen it and abort the
  // whole rescue. Directory detection must go through FindFirst (a directory
  // yields "." first even when empty) -- the 2026-10-14 drill caught this.
  assert.match(
    source,
    /FindFirst\s+\$R5\s+\$R6\s+"\$R1\\\$R4\\\*\.\*"\s*\n\s*StrCmp\s+\$R6\s+""\s+rf_copy_file/,
    "directory detection must use FindFirst, not IfFileExists",
  );
  assert.doesNotMatch(
    source,
    /IfFileExists\s+"\$R1\\\$R4\\\*\.\*"/,
    "the empty-directory trap must not come back",
  );
  // Path building must never produce a doubled separator ("...\data\\user_files\x"):
  // CopyFiles sets the error flag on such paths, and the root level (where the
  // shape happens to differ) still succeeds -- a combination that cost a full
  // drill cycle to localise. The root case must therefore be branched explicitly.
  assert.match(
    source,
    /StrCmp\s+\$R9\s+""\s+0\s+rf_paths_nested/,
    "the relative-path prefix must be branched so no doubled separator is built",
  );
});
