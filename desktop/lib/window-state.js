// SPDX-License-Identifier: Apache-2.0
/**
 * 窗口尺寸 / 位置 / 缩放系数的持久化（方案 §2.3.3）。
 *
 * 为什么单独成文件：主进程 `main.js` 已经 445 行，而这套逻辑里有三条**纯函数**必须能离线
 * 单测（夹到工作区、跨屏丢弃位置、读写失败静默）——它们和 Electron 的生命周期没关系，
 * 混进 `main.js` 就只能靠手点验证。
 *
 * 三条硬性质：
 * 1. **读写永不抛**：磁盘满、只读、JSON 损坏 → 一律当作"没有状态"，回退默认尺寸。
 *    窗口状态丢失是小事，启动崩掉是大事。
 * 2. **只记 DIP**：`BrowserWindow` 的 bounds 本来就是 DIP（与系统缩放无关），
 *    所以 125% / 150% 来回切时窗口不会"越开越小"。
 * 3. **位置可以被丢弃，尺寸不行**：显示器拔掉后窗口可能落到屏幕外，那时只保留尺寸并居中。
 */
const fs = require("node:fs");
const path = require("node:path");

/** 与 createWindow 的 minWidth/minHeight 保持一致（方案附录 D4：1120 不再掉进 E 档）。 */
const MIN_WIDTH = 1120;
const MIN_HEIGHT = 700;

/** 默认窗口尺寸（读不到屏幕信息时的兜底；正常路径由 `initialBounds` 按工作区算）。 */
const DEFAULT_WIDTH = 1440;
const DEFAULT_HEIGHT = 900;

/** 窗口与屏幕工作区的交集低于这个比例 → 视为"跑到屏幕外了"，丢弃位置。 */
const MIN_VISIBLE_RATIO = 0.6;

/** 缩放系数的允许区间：超出这个范围说明用户把自己放进了未验收的档位（方案 §2.3.4-3）。 */
const MIN_ZOOM_FACTOR = 0.8;
const MAX_ZOOM_FACTOR = 1.5;

function clampNumber(value, min, max) {
  return Math.min(max, Math.max(min, value));
}

/** 两个矩形的交集面积（没有交集 = 0）。 */
function intersectionArea(a, b) {
  const width = Math.min(a.x + a.width, b.x + b.width) - Math.max(a.x, b.x);
  const height = Math.min(a.y + a.height, b.y + b.height) - Math.max(a.y, b.y);
  if (width <= 0 || height <= 0) return 0;
  return width * height;
}

function isFiniteRect(value) {
  if (!value || typeof value !== "object") return false;
  return ["x", "y", "width", "height"].every((key) => Number.isFinite(value[key]));
}

/**
 * 把记忆里的窗口夹回"看得见"的范围。
 *
 * - 尺寸先夹到 `[minWidth, 工作区宽]`（高度同理）；
 * - 与**任一**显示器工作区的交集不足 60% → 丢弃坐标、居中到主屏（拔掉副屏的常见后果）；
 * - 入参不合法 → 返回 `null`，由调用方回退默认尺寸。
 */
function clampToWorkArea(bounds, displays, options = {}) {
  if (!isFiniteRect(bounds)) return null;
  if (!Array.isArray(displays) || displays.length === 0) return null;

  const workAreas = displays
    .map((display) => display && display.workArea)
    .filter((area) => isFiniteRect(area));
  if (workAreas.length === 0) return null;

  const primary = workAreas[0];
  const minWidth = options.minWidth ?? MIN_WIDTH;
  const minHeight = options.minHeight ?? MIN_HEIGHT;
  const width = Math.round(clampNumber(bounds.width, minWidth, primary.width));
  const height = Math.round(clampNumber(bounds.height, minHeight, primary.height));

  const candidate = { x: Math.round(bounds.x), y: Math.round(bounds.y), width, height };
  const area = width * height;
  const visible = workAreas.some(
    (workArea) => intersectionArea(candidate, workArea) / area >= MIN_VISIBLE_RATIO,
  );
  if (visible) return candidate;

  // 丢弃位置：只保留尺寸，居中到主屏（用户至少能找到窗口）。
  return {
    x: Math.round(primary.x + (primary.width - width) / 2),
    y: Math.round(primary.y + (primary.height - height) / 2),
    width,
    height,
  };
}

/** 缺省尺寸：按工作区比例算，封顶 1600×1000（方案 §2.3.1）。 */
function initialBounds(workArea, options = {}) {
  const minWidth = options.minWidth ?? MIN_WIDTH;
  const minHeight = options.minHeight ?? MIN_HEIGHT;
  if (!isFiniteRect(workArea)) {
    return { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  }
  const width = Math.round(
    clampNumber(Math.round(workArea.width * 0.82), minWidth, Math.min(1600, workArea.width)),
  );
  const height = Math.round(
    clampNumber(Math.round(workArea.height * 0.86), minHeight, Math.min(1000, workArea.height)),
  );
  return {
    x: Math.round(workArea.x + (workArea.width - width) / 2),
    y: Math.round(workArea.y + (workArea.height - height) / 2),
    width,
    height,
  };
}

/** 读窗口状态：任何异常（不存在 / 权限 / JSON 坏）一律 `null`，绝不抛。 */
function readWindowState(file) {
  try {
    const raw = fs.readFileSync(file, "utf8");
    const parsed = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    if (parsed.version !== 1) return null;
    return parsed;
  } catch {
    return null;
  }
}

/** 写窗口状态：失败静默（磁盘满 / 只读 / 目录不存在）。 */
function writeWindowState(file, payload) {
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(payload, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/** 缩放系数夹到 [0.8, 1.5]：非数字/越界一律回到 1。 */
function normalizeZoomFactor(value) {
  if (!Number.isFinite(value)) return 1;
  return clampNumber(value, MIN_ZOOM_FACTOR, MAX_ZOOM_FACTOR);
}

/** 把"当前窗口 + 缩放"整理成落盘结构（只留认识的字段，避免把内部对象写进 JSON）。 */
function buildStatePayload(bounds, zoomFactor, maximized) {
  const safe = isFiniteRect(bounds) ? bounds : { width: DEFAULT_WIDTH, height: DEFAULT_HEIGHT };
  return {
    version: 1,
    width: Math.round(safe.width),
    height: Math.round(safe.height),
    x: Math.round(safe.x ?? 0),
    y: Math.round(safe.y ?? 0),
    maximized: Boolean(maximized),
    zoomFactor: normalizeZoomFactor(zoomFactor),
  };
}

/**
 * 给主进程用的读写句柄：把 `app.getPath("userData")` 与"当前窗口"解耦出去，
 * 于是 `main.js` 只留两行调用，500 行预算不会被这套 IO 吃光。
 */
function createWindowStateStore({ app, getWindow }) {
  const file = () => path.join(app.getPath("userData"), "window-state.json");
  return {
    read: () => readWindowState(file()),
    save: () => {
      const win = getWindow();
      if (!win || win.isDestroyed()) return;
      try {
        const maximized = win.isMaximized();
        const bounds = maximized ? win.getNormalBounds() : win.getBounds();
        writeWindowState(
          file(),
          buildStatePayload(bounds, win.webContents.getZoomFactor(), maximized),
        );
      } catch {
        // 退出路径上的失败不值得打扰用户（磁盘满 / 只读 / 窗口已销毁）。
      }
    },
  };
}

module.exports = {
  createWindowStateStore,
  MIN_WIDTH,
  MIN_HEIGHT,
  DEFAULT_WIDTH,
  DEFAULT_HEIGHT,
  clampToWorkArea,
  initialBounds,
  readWindowState,
  writeWindowState,
  normalizeZoomFactor,
  buildStatePayload,
};
