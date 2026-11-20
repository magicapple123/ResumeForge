// SPDX-License-Identifier: Apache-2.0
"use strict";

// 「更新尝试」标记 + 启动对账的离线用例（2026-11-20，第 9.2 条）。
//
// 背景：安装器由一个**脱离的** PowerShell 拉起（detached + stdio:"ignore"），主进程拿不到
// 它的退出码。所以"装成了没有"改成下次启动时靠一份标记对账：
//   * 没有标记            -> none（绝大多数启动）
//   * 版本仍是 from       -> failed（那次没装成，要提示用户）
//   * 版本已变            -> installed（删标记，静默）
//
// 三种状态都要钉住（任务书要求），另外补三条边界：文件坏了、字段缺失、写不进去。
//
// Run with: node --test scripts/test-update-attempt.js

const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const {
  ATTEMPT_FILE_NAME,
  ATTEMPT_STATUS,
  attemptFilePath,
  clearUpdateAttempt,
  readUpdateAttempt,
  reconcileUpdateAttempt,
  recordUpdateAttempt,
} = require("../lib/update-attempt");

/** 每个用例一个临时 userData 目录（用完删掉）。 */
function withUserDataDir(run) {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-update-attempt-"));
  try {
    return run(dir);
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
}

test("标记写在 userData 根目录、字段完整（from / to / at / installer）", () => {
  withUserDataDir((dir) => {
    assert.equal(attemptFilePath(dir), path.join(dir, ATTEMPT_FILE_NAME));
    assert.equal(
      recordUpdateAttempt(dir, { from: "2.1.0", to: "2.2.0", installer: "C:/tmp/setup.exe" }),
      true,
    );
    const written = JSON.parse(fs.readFileSync(attemptFilePath(dir), "utf-8"));
    assert.equal(written.from, "2.1.0");
    assert.equal(written.to, "2.2.0");
    assert.equal(written.installer, "C:/tmp/setup.exe");
    assert.match(written.at, /^\d{4}-\d{2}-\d{2}T/, "at 必须是一个可读的时间戳");
    // 读回来形状一致。
    assert.deepEqual(readUpdateAttempt(dir), written);
  });
});

test("没写标记时缺 from/to 一律不写（没有对账依据，宁可不写也不错报）", () => {
  withUserDataDir((dir) => {
    assert.equal(recordUpdateAttempt(dir, { from: "", to: "2.2.0" }), false);
    assert.equal(recordUpdateAttempt(dir, { from: "2.1.0" }), false);
    assert.equal(recordUpdateAttempt(null, { from: "2.1.0", to: "2.2.0" }), false);
    assert.equal(fs.existsSync(attemptFilePath(dir)), false);
  });
});

test("对账：没有标记 -> none（什么都不做）", () => {
  withUserDataDir((dir) => {
    const result = reconcileUpdateAttempt(dir, "2.1.0");
    assert.equal(result.status, ATTEMPT_STATUS.none);
    assert.equal(result.attempt, null);
  });
});

test("对账：版本没变 -> failed，且标记必须保留（等调用方弹完提示再清）", () => {
  withUserDataDir((dir) => {
    recordUpdateAttempt(dir, { from: "2.1.0", to: "2.2.0", installer: "C:/tmp/setup.exe" });
    const result = reconcileUpdateAttempt(dir, "2.1.0");
    assert.equal(result.status, ATTEMPT_STATUS.failed, "仍是旧版本 = 那次安装真的没成");
    assert.equal(result.attempt.to, "2.2.0");
    assert.equal(fs.existsSync(attemptFilePath(dir)), true, "标记由弹窗方在提示后清理");
  });
});

test("对账：版本已变 -> installed，并静默删标记", () => {
  withUserDataDir((dir) => {
    recordUpdateAttempt(dir, { from: "2.1.0", to: "2.2.0", installer: "C:/tmp/setup.exe" });
    const result = reconcileUpdateAttempt(dir, "2.2.0");
    assert.equal(result.status, ATTEMPT_STATUS.installed);
    assert.equal(fs.existsSync(attemptFilePath(dir)), false, "版本变了标记就过期，必须删掉");
    // 幂等：再对账一次依旧是 none，不会误报。
    assert.equal(reconcileUpdateAttempt(dir, "2.2.0").status, ATTEMPT_STATUS.none);
  });
});

test("对账：版本变成别的值（手动装了其他版本 / 回滚）同样静默清掉", () => {
  withUserDataDir((dir) => {
    recordUpdateAttempt(dir, { from: "2.1.0", to: "2.2.0" });
    assert.equal(reconcileUpdateAttempt(dir, "2.1.5").status, ATTEMPT_STATUS.installed);
    assert.equal(fs.existsSync(attemptFilePath(dir)), false);
  });
});

test("标记文件坏掉（不是 JSON / 缺字段）按 none 处理，并顺手删掉", () => {
  withUserDataDir((dir) => {
    fs.writeFileSync(attemptFilePath(dir), "{ not json", "utf-8");
    assert.equal(readUpdateAttempt(dir), null);
    assert.equal(reconcileUpdateAttempt(dir, "2.1.0").status, ATTEMPT_STATUS.none);
    assert.equal(fs.existsSync(attemptFilePath(dir)), false, "坏文件不该一直躺在用户目录里");

    fs.writeFileSync(attemptFilePath(dir), JSON.stringify({ to: "2.2.0" }), "utf-8");
    assert.equal(readUpdateAttempt(dir), null, "缺 from 就没有对账依据");
    assert.equal(reconcileUpdateAttempt(dir, "2.1.0").status, ATTEMPT_STATUS.none);
  });
});

test("写不进去（目录不存在且无法创建）只返回 false，绝不抛", () => {
  // 用一个"父路径是文件"的目录，让 mkdirSync 必然失败。
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-update-attempt-"));
  const blocker = path.join(dir, "blocker");
  fs.writeFileSync(blocker, "x");
  try {
    assert.doesNotThrow(() =>
      assert.equal(
        recordUpdateAttempt(path.join(blocker, "nested"), { from: "2.1.0", to: "2.2.0" }),
        false,
      ),
    );
    // 清理也必须不抛（退出路径上不能因为一个标记把流程拦下来）。
    assert.doesNotThrow(() => clearUpdateAttempt(path.join(blocker, "nested")));
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});
