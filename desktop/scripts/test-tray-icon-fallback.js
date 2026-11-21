// SPDX-License-Identifier: Apache-2.0
/**
 * 托盘图标缺失时的降级（2026-11-21）。
 *
 * 2.2.0 的 Linux AppImage 里没有 `resources/tray.ico`，`new Tray()` 抛错后被
 * `app.whenReady()` 的 catch 接住，整个应用停在 "Startup failed" 页面——
 * AppImage 目录检测就是因此失败的（PR AppImage/appimage.github.io#11983）。
 *
 * 两条契约：
 *   1. `resolveTrayIconPath` 在 tray.ico 缺失时退回同目录 icon.png；两个都不在
 *      也不抛，返回首选路径交给上层兜底；
 *   2. `createTrayManager().create()` 在 Tray 构造抛错时降级为 null 并留一行日志，
 *      不向上抛——托盘是附带功能，不该拖着启动一起死。
 *
 * Run with: node --test "scripts/test-*.js"
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const { test } = require("node:test");

const { createTrayManager, resolveTrayIconPath } = require("../lib/tray-menu");

test("图标路径：tray.ico 缺失时退回 icon.png", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-tray-fallback-"));
  try {
    fs.writeFileSync(path.join(dir, "icon.png"), "png");
    assert.equal(
      resolveTrayIconPath({ app: { isPackaged: false }, dirname: dir }),
      path.join(dir, "icon.png"),
      "只有 icon.png 时应退回它",
    );

    fs.writeFileSync(path.join(dir, "tray.ico"), "ico");
    assert.equal(
      resolveTrayIconPath({ app: { isPackaged: false }, dirname: dir }),
      path.join(dir, "tray.ico"),
      "两个都在时仍优先 tray.ico",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("图标路径：两个都不在时返回首选路径而不抛", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-tray-empty-"));
  try {
    assert.equal(
      resolveTrayIconPath({ app: { isPackaged: false }, dirname: dir }),
      path.join(dir, "tray.ico"),
      "没有任何图标时应返回首选路径，由 create() 兜底",
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("图标路径：打包态读 resourcesPath，不读 asar 内部", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-tray-packaged-"));
  try {
    fs.writeFileSync(path.join(dir, "tray.ico"), "ico");
    assert.equal(
      resolveTrayIconPath({ app: { isPackaged: true }, dirname: "ignored", resourcesPath: () => dir }),
      path.join(dir, "tray.ico"),
    );
  } finally {
    fs.rmSync(dir, { recursive: true, force: true });
  }
});

test("create：Tray 抛错时降级为 null 并留日志，不向上抛", () => {
  const logs = [];
  const manager = createTrayManager({
    Tray: function BrokenTray() {
      throw new Error("Failed to load image from path");
    },
    iconPath: path.join(os.tmpdir(), "rf-tray-missing", "tray.ico"),
    app: { quit() {} },
    getWindow: () => null,
    logLine: (line) => logs.push(line),
  });

  assert.doesNotThrow(() => manager.create(), "托盘失败不能拖垮启动");
  assert.equal(manager.getTray(), null, "失败后不能留下半初始化对象");
  assert.ok(
    logs.some((line) => line.includes("tray unavailable")),
    `应记录 tray unavailable，实际: ${logs.join(" | ")}`,
  );
  // 后续调用点（主题切换、菜单刷新）必须能安全地面对 null。
  assert.doesNotThrow(() => manager.refresh());
  assert.doesNotThrow(() => manager.destroy());
});
