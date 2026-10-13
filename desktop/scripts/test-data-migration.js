"use strict";

// Probes for desktop/lib/data-migration.js (ADR-0004 legacy-data migration).
//
// Pure fs + injected-dialog tests: no Electron, no real backend, no network.
// Covered:
//   1. detectMigrationState: legacy db present/new empty -> needs; no legacy
//      data / new db / migrated marker -> skip.
//   2. Successful migration: full file-set + SHA-256 verification, marker
//      contents, untouched legacy copy, backup sibling, no leftover temp.
//   3. User decline: nothing moved, no marker, backend runs legacy (null).
//   4. Verification failure (injected corrupt copy): temp cleaned up, no
//      marker, legacy data intact, error surfaced.
//   5. Copy-phase failure (injected throwing copy): same safety properties.
//   6. Idempotency: second call after a successful migration skips without
//      prompting again.

const assert = require("assert");
const fs = require("fs");
const os = require("os");
const path = require("path");
const crypto = require("crypto");
const { test } = require("node:test");

const {
  DATABASE_FILENAME,
  MARKER_FILENAME,
  detectMigrationState,
  performMigration,
  maybeMigrateUserData,
} = require("../lib/data-migration");

function makeTempRoot(label) {
  return fs.mkdtempSync(path.join(os.tmpdir(), `rf-data-migration-${label}-`));
}

function sha256(filePath) {
  return crypto.createHash("sha256").update(fs.readFileSync(filePath)).digest("hex");
}

function writeRel(rootDir, rel, content) {
  const full = path.join(rootDir, rel);
  fs.mkdirSync(path.dirname(full), { recursive: true });
  fs.writeFileSync(full, content);
  return full;
}

function relInventory(rootDir) {
  const files = [];
  const walk = (dir) => {
    for (const entry of fs.readdirSync(dir, { withFileTypes: true })) {
      const full = path.join(dir, entry.name);
      if (entry.isDirectory()) walk(full);
      else if (entry.isFile()) files.push(path.relative(rootDir, full));
    }
  };
  if (fs.existsSync(rootDir)) walk(rootDir);
  return files.sort();
}

function hashAll(rootDir) {
  const map = {};
  for (const rel of relInventory(rootDir)) map[rel] = sha256(path.join(rootDir, rel));
  return map;
}

// A realistic legacy payload-era data dir: database + WAL/SHM sidecars,
// user_files (nested), datasets (with .trash), plus misc dirs from config.py.
function makeLegacyData(dir) {
  writeRel(dir, DATABASE_FILENAME, "sqlite-main-page-".repeat(40));
  writeRel(dir, `${DATABASE_FILENAME}-wal`, "wal-frames-".repeat(16));
  writeRel(dir, `${DATABASE_FILENAME}-shm`, "shm-index-".repeat(8));
  writeRel(dir, "user_files/photo.png", "png-bytes-".repeat(30));
  writeRel(dir, "user_files/docs/note.txt", "user note");
  writeRel(dir, "datasets/abc123.db", "dataset-db-".repeat(50));
  writeRel(dir, "datasets/abc123.json", '{"id":"abc123"}');
  writeRel(dir, "datasets/.trash/old.db", "trashed-dataset");
  writeRel(dir, "logs/backend.log", "log line\n");
  writeRel(dir, "captures/page.html", "<html>sample</html>");
}

function fixtureDirs(root, label) {
  const oldDataDir = path.join(root, "payload", "backend", "data");
  const newDataDir = path.join(root, "userdata", label, "data");
  makeLegacyData(oldDataDir);
  return { oldDataDir, newDataDir };
}

const FIXED_NOW = "2026-10-13T08:30:00.000Z";

// --- 1. detection ----------------------------------------------------------------

test("detect: legacy db + empty target -> needs-migration", () => {
  const root = makeTempRoot("detect-needs");
  try {
    const { oldDataDir, newDataDir } = fixtureDirs(root, "new");
    assert.deepStrictEqual(detectMigrationState(oldDataDir, newDataDir), {
      status: "needs-migration",
      reason: null,
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("detect: no legacy data / new db exists / marker present -> skip", () => {
  const root = makeTempRoot("detect-skip");
  try {
    const oldDataDir = path.join(root, "old");
    const newDataDir = path.join(root, "new");

    // Fresh install: nothing under the legacy location.
    fs.mkdirSync(oldDataDir, { recursive: true });
    assert.deepStrictEqual(detectMigrationState(oldDataDir, newDataDir), {
      status: "skip",
      reason: "no-legacy-data",
    });

    // Target already holds a database (migrated or manually copied).
    makeLegacyData(oldDataDir);
    writeRel(newDataDir, DATABASE_FILENAME, "already-there");
    assert.deepStrictEqual(detectMigrationState(oldDataDir, newDataDir), {
      status: "skip",
      reason: "new-data-exists",
    });

    // Migrated marker wins even over both databases being present.
    fs.rmSync(newDataDir, { recursive: true, force: true });
    writeRel(newDataDir, MARKER_FILENAME, "{}");
    assert.deepStrictEqual(detectMigrationState(oldDataDir, newDataDir), {
      status: "skip",
      reason: "already-migrated",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 2. successful migration -------------------------------------------------------

test("migration success: full copy verified, marker written, legacy copy untouched", async () => {
  const root = makeTempRoot("migrate-ok");
  try {
    const { oldDataDir, newDataDir } = fixtureDirs(root, "new");
    const legacyBefore = hashAll(oldDataDir);

    const confirmCalls = [];
    const result = await maybeMigrateUserData({
      oldDataDir,
      newDataDir,
      showConfirm: async (details) => {
        confirmCalls.push(details);
        return true;
      },
      showError: async () => assert.fail("showError must not fire on success"),
      now: () => FIXED_NOW,
      log: () => {},
    });

    assert.strictEqual(result.outcome, "migrated");
    assert.strictEqual(result.userDataDir, newDataDir);
    assert.deepStrictEqual(confirmCalls, [{ from: oldDataDir, to: newDataDir }]);

    // The new location holds exactly the legacy file set, byte-identical
    // (plus the marker, which is not part of the migrated content).
    assert.deepStrictEqual(
      relInventory(newDataDir).filter((rel) => rel !== MARKER_FILENAME),
      relInventory(oldDataDir),
    );
    for (const rel of relInventory(oldDataDir)) {
      assert.strictEqual(
        sha256(path.join(newDataDir, rel)),
        sha256(path.join(oldDataDir, rel)),
        `content must match for ${rel}`,
      );
    }

    // Marker: timestamp + both paths, sitting inside the new data dir.
    const marker = JSON.parse(fs.readFileSync(path.join(newDataDir, MARKER_FILENAME), "utf-8"));
    assert.strictEqual(marker.migratedAt, FIXED_NOW);
    assert.strictEqual(marker.from, oldDataDir);
    assert.strictEqual(marker.to, newDataDir);

    // Backup sibling exists with the same content; temp dir is gone.
    const backupDir = `${oldDataDir}.pre-migration-2026-10-13T08-30-00-000Z`;
    assert.ok(fs.existsSync(backupDir), "backup sibling must exist");
    assert.deepStrictEqual(relInventory(backupDir).sort(), relInventory(oldDataDir).sort());
    assert.strictEqual(
      fs.readdirSync(path.dirname(newDataDir)).filter((n) => n.includes(".migrating-")).length,
      0,
      "no temp dir may survive a successful migration",
    );

    // The legacy copy is untouched (ADR: never cleaned by the migration).
    assert.deepStrictEqual(hashAll(oldDataDir), legacyBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 3. user declines ----------------------------------------------------------------

test("user decline: nothing migrated, no marker, backend keeps the legacy location", async () => {
  const root = makeTempRoot("migrate-declined");
  try {
    const { oldDataDir, newDataDir } = fixtureDirs(root, "new");
    const legacyBefore = hashAll(oldDataDir);

    const result = await maybeMigrateUserData({
      oldDataDir,
      newDataDir,
      showConfirm: async () => false,
      showError: async () => assert.fail("decline is not an error"),
      now: () => FIXED_NOW,
      log: () => {},
    });

    assert.strictEqual(result.outcome, "declined");
    assert.strictEqual(result.userDataDir, null, "null -> no RF_DATA_DIR injected");
    assert.strictEqual(fs.existsSync(newDataDir), false, "target must not be created");
    assert.deepStrictEqual(hashAll(oldDataDir), legacyBefore);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 4. verification failure ----------------------------------------------------------

test("verification failure: temp cleaned, no marker, legacy data intact, error shown", async () => {
  const root = makeTempRoot("migrate-verify-fail");
  try {
    const { oldDataDir, newDataDir } = fixtureDirs(root, "new");
    const legacyBefore = hashAll(oldDataDir);
    const corruptRel = path.join("datasets", "abc123.db");

    // Corrupt exactly one file while copying INTO the temp dir (the backup
    // and legacy copies are left alone); verification must catch it.
    const copyFileFn = (src, dest) => {
      if (dest.includes(".migrating-") && dest.endsWith(corruptRel)) {
        fs.mkdirSync(path.dirname(dest), { recursive: true });
        fs.writeFileSync(dest, "corrupted-by-injection");
        return;
      }
      fs.copyFileSync(src, dest);
    };

    const errorMessages = [];
    const result = await maybeMigrateUserData({
      oldDataDir,
      newDataDir,
      showConfirm: async () => true,
      showError: async (title, message) => errorMessages.push({ title, message }),
      now: () => FIXED_NOW,
      log: () => {},
      copyFileFn,
    });

    assert.strictEqual(result.outcome, "failed");
    assert.strictEqual(result.userDataDir, null, "backend must fall back to the legacy location");
    assert.strictEqual(
      fs.readdirSync(path.dirname(newDataDir)).filter((n) => n.includes(".migrating-")).length,
      0,
      "the half product must be rolled back",
    );
    assert.strictEqual(fs.existsSync(path.join(newDataDir, MARKER_FILENAME)), false,
      "a failed migration must not write the marker");
    assert.deepStrictEqual(hashAll(oldDataDir), legacyBefore, "legacy data must be untouched");
    assert.strictEqual(errorMessages.length, 1, "the user must see the failure");
    assert.match(errorMessages[0].message, /重试/, "the message must offer a retry");
    // The backup stays as a safety artifact.
    assert.ok(fs.existsSync(`${oldDataDir}.pre-migration-2026-10-13T08-30-00-000Z`));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 5. copy-phase failure --------------------------------------------------------------

test("copy failure (locked file): same safety properties as a verification failure", async () => {
  const root = makeTempRoot("migrate-copy-fail");
  try {
    const { oldDataDir, newDataDir } = fixtureDirs(root, "new");
    const legacyBefore = hashAll(oldDataDir);

    // Simulate an antivirus/lock error right after the backup step.
    const copyFileFn = (src, dest) => {
      if (dest.includes(".migrating-")) {
        throw Object.assign(new Error("EBUSY: resource busy"), { code: "EBUSY" });
      }
      fs.copyFileSync(src, dest);
    };

    const errorMessages = [];
    const result = await maybeMigrateUserData({
      oldDataDir,
      newDataDir,
      showConfirm: async () => true,
      showError: async (title, message) => errorMessages.push({ title, message }),
      now: () => FIXED_NOW,
      log: () => {},
      copyFileFn,
    });

    assert.strictEqual(result.outcome, "failed");
    assert.strictEqual(result.userDataDir, null);
    assert.strictEqual(
      fs.readdirSync(path.dirname(newDataDir)).filter((n) => n.includes(".migrating-")).length,
      0,
    );
    assert.strictEqual(fs.existsSync(newDataDir), false);
    assert.strictEqual(fs.existsSync(path.join(newDataDir, MARKER_FILENAME)), false);
    assert.deepStrictEqual(hashAll(oldDataDir), legacyBefore);
    assert.strictEqual(errorMessages.length, 1);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 6. idempotency -----------------------------------------------------------------------

test("idempotency: a second run after a successful migration skips without prompting", async () => {
  const root = makeTempRoot("migrate-idempotent");
  try {
    const { oldDataDir, newDataDir } = fixtureDirs(root, "new");
    const options = {
      oldDataDir,
      newDataDir,
      showConfirm: async () => {
        throw new Error("must not prompt again after a successful migration");
      },
      showError: async () => assert.fail("no error expected"),
      now: () => FIXED_NOW,
      log: () => {},
    };

    const first = await maybeMigrateUserData({ ...options, showConfirm: async () => true });
    assert.strictEqual(first.outcome, "migrated");

    const second = await maybeMigrateUserData(options);
    assert.strictEqual(second.outcome, "already-migrated");
    assert.strictEqual(second.userDataDir, newDataDir);

    // And a bare detect agrees.
    assert.deepStrictEqual(detectMigrationState(oldDataDir, newDataDir), {
      status: "skip",
      reason: "already-migrated",
    });
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

// --- 7. performMigration guard rails ---------------------------------------------------

test("performMigration refuses a non-empty target instead of overwriting it", async () => {
  const root = makeTempRoot("migrate-target-not-empty");
  try {
    const { oldDataDir, newDataDir } = fixtureDirs(root, "new");
    writeRel(newDataDir, "stray.txt", "not ours to delete");

    await assert.rejects(() => performMigration({ oldDataDir, newDataDir, nowIso: FIXED_NOW }));
    assert.strictEqual(fs.readFileSync(path.join(newDataDir, "stray.txt"), "utf-8"),
      "not ours to delete", "an unexpected non-empty target must never be clobbered");
    assert.strictEqual(fs.existsSync(path.join(newDataDir, MARKER_FILENAME)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
