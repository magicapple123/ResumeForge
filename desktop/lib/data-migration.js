"use strict";

// ADR-0004 legacy-data migration (the item the ADR explicitly deferred).
//
// Installs shipped before the RF_DATA_DIR policy wrote the database,
// attachments and datasets under the old config.py default, i.e. inside the
// install payload (resources/payload/backend/data). This module moves that
// data to the user data directory on first launch of the fixed shell, with
// the safety rails the ADR mandates:
//
//   detect -> explicit confirm -> backup -> temp-dir snapshot -> verify -> rename
//
// Failure paths never leave data "half in both places": the copy lands under
// a temp sibling name (carrying a provenance marker, so a same-named directory
// this process did not create is never deleted) and is only renamed into place
// after a full per-file verification (file set, byte sizes, SHA-256; databases
// are verified by opening the snapshot instead). Any failure removes the temp
// dir, keeps the backup and the untouched legacy copy, and the backend then
// starts against the legacy location (no RF_DATA_DIR injected). The legacy
// copy is NEVER deleted or modified -- the backup is an extra copy, not a
// replacement (ADR: cleanup is left to a future major version).
//
// RR-06 hardening (see CHANGELOG): the backup lives under the user-writable
// data tree (not next to a possibly read-only install), databases are copied
// through a consistent SQLite snapshot (WAL frames included, sidecars never
// replayed), and a "migrated" marker whose database is gone fails closed
// instead of letting the app recreate an empty database.
//
// Electron is deliberately not required here: main.js injects the confirm /
// error dialogs as plain async functions, so the whole state machine runs
// under node --test without any Electron involvement.

const fs = require("fs");
const path = require("path");
const crypto = require("crypto");
const {
  defaultSqlite,
  findDatabaseFiles,
  looksLikeSqlite,
  quickCheck,
  snapshotDatabase,
} = require("./sqlite-snapshot");

// The database filename config.py derives DEFAULT_DATABASE_URL from; its
// presence is the "this directory holds real data" criterion on both sides.
const DATABASE_FILENAME = "resume_forge.db";
// Success marker written INSIDE the new data dir: survives payload
// replacement on update (a marker in the payload would be wiped by the next
// installer run, re-prompting already-migrated users).
const MARKER_FILENAME = "migrated.json";
// Provenance marker written INSIDE a temp copy dir. A leftover
// <newDataDir>.migrating-<ts> may only be removed when it carries this file:
// the name alone is not proof that the directory is ours (RR-06).
const TEMP_MARKER_FILENAME = ".rf-migrating.json";
// Backups live next to the user data dir (user-writable, outside the install
// payload): a pre-migration backup written into a read-only install directory
// fails exactly when it is needed most (RR-06).
const BACKUPS_DIRNAME = "backups";
// Temp copy sibling of the new data dir: <newDataDir>.migrating-<ts>
const TEMP_INFIX = ".migrating-";
// Sidecars of a snapshotted database are deliberately dropped from the copy
// (their frames already live inside the snapshot): see lib/sqlite-snapshot.js.
const { SIDECAR_SUFFIXES } = require("./sqlite-snapshot");

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

// Order matters: a COMPLETE migration (marker + database in place) wins first
// (idempotency -- never re-migrate nor re-prompt after a successful
// migration), then "nothing to migrate", then "already migrated without a
// marker" (e.g. a manual copy), and only then do we need the user's
// confirmation. A declined migration writes NO marker, so the next launch
// prompts again (ADR: not silently).
//
// RR-06: a marker whose database is GONE is not "already migrated" any more.
// Returning skip there let the app recreate an empty database in a directory
// whose marker says real data used to live in it -- the user sees a fresh,
// empty app and no hint that anything is missing. Two explicit states instead:
//   * legacy copy still present -> needs-migration (ask again, nothing is lost);
//   * nothing anywhere          -> inconsistent (fail closed, see main.js).
function detectMigrationState(oldDataDir, newDataDir) {
  const markerPresent = fs.existsSync(markerPath(newDataDir));
  const newDatabasePresent = fs.existsSync(databasePath(newDataDir));
  const legacyPresent = fs.existsSync(databasePath(oldDataDir));
  if (markerPresent && newDatabasePresent) {
    return { status: "skip", reason: "already-migrated" };
  }
  if (!legacyPresent) {
    if (newDatabasePresent) {
      return { status: "skip", reason: "new-data-exists" };
    }
    return markerPresent
      ? { status: "inconsistent", reason: "marker-without-database" }
      : { status: "skip", reason: "no-legacy-data" };
  }
  if (newDatabasePresent) {
    return { status: "skip", reason: "new-data-exists" };
  }
  return { status: "needs-migration", reason: markerPresent ? "marker-without-database" : null };
}

// --- copy + verify --------------------------------------------------------------

// Recursive copy of regular files only. Symlinks/junctions are deliberately
// NOT followed (a link inside the data dir must never pull outside content
// into the migration); verification fails the migration on the resulting
// file-set mismatch instead of silently copying a link target.
//
// `skip` (relative path -> boolean) lets the caller take over specific files
// (databases go through the snapshot path) without a second full walk.
function copyTree(srcDir, destDir, copyFileFn, { skip = null, base = "" } = {}) {
  fs.mkdirSync(destDir, { recursive: true });
  for (const entry of fs.readdirSync(srcDir, { withFileTypes: true })) {
    const relative = base ? `${base}/${entry.name}` : entry.name;
    if (skip && skip(relative)) continue;
    const from = path.join(srcDir, entry.name);
    const to = path.join(destDir, entry.name);
    if (entry.isDirectory()) {
      copyTree(from, to, copyFileFn, { skip, base: relative });
    } else if (entry.isFile()) {
      copyFileFn(from, to);
    }
  }
}

// --- SQLite snapshot (RR-06) -----------------------------------------------------

// Real SQLite sources require node:sqlite snapshots; missing support stops
// migration. Byte copying is used only for non-database regular files.
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
    // POSIX 分隔符：snapshots / dropped 两个集合都用 "/" 拼路径，Windows 上
    // path.relative 给的是反斜杠，直接用会让快照库匹配不上而误判"内容不符"。
    const rel = path.relative(rootDir, full).split(path.sep).join("/");
    const { size } = fs.statSync(full);
    map.set(rel, { size, sha256: await sha256File(full) });
  }
  return map;
}

// Full three-way comparison (file set, sizes, content hashes), except for the
// databases that went through VACUUM INTO: those are legitimately different
// bytes (defragmented), so they are verified by opening the copy and running
// PRAGMA quick_check instead. All-or-nothing by design: any single difference
// fails the whole migration.
async function verifyTree(
  sourceDir,
  copiedDir,
  { snapshots = new Set(), dropped = new Set(), sqlite = null } = {},
) {
  const source = await inventory(sourceDir);
  const copied = await inventory(copiedDir);
  const problems = [];
  const expected = new Set();
  for (const [rel, info] of source) {
    // Files that were deliberately not carried over (sidecars of snapshotted
    // databases: their frames live inside the snapshot).
    if (dropped.has(rel)) continue;
    expected.add(rel);
    const other = copied.get(rel);
    if (!other) {
      problems.push(`missing after copy: ${rel}`);
      continue;
    }
    if (snapshots.has(rel)) {
      try {
        if (!quickCheck(path.join(copiedDir, rel), sqlite)) {
          problems.push(`snapshot failed its integrity check: ${rel}`);
        }
      } catch (err) {
        problems.push(`snapshot cannot be opened (${err}): ${rel}`);
      }
      continue;
    }
    if (other.size !== info.size || other.sha256 !== info.sha256) {
      problems.push(`content mismatch after copy: ${rel}`);
    }
  }
  for (const rel of copied.keys()) {
    if (rel === TEMP_MARKER_FILENAME) continue; // our own provenance marker
    if (!expected.has(rel)) problems.push(`unexpected extra file after copy: ${rel}`);
  }
  if (problems.length > 0) {
    throw new Error(`migration verification failed (${problems.length}): ${problems[0]}`);
  }
}

// --- the migration itself -------------------------------------------------------

// Backups must never overwrite an earlier one (they are the only rollback
// artifact a user has); a name collision gets a numeric suffix instead.
function uniqueDirectory(baseDir) {
  if (!fs.existsSync(baseDir)) return baseDir;
  for (let index = 1; index < 100; index += 1) {
    const candidate = `${baseDir}-${index}`;
    if (!fs.existsSync(candidate)) return candidate;
  }
  throw new Error(`backup directory name is already taken: ${baseDir}`);
}

async function performMigration({
  oldDataDir,
  newDataDir,
  nowIso,
  copyFileFn = fs.copyFileSync,
  sqlite = defaultSqlite(),
}) {
  const slug = timestampSlug(nowIso);
  // The backup lives under the user profile, next to (never inside) the new
  // data dir: the legacy location is inside the install payload and may be
  // read-only exactly when a legacy migration is needed.
  const backupDir = uniqueDirectory(
    path.join(path.dirname(newDataDir), BACKUPS_DIRNAME, `pre-migration-${slug}`),
  );
  const tempDir = `${newDataDir}${TEMP_INFIX}${slug}`;

  fs.mkdirSync(path.dirname(newDataDir), { recursive: true });

  // A leftover temp dir may only be deleted when it PROVES it is ours: the
  // timestamp in the name is not evidence (a user directory could be named
  // that way, and "same name means delete it" is not a production cleanup
  // policy). Ours carry the provenance marker written below.
  if (fs.existsSync(tempDir)) {
    if (!fs.existsSync(path.join(tempDir, TEMP_MARKER_FILENAME))) {
      throw new Error(
        `temp directory already exists and was not created by this migration: ${tempDir}`,
      );
    }
    fs.rmSync(tempDir, { recursive: true, force: true });
  }

  const databaseFiles = findDatabaseFiles(oldDataDir);
  if (!sqlite && databaseFiles.some((relative) => looksLikeSqlite(path.join(oldDataDir, relative)))) {
    throw new Error(
      "SQLite consistent snapshot support is unavailable; migration stopped without copying user data",
    );
  }

  // 1. Backup first -- kept even when later steps fail (a safety artifact, never
  //    cleaned here). Databases go through the same consistent snapshot as the
  //    migration itself: this backup is the only rollback artifact outside the
  //    install payload, so a torn main+wal pair while another instance writes
  //    would hand the user a corrupt restore point.
  const backupSnapshots = sqlite ? databaseFiles : [];
  const backupSnapshotSet = new Set();
  for (const relative of backupSnapshots) {
    const source = path.join(oldDataDir, relative);
    if (!looksLikeSqlite(source)) continue;
    snapshotDatabase(source, path.join(backupDir, relative), sqlite);
    backupSnapshotSet.add(relative);
  }
  const backupDropped = new Set();
  for (const relative of backupSnapshotSet) {
    for (const suffix of SIDECAR_SUFFIXES) {
      if (fs.existsSync(path.join(oldDataDir, `${relative}${suffix}`))) {
        backupDropped.add(`${relative}${suffix}`);
      }
    }
  }
  copyTree(oldDataDir, backupDir, copyFileFn, {
    skip: (relative) => backupDropped.has(relative) || backupSnapshotSet.has(relative),
  });
  try {
    // 2. Snapshot/copy under a temp name; 3. verify; 4. only then publish by
    //    rename. The temp dir is a sibling of the target, so the rename never
    //    crosses a filesystem boundary.
    fs.mkdirSync(tempDir, { recursive: true });
    fs.writeFileSync(
      path.join(tempDir, TEMP_MARKER_FILENAME),
      `${JSON.stringify({ createdAt: nowIso, from: oldDataDir })}\n`,
    );

    const snapshots = new Set();
    const databases = sqlite ? databaseFiles : [];
    for (const relative of databases) {
      const source = path.join(oldDataDir, relative);
      if (!looksLikeSqlite(source)) continue;
      snapshotDatabase(source, path.join(tempDir, relative), sqlite);
      snapshots.add(relative);
    }
    // Sidecars of snapshotted databases are deliberately NOT copied: their
    // frames are already inside the snapshot, and replaying a stale -wal
    // against a fresh snapshot is how databases get corrupted.
    // Only the SIDECARS are dropped: the database itself is carried over as a
    // snapshot, so the copied tree still contains it (verified by quick_check
    // rather than by byte equality).
    const dropped = new Set();
    for (const relative of snapshots) {
      for (const suffix of SIDECAR_SUFFIXES) {
        if (fs.existsSync(path.join(oldDataDir, `${relative}${suffix}`))) {
          dropped.add(`${relative}${suffix}`);
        }
      }
    }
    // The copy must skip both the snapshotted databases (already written, and
    // deliberately not byte-identical) and their sidecars.
    const skipped = (relative) => dropped.has(relative) || snapshots.has(relative);
    copyTree(oldDataDir, tempDir, copyFileFn, { skip: skipped });
    await verifyTree(oldDataDir, tempDir, { snapshots, dropped, sqlite });
    fs.rmSync(path.join(tempDir, TEMP_MARKER_FILENAME), { force: true });
    if (fs.existsSync(newDataDir)) {
      const leftovers = fs.readdirSync(newDataDir);
      // Re-migration (marker without a database) legitimately finds a stale
      // marker of OUR OWN making; anything else means the directory is not
      // ours to replace.
      const onlyOurMarker = leftovers.every((name) => name === MARKER_FILENAME);
      if (leftovers.length > 0 && !onlyOurMarker) {
        throw new Error(`target data dir exists and is not empty: ${newDataDir}`);
      }
      if (onlyOurMarker && leftovers.length > 0) {
        fs.rmSync(newDataDir, { recursive: true, force: true });
      } else {
        fs.rmdirSync(newDataDir); // empty placeholder (e.g. created by Electron)
      }
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
  sqlite,
}) {
  const state = detectMigrationState(oldDataDir, newDataDir);
  if (state.status === "skip") {
    log(`data migration: skip (${state.reason})`);
    return { outcome: state.reason, userDataDir: newDataDir };
  }
  if (state.status === "inconsistent") {
    // Marker without a database and nothing to fall back to: the shell must
    // NOT quietly create an empty database where real data used to live.
    // main.js owns the recovery dialog (see resolveUserDataDir).
    log("data migration: INCONSISTENT (marker present, no database anywhere)");
    return {
      outcome: "inconsistent",
      userDataDir: null,
      message:
        `数据目录「${newDataDir}」里没有数据库文件，但上一次迁移的标记仍在。\n\n` +
        "应用不会自动新建一份空数据库盖在它上面。请先恢复备份（设置 → 数据 → 导入备份），" +
        "或选择「创建全新数据库」从零开始。",
    };
  }

  // Explicit confirmation (ADR hard requirement). A crashing dialog must not
  // take the launch down: treat it as a decline and keep the legacy setup.
  let confirmed = false;
  try {
    confirmed = await showConfirm({
      from: oldDataDir,
      to: newDataDir,
      // A marker without a database means the previous migration was undone
      // or its result was moved away: say so instead of pretending this is a
      // first-time migration.
      reason: state.reason,
    });
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
    const { backupDir } = await performMigration({
      oldDataDir,
      newDataDir,
      nowIso,
      copyFileFn,
      ...(sqlite === undefined ? {} : { sqlite }),
    });
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

// Explicit user decision from the recovery dialog: start over in the new data
// dir. Removing the marker is what makes detectMigrationState() report
// "no-legacy-data"/"new-data-exists" on the next launch.
function clearMarker(dataDir) {
  fs.rmSync(markerPath(dataDir), { force: true });
}

module.exports = {
  DATABASE_FILENAME,
  MARKER_FILENAME,
  TEMP_MARKER_FILENAME,
  clearMarker,
  detectMigrationState,
  maybeMigrateUserData,
  performMigration,
  uniqueDirectory,
};
