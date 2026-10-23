// SPDX-License-Identifier: Apache-2.0
/**
 * `lib/window-state.js` 的离线用例（`node --test "scripts/test-*.js"`，CI 的 desktop-shell 作业收）。
 *
 * 为什么这些用例值得存在：窗口跑出屏幕 / 记住一个坏尺寸的后果是"应用起来了但看不见"，
 * 而这在无头 CI 里永远不会被"点一下"发现。三条纯函数把这类事故变成可以断言的字面量。
 */
const assert = require("node:assert/strict");
const fs = require("node:fs");
const os = require("node:os");
const path = require("node:path");
const test = require("node:test");

const {
  MIN_HEIGHT,
  MIN_WIDTH,
  buildStatePayload,
  clampToWorkArea,
  initialBounds,
  normalizeZoomFactor,
  readWindowState,
  writeWindowState,
} = require("../lib/window-state");

const PRIMARY = { x: 0, y: 0, width: 1920, height: 1040 };
const SECONDARY = { x: 1920, y: 0, width: 1920, height: 1040 };

test("按工作区比例算默认尺寸，并居中", () => {
  const bounds = initialBounds(PRIMARY);
  assert.equal(bounds.width, Math.round(1920 * 0.82));
  assert.equal(bounds.height, Math.round(1040 * 0.86));
  assert.equal(bounds.x, Math.round((1920 - bounds.width) / 2));
});

test("默认尺寸封顶 1600×1000（4K 屏不会开出一个半屏以上的窗口）", () => {
  const bounds = initialBounds({ x: 0, y: 0, width: 3840, height: 2120 });
  assert.equal(bounds.width, 1600);
  assert.equal(bounds.height, 1000);
});

test("小屏工作区：默认宽度不低于 minWidth，高度不低于 minHeight", () => {
  const bounds = initialBounds({ x: 0, y: 0, width: 1024, height: 700 });
  assert.ok(bounds.width >= Math.min(MIN_WIDTH, 1024));
  assert.ok(bounds.height >= Math.min(MIN_HEIGHT, 700));
});

test("合法位置原样保留（只夹尺寸）", () => {
  const bounds = clampToWorkArea({ x: 40, y: 60, width: 1280, height: 800 }, [{ workArea: PRIMARY }]);
  assert.deepEqual(bounds, { x: 40, y: 60, width: 1280, height: 800 });
});

test("尺寸越界时夹回 [minWidth, 工作区宽]", () => {
  const tooSmall = clampToWorkArea({ x: 0, y: 0, width: 800, height: 500 }, [{ workArea: PRIMARY }]);
  assert.equal(tooSmall.width, MIN_WIDTH);
  assert.equal(tooSmall.height, MIN_HEIGHT);

  const tooBig = clampToWorkArea({ x: 0, y: 0, width: 2600, height: 1400 }, [{ workArea: PRIMARY }]);
  assert.equal(tooBig.width, PRIMARY.width);
  assert.equal(tooBig.height, PRIMARY.height);
});

test("窗口与所有屏幕的交集不足 60%：丢弃位置并居中到主屏", () => {
  // 副屏被拔掉的典型形态：x=2400 落在主屏之外，交集为 0。
  const bounds = clampToWorkArea({ x: 2400, y: 100, width: 1280, height: 800 }, [
    { workArea: PRIMARY },
  ]);
  assert.equal(bounds.width, 1280);
  assert.equal(bounds.x, Math.round((PRIMARY.width - 1280) / 2));

  // 一半在屏外（交集 50% < 60%）同样要拉回来。
  const half = clampToWorkArea({ x: 1280, y: 100, width: 1280, height: 800 }, [
    { workArea: PRIMARY },
  ]);
  assert.equal(half.x, Math.round((PRIMARY.width - 1280) / 2));
});

test("跨屏：位置落在副屏且交集足够时保留原坐标", () => {
  const bounds = clampToWorkArea({ x: 2100, y: 80, width: 900, height: 700 }, [
    { workArea: PRIMARY },
    { workArea: SECONDARY },
  ]);
  assert.equal(bounds.x, 2100);
  assert.equal(bounds.y, 80);
});

test("缺字段 / 非数字 / 空显示器列表：一律返回 null（调用方回退默认尺寸）", () => {
  assert.equal(clampToWorkArea(null, [{ workArea: PRIMARY }]), null);
  assert.equal(clampToWorkArea({ x: 0, y: 0, width: 800 }, [{ workArea: PRIMARY }]), null);
  assert.equal(clampToWorkArea({ x: "a", y: 0, width: 800, height: 700 }, [{ workArea: PRIMARY }]), null);
  assert.equal(clampToWorkArea({ x: 0, y: 0, width: 800, height: 700 }, []), null);
  assert.equal(clampToWorkArea({ x: 0, y: 0, width: 800, height: 700 }, [{}]), null);
});

test("读写：写进去能读回来；文件不存在 / JSON 损坏 / 版本不符一律 null", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-window-state-"));
  const file = path.join(dir, "nested", "window-state.json");

  assert.equal(readWindowState(file), null);
  assert.equal(writeWindowState(file, buildStatePayload({ x: 10, y: 20, width: 1200, height: 800 }, 1.25, false)), true);

  const state = readWindowState(file);
  assert.equal(state.width, 1200);
  assert.equal(state.x, 10);
  assert.equal(state.zoomFactor, 1.25);
  assert.equal(state.version, 1);

  fs.writeFileSync(file, "{not json", "utf8");
  assert.equal(readWindowState(file), null);

  fs.writeFileSync(file, JSON.stringify({ version: 99, width: 1200 }), "utf8");
  assert.equal(readWindowState(file), null);
});

test("写失败不抛（目标是一个不可写的路径时返回 false）", () => {
  const dir = fs.mkdtempSync(path.join(os.tmpdir(), "rf-window-state-"));
  const blocked = path.join(dir, "file-not-dir");
  fs.writeFileSync(blocked, "x", "utf8");
  // 把文件当目录用 → mkdirSync 抛 EEXIST/ENOTDIR，必须被吞掉。
  assert.equal(writeWindowState(path.join(blocked, "state.json"), { version: 1 }), false);
});

test("缩放系数夹到 [0.8, 1.5]，非数字回 1", () => {
  assert.equal(normalizeZoomFactor(0.5), 0.8);
  assert.equal(normalizeZoomFactor(3), 1.5);
  assert.equal(normalizeZoomFactor(1.25), 1.25);
  assert.equal(normalizeZoomFactor(Number.NaN), 1);
  assert.equal(normalizeZoomFactor(undefined), 1);
});
