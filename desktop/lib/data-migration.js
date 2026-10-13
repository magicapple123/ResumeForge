"use strict";

// ADR-0004 legacy-data migration (the item the ADR explicitly deferred).
//
// Installs shipped before the RF_DATA_DIR policy wrote the database,
// attachments and datasets under the old config.py default, i.e. inside the
// install payload (resources/payload/backend/data). This module moves that
// data to the user data directory on first launch of the fixed shell, with
// the safety rails the ADR mandates:
//
//   detect -> explicit confirm -> backup -> temp-dir copy -> verify -> rename
//
// Failure paths never leave data "half in both places": the copy lands under
// a temp sibling name and is only renamed into place after a full per-file
// verification (file set, byte sizes, SHA-256); any failure removes the temp
// dir, keeps the backup and the untouched legacy copy, and the backend then
// starts against the legacy location (no RF_DATA_DIR injected). The legacy
// copy is NEVER deleted or modified -- the backup is an extra copy, not a
// replacement (ADR: cleanup is left to a future major version).
//
// Electron is deliberately not required here: main.js injects the confirm /
// error dialogs as plain async functions, so the whole state machine runs
// under node --test without any Electron involvement.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");

// The database filename config.py derives DEFAULT_DATABASE_URL from; its
// presence is the "this directory holds real data" criterion on both sides.
const DATABASE_FILENAME = "resume_forge.db";
// Success marker written INSIDE the new data dir: survives payload
// replacement on update (a marker in the payload would be wiped by the next
// installer run, re-prompting already-migrated users).
const MARKER_FILENAME = "migrated.json";
// Backup sibling of the legacy data dir: <oldDataDir>.pre-migration-<ts>
const BACKUP_INFIX = ".pre-migration-";
// Temp copy sibling of the new data dir: <newDataDir>.migrating-<ts>
const TEMP_INFIX = ".migrating-";

function databasePath(dataDir) {
  return path.join(dataDir, DATABASE_FILENAME);
}

function markerPath(dataDir) {
  return path.join(dataDir, MARKER_FILENAME);
}

// ISO timestamps contain ':' which is illegal in Windows file names.
function timestampSlug(iso) {
  return iso.replace(/[:.]/g, "-");
}

// --- detection ----------------------------------------------------------------

// Order matters: the marker wins first (idempotency -- never re-migrate nor
// re-prompt after a successful migration), then "nothing to migrate", then
// "already migrated without a marker" (e.g. a manual copy), and only then do
// we need the user's confirmation. A declined migration writes NO marker, so
// the next launch prompts again (ADR: not silently).
function detectMigrationState(oldDataDir, newDataDir) {
  if (fs.existsSync(markerPath(newDataDir))) {
    return { status: "skip", reason: "already-migrated" };
  }
  if (!fs.existsSync(databasePath(oldDataDir))) {
    return { status: "skip", reason: "no-legacy-data" };
  }
  if (fs.existsSync(databasePath(newDataDir))) {
    return { status: "skip", reason: "new-data-exists" };
  }
  return { status: "needs-migration", reason: null };
}

// --- copy + verify --------------------------------------------------------------

// Recursive copy of regular files only. Symlinks/junctions are deliberately
// NOT followed (a link inside the data dir must never pull outside content
// into the migration); verification fails the migration on the resulting
// file-set mismatch instead of silently copying a link target.
function copyTree(srcDir, destDir, copyFileFn) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to, copyFileFn);
    } else if (entry.isFile()) {
      copyFileFn(from, to);
    }
  }
}

function sha256File(filePath) {
  return new Promise((resolve, reject) => {
    const hash = crypto.createHash("sha256");
    const stream = fs.createReadStream(filePath);
    stream.on("data", (chunk) => hash.update(chunk));
    stream.on("error", reject);
    stream.on("end", () => resolve(hash.digest("hex")));
  });
}

// Relative-path -> {size, sha256} inventory of every regular file.
async function inventory(rootDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(full);
    }
  };
  walk(rootDir);
  const map = new Map();
  for (const full of files) {
    const rel = path.relative(rootDir, full);
    const { size } = fs.statSync(full);
    map.set(rel, { size, sha256: await sha256File(full) });
  }
  return map;
}

// Full three-way comparison (file set, sizes, content hashes). All-or-nothing
// by design: any single difference fails the whole migration.
async function verifyTree(sourceDir, copiedDir) {
  const source = await inventory(sourceDir);
  const copied = await inventory(copiedDir);
  const problems = [];
  for (const [rel, info] of source) {
    const other = copied.get(rel);
    if (!other) {
      problems.push(`missing after copy: ${rel}`);
    } else if (other.size !== info.size || other.sha256 !== info.sha256) {
      problems.push(`content mismatch after copy: ${rel}`);
    }
  }
  for (const rel of copied.keys()) {
    if (!source.has(rel)) problems.push(`unexpected extra file after copy: ${rel}`);
  }
  if (problems.length > 0) {
    throw new Error(`migration verification failed (${problems.length}): ${problems[0]}`);
  }
}

// --- the migration itself -------------------------------------------------------

async function performMigration({ oldDataDir, newDataDir, nowIso, copyFileFn = fs.copyFileSync }) {
  const slug = timestampSlug(nowIso);
  const backupDir = `${oldDataDir}${BACKUP_INFIX}${slug}`;
  const tempDir = `${newDataDir}${TEMP_INFIX}${slug}`;

  fs.mkdirSync(path.dirname(newDataDir), { recursive: true });
  // A leftover temp dir can only come from a previous crashed run of this
  // same routine (it never holds anything else): remove it before copying.
  fs.rmSync(tempDir, { recursive: true, force: true });

  // 1. Backup first -- a full copy next to the legacy dir, kept even when
  //    later steps fail (it is a safety artifact, never cleaned here).
  copyTree(oldDataDir, backupDir, copyFileFn);
  try {
    // 2. Copy under a temp name; 3. verify; 4. only then publish by rename.
    //    The temp dir is a sibling of the target, so the rename never crosses
    //    a filesystem boundary.
    copyTree(oldDataDir, tempDir, copyFileFn);
    await verifyTree(oldDataDir, tempDir);
    if (fs.existsSync(newDataDir)) {
      if (fs.readdirSync(newDataDir).length > 0) {
        throw new Error(`target data dir exists and is not empty: ${newDataDir}`);
      }
      fs.rmdirSync(newDataDir); // empty placeholder (e.g. created by Electron)
    }
    fs.renameSync(tempDir, newDataDir);
  } catch (err) {
    // Rollback: remove the half product; backup + legacy copy stay as-is.
    try {
      fs.rmSync(tempDir, { recursive: true, force: true });
    } catch {}
    throw err;
  }

  // 5. Marker inside the published dir (see MARKER_FILENAME note above).
  fs.writeFileSync(
    markerPath(newDataDir),
    `${JSON.stringify(
      { migratedAt: nowIso, from: oldDataDir, to: newDataDir, backup: backupDir },
      null,
      2,
    )}\n`,
  );
  return { backupDir };
}

// --- orchestration (Electron injected, never required) ---------------------------

// Resolves which data directory the backend should run against, running the
// ADR-0004 state machine around it:
//   { outcome: "migrated" | "declined" | "failed" | <skip reason>,
//     userDataDir: string | null }
// null means "run the backend against the legacy location this launch" --
// the caller simply omits RF_DATA_DIR and behavior is byte-identical to the
// pre-ADR builds.
async function maybeMigrateUserData({
  oldDataDir,
  newDataDir,
  showConfirm,
  showError,
  now = () => new Date().toISOString(),
  log = () => {},
  copyFileFn,
}) {
  const state = detectMigrationState(oldDataDir, newDataDir);
  if (state.status === "skip") {
    log(`data migration: skip (${state.reason})`);
    return { outcome: state.reason, userDataDir: newDataDir };
  }

  // Explicit confirmation (ADR hard requirement). A crashing dialog must not
  // take the launch down: treat it as a decline and keep the legacy setup.
  let confirmed = false;
  try {
    confirmed = await showConfirm({ from: oldDataDir, to: newDataDir });
  } catch (err) {
    log(`data migration: confirm dialog failed (${err}); keeping legacy location`);
  }
  if (!confirmed) {
    log("data migration: user declined; backend keeps the legacy data location");
    return { outcome: "declined", userDataDir: null };
  }

  const nowIso = now();
  log(`data migration: migrating ${oldDataDir} -> ${newDataDir}`);
  try {
    const { backupDir } = await performMigration({ oldDataDir, newDataDir, nowIso, copyFileFn });
    log(`data migration: done (legacy copy and backup kept: ${backupDir})`);
    return { outcome: "migrated", userDataDir: newDataDir };
  } catch (err) {
    const message = err && err.message ? err.message : String(err);
    log(`data migration: FAILED (${message}); legacy data untouched`);
    try {
      await showError(
        "简历通",
        "数据迁移失败，本次仍按旧的数据位置启动，旧数据完好无损，可下次启动时重试。\n\n" +
          `原因：${message}`,
      );
    } catch {}
    return { outcome: "failed", userDataDir: null };
  }
}

module.exports = {
  DATABASE_FILENAME,
  MARKER_FILENAME,
  detectMigrationState,
  performMigration,
  maybeMigrateUserData,
};
