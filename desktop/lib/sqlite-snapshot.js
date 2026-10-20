// SPDX-License-Identifier: Apache-2.0
"use strict";

// Consistent SQLite snapshots for the legacy-data migration (RR-06).
//
// Copying a live database file (plus its -wal sidecars) is only safe while
// nobody writes to it; another launcher instance or a still-running backend
// can write at any moment, and a torn copy of main+wal is how databases get
// corrupted. VACUUM INTO instead writes a defragmented, standalone snapshot of
// the CURRENT logical content -- including frames that still sit in an
// un-checkpointed -wal -- and the copy is verified by opening it.
//
// node:sqlite ships with modern Node/Electron. Real databases must fail closed
// when snapshot support is unavailable; copying active main+WAL is not a fallback.

const fs = require("fs");
const path = require("path");

// Every SQLite database (plus sidecars) matches this: the main payload DB,
// per-dataset DBs and the soft-delete trash all live under the data dir.
const SIDECAR_SUFFIXES = ["-wal", "-shm", "-journal"];
// SQLite format 3 followed by a NUL byte: every real database starts with it.
// else is copied byte-for-byte instead of being snapshotted.
const SQLITE_HEADER = "SQLite format 3\0";
// Temp copies of a previous crashed migration sit next to the data dir as
// <newDataDir>.migrating-<ts>; they are never source data.
const TEMP_INFIX = ".migrating-";

function isSidecar(relativePath) {
  return SIDECAR_SUFFIXES.some((suffix) => relativePath.endsWith(suffix));
}

// Sidecar files belong to <name>.db; map them back to their database.
function sidecarOwner(relativePath) {
  for (const suffix of SIDECAR_SUFFIXES) {
    if (relativePath.endsWith(suffix)) {
      return relativePath.slice(0, -suffix.length);
    }
  }
  return null;
}

function defaultSqlite() {
  try {
    // eslint-disable-next-line global-require
    return require("node:sqlite");
  } catch {
    return null;
  }
}

function looksLikeSqlite(filePath) {
  try {
    const handle = fs.openSync(filePath, "r");
    try {
      const header = Buffer.alloc(SQLITE_HEADER.length);
      const read = fs.readSync(handle, header, 0, header.length, 0);
      return read === header.length && header.toString("latin1") === SQLITE_HEADER;
    } finally {
      fs.closeSync(handle);
    }
  } catch {
    return false;
  }
}

function sidecarBytes(filePath) {
  try {
    return fs.statSync(filePath).size;
  } catch {
    return 0;
  }
}

// A consistent snapshot of a SQLite database: VACUUM INTO writes a
// defragmented, standalone copy of the CURRENT logical content -- including
// frames that still sit in an un-checkpointed -wal file. A plain file copy of
// main+wal is only torn-copy safe when nobody writes during the copy, which
// this process cannot guarantee (another launcher instance may hold the DB).
function snapshotDatabase(sourceFile, targetFile, sqlite) {
  fs.mkdirSync(path.dirname(targetFile), { recursive: true });
  fs.rmSync(targetFile, { force: true });
  const escaped = targetFile.split(path.sep).join("/").replace(/'/g, "''");
  const db = new sqlite.DatabaseSync(sourceFile, { readOnly: true });
  try {
    db.exec(`VACUUM INTO '${escaped}'`);
  } finally {
    db.close();
  }
  return targetFile;
}

function quickCheck(filePath, sqlite) {
  const db = new sqlite.DatabaseSync(filePath, { readOnly: true });
  try {
    const row = db.prepare("PRAGMA quick_check").get();
    return Object.values(row || {})[0] === "ok";
  } finally {
    db.close();
  }
}

function findDatabaseFiles(rootDir) {
  const found = [];
  const walk = (dir, base) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      // Skip our own temp copies if a previous run left one behind: they are
      // not source data and must never be part of a migration.
      if (entry.name.includes(TEMP_INFIX)) continue;
      const relative = base ? `${base}/${entry.name}` : entry.name;
      if (entry.isDirectory()) {
        walk(path.join(dir, entry.name), relative);
      } else if (entry.isFile() && relative.endsWith(".db")) {
        found.push(relative);
      }
    }
  };
  walk(rootDir, "");
  return found.sort();
}

module.exports = {
  SIDECAR_SUFFIXES,
  TEMP_INFIX,
  defaultSqlite,
  findDatabaseFiles,
  isSidecar,
  looksLikeSqlite,
  quickCheck,
  sidecarOwner,
  snapshotDatabase,
};
