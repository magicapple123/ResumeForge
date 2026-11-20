// SPDX-License-Identifier: Apache-2.0
"use strict";

// 自绘托盘菜单的**窗口壳层**（2026-11-20）：无边框透明窗口 + 定位。
//
// 为什么自绘：原生 `Menu.buildFromTemplate` 的内边距 / 勾选列 / 行高 Electron 一个都
// 不暴露。菜单里只要有一项 `type:"checkbox"`，整张菜单就会为勾选符号预留一条左列，
// 所有文字被推得很远、卡片过宽。自绘之后宽度按内容收缩，未勾选时自然更窄。
//
// 交互契约（与 `desktop/tray-menu.html` 对半分）：
//   * 打开：主进程发模型 → 渲染层量出真实尺寸 → 按 `computePlacement` 定位 → show() 取焦点
//     （Esc 需要焦点才能收到）；
//   * 关闭：`blur` / Esc / 点外部 / 选中某项 → 立即 hide()；选中时**先 hide 再执行动作**，
//     否则动作里的 `win.focus()` 会被这块置顶窗口挡住；
//   * 尺寸由渲染层量：纯主进程估算会把"未勾选更窄"这条做废。
//
// `computePlacement` 是纯函数（贴边翻转 + clamp），离线用例直接断言 —— 这是本模块里
// 唯一不依赖 Electron 的部分。
//
// 多屏 DPI：workArea 取自 `screen.getDisplayMatching(trayBounds)`，不能用
// `getPrimaryDisplay()`（副屏 / 125% 缩放下会定位到另一块屏）。

const path = require("node:path");

/** 行高 / 分隔线 / 内外边距（与 tray-menu.html 的 CSS 逐值一致）。 */
const ITEM_HEIGHT = 30;
const SEPARATOR_HEIGHT = 9; // 1px 线 + 上下各 4px
const MENU_PADDING_Y = 6;
/** 宽度区间：`max-content` 落在这里面（窄到 168 仍能放下中文文案，宽到 280 截断）。 */
const MENU_MIN_WIDTH = 108;
const MENU_MAX_WIDTH = 280;
const FALLBACK_WIDTH = 200;
/** 菜单与托盘图标的间距。 */
const MENU_GAP = 4;

const CHANNELS = {
  model: "tray-menu:model",
  choose: "tray-menu:choose",
  close: "tray-menu:close",
};

/**
 * 菜单落在哪：默认贴托盘图标上方居中，越界就翻到另一侧，最后 clamp 进 workArea。
 *
 * 任务是"任务栏可以在上下左右任意一边"，所以两个方向都要能翻转：
 *   * 纵向：上方放不下（任务栏在顶部）→ 翻到图标下方；
 *   * 横向：居中会越出左/右边界（任务栏在左侧/右侧）→ 翻到图标的右/左侧。
 * clamp 是兜底（菜单比 workArea 还大、或翻转后仍然越界时不会飞出屏幕）。
 *
 * @param {object} input
 * @param {{x: number, y: number, width: number, height: number}} input.trayBounds
 * @param {{x: number, y: number, width: number, height: number}} input.workArea
 * @param {{width: number, height: number}} input.menuSize
 * @param {number} [input.gap]
 * @returns {{x: number, y: number}}
 */
function computePlacement({ trayBounds, workArea, menuSize, gap = MENU_GAP }) {
  const right = workArea.x + workArea.width;
  const bottom = workArea.y + workArea.height;

  // 纵向：优先在图标上方（任务栏在底部时的常态）。
  let y = trayBounds.y - menuSize.height - gap;
  if (y < workArea.y) {
    const below = trayBounds.y + trayBounds.height + gap;
    y = below + menuSize.height <= bottom ? below : workArea.y;
  }
  y = Math.min(Math.max(y, workArea.y), Math.max(workArea.y, bottom - menuSize.height));

  // 横向：优先以图标为中心；越界则翻到图标另一侧。
  let x = Math.round(trayBounds.x + trayBounds.width / 2 - menuSize.width / 2);
  if (x < workArea.x) {
    const toRight = trayBounds.x + trayBounds.width + gap;
    x = toRight + menuSize.width <= right ? toRight : workArea.x;
  } else if (x + menuSize.width > right) {
    const toLeft = trayBounds.x - menuSize.width - gap;
    x = toLeft >= workArea.x ? toLeft : right - menuSize.width;
  }
  x = Math.min(Math.max(x, workArea.x), Math.max(workArea.x, right - menuSize.width));

  return { x: Math.round(x), y: Math.round(y) };
}

/** 拿不到渲染层实测尺寸时的兜底（仅防御用：正常路径总是量一次）。 */
function estimateMenuSize(model) {
  const rows = Array.isArray(model) ? model : [];
  const height =
    MENU_PADDING_Y * 2 +
    rows.reduce((sum, item) => sum + (item && item.type === "separator" ? SEPARATOR_HEIGHT : ITEM_HEIGHT), 0);
  return { width: FALLBACK_WIDTH, height: Math.max(height, ITEM_HEIGHT + MENU_PADDING_Y * 2) };
}

/**
 * 量尺寸的脚本：**用轮询而不是 requestAnimationFrame**。
 *
 * 窗口在这一步还没 `show()`（先量后定位才不会闪一下），而隐藏窗口的 rAF 会被
 * 合成器挂起 —— 等帧等不到。所以改成"等到这一版模型真的渲染出来（或 300ms 超时）
 * 后同步读一次"（`getBoundingClientRect` 本身就会强制布局），配合 webPreferences 的
 * `backgroundThrottling: false` 让 setTimeout 在后台也照常触发。
 *
 * 判据用 `data-token`（每次打开都变）而不是"项数一致"：项数是常数，而勾选态会改变
 * 宽度（✓ 前缀），用项数判会把上一版的尺寸当成这一版的。
 *
 * @param {string} token 本次模型的一次性标记
 */
function measureScript(token) {
  return `new Promise((resolve) => {
  const started = Date.now();
  const menu = document.getElementById("menu");
  const read = () => {
    const rect = menu ? menu.getBoundingClientRect() : document.body.getBoundingClientRect();
    resolve({ width: Math.ceil(rect.width), height: Math.ceil(rect.height) });
  };
  const tick = () => {
    const rendered = menu && menu.getAttribute("data-token") === ${JSON.stringify(token)};
    if (rendered || Date.now() - started > 300) {
      read();
      return;
    }
    setTimeout(tick, 8);
  };
  tick();
})`;
}

/**
 * @param {object} deps
 * @param {object} deps.BrowserWindow Electron BrowserWindow 构造器
 * @param {object} deps.ipcMain Electron ipcMain
 * @param {object} deps.screen Electron screen（getDisplayMatching / getPrimaryDisplay）
 * @param {string} deps.dirname 本文件所在目录的上一层（打包态 = app.asar 根）
 * @param {function(string): void} [deps.onChoose] 用户选中某项（id 来自模型）
 * @param {function(string): void} [deps.logLine]
 */
function createTrayMenuWindow(deps) {
  const { BrowserWindow, ipcMain, screen, dirname } = deps;
  const { onChoose = () => {}, logLine = () => {} } = deps;

  let win = null;
  let loaded = false;
  // 每次打开都换一个 token：渲染层把它写进 data-token，主进程据此确认"这一版已经画好"。
  let sequence = 0;

  function liveWindow() {
    if (!win) return null;
    try {
      return win.isDestroyed() ? null : win;
    } catch {
      return null;
    }
  }

  function hide() {
    const current = liveWindow();
    if (!current) return;
    try {
      current.hide();
    } catch (err) {
      logLine(`tray-menu: hide failed: ${err}`);
    }
  }

  function ensureWindow() {
    const existing = liveWindow();
    if (existing) return existing;
    win = new BrowserWindow({
      width: FALLBACK_WIDTH,
      height: ITEM_HEIGHT * 5,
      show: false,
      frame: false,
      transparent: true,
      resizable: false,
      movable: false,
      minimizable: false,
      maximizable: false,
      fullscreenable: false,
      skipTaskbar: true,
      alwaysOnTop: true,
      backgroundColor: "#00000000",
      webPreferences: {
        // dirname 是包含 main.js 的那一层（打包态 = app.asar 根，开发态 = desktop/）。
        // 这里**不能**再拼一个 ".."：close-dialog 当年就是在这一层多写了一级，
        // loadURL 永远 ERR_FILE_NOT_FOUND。
        preload: path.join(dirname, "tray-menu-preload.js"),
        contextIsolation: true,
        nodeIntegration: false,
        sandbox: true,
        // 量尺寸发生在 show() 之前（隐藏窗）：默认的后台节流会把 setTimeout 压到 1s，
        // 菜单就会迟一拍才出现。菜单是一次性小页面，不必省这点资源。
        backgroundThrottling: false,
      },
    });
    loaded = false;
    // 点外部 / 切到别的应用：焦点一丢就关（原生菜单同款行为）。
    win.on("blur", hide);
    win.on("closed", () => {
      win = null;
      loaded = false;
    });
    return win;
  }

  if (ipcMain && typeof ipcMain.on === "function") {
    ipcMain.on(CHANNELS.choose, (event, id) => {
      const current = liveWindow();
      if (!current || event.sender !== current.webContents) return;
      // 先关再执行：动作里可能 win.focus()（检查更新会唤主窗口），
      // 这块置顶菜单留在屏幕上会把主窗口的焦点抢回来。
      hide();
      try {
        onChoose(String(id));
      } catch (err) {
        logLine(`tray-menu: choose ${id} failed: ${err}`);
      }
    });
    ipcMain.on(CHANNELS.close, (event) => {
      const current = liveWindow();
      if (!current || event.sender !== current.webContents) return;
      hide();
    });
  }

  /** workArea 必须来自图标所在的那块屏（副屏 / 不同 DPI 各算各的）。 */
  function workAreaFor(anchor) {
    try {
      if (anchor && typeof screen.getDisplayMatching === "function") {
        const display = screen.getDisplayMatching(anchor);
        if (display && display.workArea) return display.workArea;
      }
    } catch (err) {
      logLine(`tray-menu: getDisplayMatching failed: ${err}`);
    }
    return screen.getPrimaryDisplay().workArea;
  }

  function measure(target, model, token) {
    const fallback = estimateMenuSize(model);
    if (!target.webContents || typeof target.webContents.executeJavaScript !== "function") {
      return Promise.resolve(fallback);
    }
    return Promise.resolve(target.webContents.executeJavaScript(measureScript(token), true))
      .then((size) => {
        if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return fallback;
        return {
          width: Math.min(Math.max(Math.ceil(size.width), MENU_MIN_WIDTH), MENU_MAX_WIDTH),
          height: Math.max(Math.ceil(size.height), ITEM_HEIGHT),
        };
      })
      .catch((err) => {
        logLine(`tray-menu: measure failed: ${err}`);
        return fallback;
      });
  }

  /**
   * 打开菜单。
   *
   * @param {{model: Array, anchor: object|null}} input
   * @returns {Promise<boolean>} true = 窗口已显示
   */
  async function show({ model = [], anchor = null } = {}) {
    let target;
    try {
      target = ensureWindow();
    } catch (err) {
      logLine(`tray-menu: create window failed: ${err}`);
      return false;
    }
    try {
      if (!loaded) {
        await target.loadFile(path.join(dirname, "tray-menu.html"));
        loaded = true;
      }
      const token = String((sequence += 1));
      target.webContents.send(CHANNELS.model, { model, token });
      const menuSize = await measure(target, model, token);
      const workArea = workAreaFor(anchor);
      const bounds = anchor || {
        x: workArea.x + workArea.width - 1,
        y: workArea.y + workArea.height - 1,
        width: 1,
        height: 1,
      };
      const { x, y } = computePlacement({ trayBounds: bounds, workArea, menuSize });
      target.setBounds({ x, y, width: menuSize.width, height: menuSize.height });
      target.show();
      target.focus();
      return true;
    } catch (err) {
      logLine(`tray-menu: show failed: ${err}`);
      hide();
      return false;
    }
  }

  function destroy() {
    const current = liveWindow();
    if (!current) return;
    try {
      current.destroy();
    } catch {
      // 退出路径上销毁失败无所谓。
    }
  }

  return { show, hide, destroy, channels: CHANNELS };
}

module.exports = {
  CHANNELS,
  ITEM_HEIGHT,
  MENU_GAP,
  MENU_MAX_WIDTH,
  MENU_MIN_WIDTH,
  SEPARATOR_HEIGHT,
  computePlacement,
  createTrayMenuWindow,
  estimateMenuSize,
};
