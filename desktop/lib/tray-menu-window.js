// SPDX-License-Identifier: Apache-2.0
"use strict";

// 自绘托盘菜单的**窗口壳层**（2026-11-20）：无边框透明窗口 + 定位。
//
// 为什么自绘：原生 `Menu.buildFromTemplate` 的内边距 / 勾选列 / 行高 Electron 一个都
// 不暴露。菜单里只要有一项 `type:"checkbox"`，整张菜单就会为勾选符号预留一条左列，
// 所有文字被推得很远、卡片过宽。自绘之后宽度按内容收缩，未勾选时自然更窄。
//
// 第 1 条（2026-11-20 二轮）之后多了三件结构性的事，都在这里定尺寸：
//   * 每行 32px 高、前置 16px 图标位（`ITEM_HEIGHT`）；
//   * 卡片靠 `box-shadow` 浮起 —— 阴影画在卡片之外，所以窗口比卡片大两圈 18px
//     （`MENU_SHADOW_BLEED`），否则阴影会被窗口裁掉；
//   * 定位按**卡片**尺寸算，`setBounds` 时再换算成窗口 bounds（`toWindowBounds`）。
//
// 交互契约（与 `desktop/tray-menu.html` 对半分）：
//   * 打开：主进程发模型 → 渲染层量出真实尺寸 → 按 `computePlacement` 定位 → show() 取焦点
//     （Esc 需要焦点才能收到）；
//   * 关闭：`blur` / Esc / 点外部 / 选中某项 → 立即 hide()；选中时**先 hide 再执行动作**，
//     否则动作里的 `win.focus()` 会被这块置顶窗口挡住；
//   * 尺寸由渲染层量：纯主进程估算会把"未勾选更窄"这条做废。
//
// 三个纯函数（`computePlacement` / `estimateMenuContentSize` / `toWindowBounds`）不依赖
// Electron，离线用例直接断言；其余部分（窗口、IPC、定位调用）只能在真机验收。
//
// 多屏 DPI：workArea 取自 `screen.getDisplayMatching(trayBounds)`，不能用
// `getPrimaryDisplay()`（副屏 / 125% 缩放下会定位到另一块屏）。

const path = require("node:path");

/** 行高 / 分隔线 / 卡片内边距（与 tray-menu.html 的 CSS 逐值一致）。 */
const ITEM_HEIGHT = 32;
const SEPARATOR_HEIGHT = 11; // 1px 线 + 上下各 5px
/** 卡片 padding（`#menu { padding: 6px }`）。 */
const MENU_PADDING_Y = 6;
/**
 * 卡片边框（`1px solid var(--line)`）。
 *
 * 全局 `box-sizing: border-box` 下它算在卡片高度里（实测卡片 = 行高合计 + 12 + 2），
 * 所以兜底估算也要算上，否则首次弹出会矮 2px、定位再被拉回来时闪一下。
 */
const MENU_BORDER_WIDTH = 1;
/**
 * 投影出血（2026-11-20 第 1 条）：卡片靠 `box-shadow` 浮起，而阴影画在元素盒**之外**
 * ——窗口尺寸若等于卡片尺寸，阴影会被窗口直接裁掉（Windows 上 transparent + frameless
 * 本来就不给原生阴影）。所以 HTML 里多包一层 `#surface { padding: 18px }`，窗口比卡片
 * 大两圈 18px，阴影落在窗口内。
 *
 * 三个联动点（少改一处就会错位，见下方 computePlacement / toWindowBounds）：
 *   * 量尺寸量的是 `#surface`（= 卡片 + 36）；
 *   * **定位仍按卡片尺寸算**，否则菜单会被这 18px 顶离屏幕边；
 *   * setBounds 时 x/y 各减 18、宽高各加 36。
 */
const MENU_SHADOW_BLEED = 18;
/** 宽度区间（**卡片**宽度）：加上图标位后 108 会挤成一团，所以下限抬到 168。 */
const MENU_MIN_WIDTH = 168;
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

/**
 * 未渲染前的**内容**尺寸估算（卡片本身，不含投影出血）。
 *
 * 只用于兜底（正常路径总是量一次）：拿不到渲染层尺寸时，首帧也不能闪一下高度。
 *
 * @param {Array} model 菜单模型
 * @returns {{width: number, height: number}}
 */
function estimateMenuContentSize(model) {
  const rows = Array.isArray(model) ? model : [];
  const height =
    MENU_PADDING_Y * 2 +
    MENU_BORDER_WIDTH * 2 +
    rows.reduce((sum, item) => sum + (item && item.type === "separator" ? SEPARATOR_HEIGHT : ITEM_HEIGHT), 0);
  return { width: FALLBACK_WIDTH, height: Math.max(height, ITEM_HEIGHT + MENU_PADDING_Y * 2) };
}

/**
 * 未渲染前的**窗口**尺寸估算 = 内容 + 两侧出血。
 *
 * `MENU_PADDING_Y` 只加卡片自己的 6px；阴影的 18 必须另加，否则首次弹出会闪一下高度。
 *
 * @param {Array} model 菜单模型
 * @returns {{width: number, height: number}}
 */
function estimateMenuSize(model) {
  const content = estimateMenuContentSize(model);
  return {
    width: content.width + MENU_SHADOW_BLEED * 2,
    height: content.height + MENU_SHADOW_BLEED * 2,
  };
}

/**
 * 卡片坐标 + 卡片尺寸 -> 窗口 bounds（纯函数）。
 *
 * `computePlacement` 返回的是**卡片**左上角（它要贴着屏幕边，不能被阴影边距顶开），
 * 而 `setBounds` 设的是**窗口**（卡片 + 两侧 18px 出血）。这一步就是两者之间的换算：
 * x/y 各减 18，宽高各加 36。少改这一处，菜单会整体向右下偏 18px。
 *
 * @param {{x: number, y: number}} placement 卡片坐标（computePlacement 的结果）
 * @param {{width: number, height: number}} contentSize 卡片尺寸
 * @returns {{x: number, y: number, width: number, height: number}} 窗口 bounds
 */
function toWindowBounds(placement, contentSize) {
  return {
    x: Math.round(placement.x) - MENU_SHADOW_BLEED,
    y: Math.round(placement.y) - MENU_SHADOW_BLEED,
    width: Math.ceil(contentSize.width) + MENU_SHADOW_BLEED * 2,
    height: Math.ceil(contentSize.height) + MENU_SHADOW_BLEED * 2,
  };
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
 * 宽度（勾选框有/无填充），用项数判会把上一版的尺寸当成这一版的。
 *
 * **量的是 `#surface`（卡片 + 两侧 18px 出血）**，因为窗口尺寸必须是它；主进程再减去
 * `MENU_SHADOW_BLEED * 2` 还原成卡片尺寸去定位（见 toWindowBounds 的注释）。
 *
 * @param {string} token 本次模型的一次性标记
 */
function measureScript(token) {
  return `new Promise((resolve) => {
  const started = Date.now();
  const menu = document.getElementById("menu");
  const surface = document.getElementById("surface");
  const read = () => {
    const node = surface || menu || document.body;
    const rect = node.getBoundingClientRect();
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
      // 初始尺寸只活到第一次 show() 之前；含阴影出血（卡片 + 2×18），
      // 否则首帧会看到卡片被窗口裁掉一圈。
      width: FALLBACK_WIDTH + MENU_SHADOW_BLEED * 2,
      height: ITEM_HEIGHT * 5 + MENU_SHADOW_BLEED * 2,
      show: false,
      frame: false,
      transparent: true,
      // CSS 的 box-shadow 就是本菜单唯一的"浮起"手段（transparent + frameless 在
      // Windows 上拿不到原生阴影）。开启 hasShadow 会让系统再画一圈，与 CSS 那份叠在
      // 一起变脏，所以显式关掉。
      hasShadow: false,
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

  /**
   * 量出**卡片**尺寸（减去投影出血）。
   *
   * 渲染层量到的是 `#surface`（卡片 + 36），这里还原成卡片尺寸再做宽度收敛：
   * `MENU_MIN_WIDTH` / `MENU_MAX_WIDTH` 是**卡片**的宽度区间。
   */
  function measure(target, model, token) {
    const fallback = estimateMenuContentSize(model);
    if (!target.webContents || typeof target.webContents.executeJavaScript !== "function") {
      return Promise.resolve(fallback);
    }
    return Promise.resolve(target.webContents.executeJavaScript(measureScript(token), true))
      .then((size) => {
        if (!size || !Number.isFinite(size.width) || !Number.isFinite(size.height)) return fallback;
        const width = Math.ceil(size.width) - MENU_SHADOW_BLEED * 2;
        const height = Math.ceil(size.height) - MENU_SHADOW_BLEED * 2;
        return {
          width: Math.min(Math.max(width, MENU_MIN_WIDTH), MENU_MAX_WIDTH),
          height: Math.max(height, ITEM_HEIGHT),
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
      const contentSize = await measure(target, model, token);
      const workArea = workAreaFor(anchor);
      const bounds = anchor || {
        x: workArea.x + workArea.width - 1,
        y: workArea.y + workArea.height - 1,
        width: 1,
        height: 1,
      };
      // 先用**卡片**尺寸定位（贴屏幕边不会被 18px 出血顶开），再换算成窗口 bounds。
      const placement = computePlacement({ trayBounds: bounds, workArea, menuSize: contentSize });
      target.setBounds(toWindowBounds(placement, contentSize));
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
  MENU_BORDER_WIDTH,
  MENU_GAP,
  MENU_MAX_WIDTH,
  MENU_MIN_WIDTH,
  MENU_PADDING_Y,
  MENU_SHADOW_BLEED,
  SEPARATOR_HEIGHT,
  computePlacement,
  createTrayMenuWindow,
  estimateMenuContentSize,
  estimateMenuSize,
  toWindowBounds,
};
