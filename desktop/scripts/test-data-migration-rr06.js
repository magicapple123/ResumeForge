"use strict";

// RR-06（桌面旧数据迁移的可信度）：WAL 一致快照、临时目录来源核验、标记与库不一致
// 时的 fail-closed、以及"旧位置仍有数据就重新询问"。从 test-data-migration.js 拆出
// （行数预算），夹具与工具走 ./testkit。

const assert = require("assert");
const fs = require("fs");
const path = require("path");
const { test } = require("node:test");
const { makeTempRoot, writeRel } = require("./testkit");

const {
  detectMigrationState,
  performMigration,
  maybeMigrateUserData,
} = require("../lib/data-migration");
const { DATABASE_FILENAME, MARKER_FILENAME } = require("../lib/data-migration");

const FIXED_NOW = "2026-10-13T08:30:00.000Z";

function makeLegacyData(dir) {
  writeRel(dir, DATABASE_FILENAME, "sqlite-main-page-".repeat(40));
  writeRel(dir, `${DATABASE_FILENAME}-wal`, "wal-frames-".repeat(16));
  writeRel(dir, `${DATABASE_FILENAME}-shm`, "shm-index-".repeat(8));
  writeRel(dir, "user_files/photo.png", "png-bytes-".repeat(30));
  writeRel(dir, "datasets/abc123.db", "dataset-db-".repeat(50));
}

function fixtureDirs(root, label) {
  const oldDataDir = path.join(root, "payload", "backend", "data");
  const newDataDir = path.join(root, "userdata", label, "data");
  makeLegacyData(oldDataDir);
  return { oldDataDir, newDataDir };
}

// --- 8. RR-06: WAL-consistent snapshots, provenance, recovery ---------------------

function makeRealSqliteDb(dbPath, { keepWalOpen = true } = {}) {
  // A genuine SQLite database whose last committed transaction is still in the
  // -wal file (journal_mode=WAL + no clean close => no automatic checkpoint).
  const { DatabaseSync } = require("node:sqlite");
  fs.mkdirSync(path.dirname(dbPath), { recursive: true });
  const db = new DatabaseSync(dbPath);
  db.exec("PRAGMA journal_mode=WAL");
  db.exec("CREATE TABLE IF NOT EXISTS note (id INTEGER PRIMARY KEY, body TEXT)");
  db.prepare("INSERT INTO note (body) VALUES (?)").run("committed-into-wal");
  if (!keepWalOpen) {
    db.exec("PRAGMA wal_checkpoint(TRUNCATE)");
    db.close();
    return;
  }
  // Leave the connection open: the row lives in the WAL only.
  return db;
}

test("migration snapshots SQLite databases consistently (WAL frames included)", async () => {
  const root = makeTempRoot("migrate-wal");
  const openHandles = [];
  try {
    openHandles.push(makeRealSqliteDb(path.join(root, "payload", "backend", "data", DATABASE_FILENAME)));
    const oldDataDir = path.join(root, "payload", "backend", "data");
    const newDataDir = path.join(root, "userdata", "new", "data");
    writeRel(oldDataDir, "user_files/doc.bin", "attachment bytes");

    const walPath = `${path.join(oldDataDir, DATABASE_FILENAME)}-wal`;
    assert.ok(fs.existsSync(walPath) && fs.statSync(walPath).size > 0, "fixture must have a live WAL");

    const result = await maybeMigrateUserData({
      oldDataDir,
      newDataDir,
      showConfirm: async () => true,
      showError: async () => assert.fail("showError must not fire"),
      now: () => FIXED_NOW,
      log: () => {},
    });
    assert.strictEqual(result.outcome, "migrated");

    // The migrated database carries the WAL-only row...
    const { DatabaseSync } = require("node:sqlite");
    const check = new DatabaseSync(path.join(newDataDir, DATABASE_FILENAME), { readOnly: true });
    try {
      const rows = check.prepare("SELECT body FROM note").all();
      assert.deepStrictEqual(
        rows.map((row) => row.body),
        ["committed-into-wal"],
        "a row that only exists in the WAL must survive the migration",
      );
      assert.strictEqual(
        Object.values(check.prepare("PRAGMA quick_check").get())[0],
        "ok",
        "the migrated snapshot must be a healthy database",
      );
    } finally {
      check.close();
    }
    // ...and NO sidecars: replaying a stale -wal against a fresh snapshot is
    // how databases get corrupted.
    assert.strictEqual(fs.existsSync(path.join(newDataDir, `${DATABASE_FILENAME}-wal`)), false);
    assert.strictEqual(fs.existsSync(path.join(newDataDir, `${DATABASE_FILENAME}-shm`)), false);
    // Attachments are still byte-identical.
    assert.strictEqual(
      fs.readFileSync(path.join(newDataDir, "user_files", "doc.bin"), "utf-8"),
      "attachment bytes",
    );
  } finally {
    for (const handle of openHandles) {
      try {
        handle.close();
      } catch {}
    }
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("migration refuses to delete a same-named temp dir it did not create", async () => {
  const root = makeTempRoot("migrate-temp-provenance");
  try {
    const { oldDataDir, newDataDir } = fixtureDirs(root, "new");
    // Someone else's directory at exactly the temp name we would use.
    const tempDir = `${newDataDir}.migrating-2026-10-13T08-30-00-000Z`;
    writeRel(tempDir, "user-work.txt", "not ours");

    await assert.rejects(
      () => performMigration({ oldDataDir, newDataDir, nowIso: FIXED_NOW }),
      /temp directory already exists/,
    );
    assert.strictEqual(
      fs.readFileSync(path.join(tempDir, "user-work.txt"), "utf-8"),
      "not ours",
      "a directory without our provenance marker must be left alone",
    );
    assert.strictEqual(fs.existsSync(path.join(newDataDir, MARKER_FILENAME)), false);
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("marker without a database fails closed instead of starting an empty app", async () => {
  const root = makeTempRoot("migrate-inconsistent");
  try {
    const oldDataDir = path.join(root, "payload", "backend", "data");
    const newDataDir = path.join(root, "userdata", "new", "data");
    fs.mkdirSync(oldDataDir, { recursive: true });
    writeRel(newDataDir, MARKER_FILENAME, '{"migratedAt":"2026-10-01T00:00:00.000Z"}');

    const result = await maybeMigrateUserData({
      oldDataDir,
      newDataDir,
      showConfirm: async () => assert.fail("must not silently offer a migration"),
      showError: async () => assert.fail("no plain error dialog on this path"),
      now: () => FIXED_NOW,
      log: () => {},
    });

    assert.strictEqual(result.outcome, "inconsistent");
    assert.strictEqual(result.userDataDir, null, "no data dir may be handed to the backend");
    assert.match(result.message, /不会自动新建/);
    // Nothing was created and the marker is still there for the recovery dialog.
    assert.strictEqual(fs.existsSync(path.join(newDataDir, DATABASE_FILENAME)), false);
    assert.ok(fs.existsSync(path.join(newDataDir, MARKER_FILENAME)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("marker without a database but with legacy data re-offers the migration", async () => {
  const root = makeTempRoot("migrate-marker-rerun");
  try {
    const { oldDataDir, newDataDir } = fixtureDirs(root, "new");
    writeRel(newDataDir, MARKER_FILENAME, '{"migratedAt":"2026-10-01T00:00:00.000Z"}');

    const confirmCalls = [];
    const result = await maybeMigrateUserData({
      oldDataDir,
      newDataDir,
      showConfirm: async (details) => {
        confirmCalls.push(details);
        return true;
      },
      showError: async () => assert.fail("showError must not fire"),
      now: () => FIXED_NOW,
      log: () => {},
    });

    assert.strictEqual(result.outcome, "migrated");
    assert.strictEqual(confirmCalls[0].reason, "marker-without-database");
    assert.ok(fs.existsSync(path.join(newDataDir, DATABASE_FILENAME)));
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});

test("migration survives a nested real-SQLite dataset (path separator regression)", async () => {
  // 旧数据目录里的 datasets/<id>.db 也是真库：快照走 VACUUM INTO（字节与源不同），
  // 因此靠 "快照集合" 匹配来跳过逐字节比较。集合用 "/" 拼路径、inventory 用
  // path.relative（Windows 上是反斜杠）时两者永远匹配不上，整次迁移会在
  // "content mismatch after copy: datasets\x.db" 上失败——用户每次启动都弹错。
  const root = makeTempRoot("migrate-nested-db");
  try {
    const oldDataDir = path.join(root, "payload", "backend", "data");
    const newDataDir = path.join(root, "userdata", "new", "data");
    fs.mkdirSync(oldDataDir, { recursive: true });
    const live = makeRealSqliteDb(path.join(oldDataDir, DATABASE_FILENAME));
    const nested = makeRealSqliteDb(path.join(oldDataDir, "datasets", "abc123.db"));
    writeRel(oldDataDir, "user_files/doc.bin", "attachment bytes");
    try {
      const errors = [];
      const result = await maybeMigrateUserData({
        oldDataDir,
        newDataDir,
        showConfirm: async () => true,
        showError: async (_title, message) => errors.push(message),
        now: () => FIXED_NOW,
        log: () => {},
      });
      assert.deepStrictEqual(errors, []);
      assert.strictEqual(result.outcome, "migrated");
      assert.ok(fs.existsSync(path.join(newDataDir, "datasets", "abc123.db")));
      assert.strictEqual(
        fs.existsSync(path.join(newDataDir, "datasets", "abc123.db-wal")),
        false,
        "快照已经包含 WAL 里的内容，边车不该被搬过去",
      );
    } finally {
      live.close();
      nested.close();
    }
  } finally {
    fs.rmSync(root, { recursive: true, force: true });
  }
});
