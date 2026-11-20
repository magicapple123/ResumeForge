// SPDX-License-Identifier: Apache-2.0
"use strict";

// 自绘标题栏的**窗口壳层**（问题清单 §19）：electron-builder 窗口选项、标题栏覆盖层
// 配色与窗口状态通知。React 渲染层在 frontend/src/features/desktop/，本模块只负责
// 主进程那一半，方便离线断言（颜色 / 高度 / 平台分支 / 无窗口时的静默）。
//
// 四条硬约束：
//   1. 三颗窗口按钮由系统绘制（titleBarStyle: "hidden" + titleBarOverlay），不自己画；
//   2. macOS 的红绿灯在左上角：只给 trafficLightPosition，不给 overlay（overlay 仅
//      win32/linux 支持），React 侧给菜单区加左内边距；
//   3. **颜色由渲染层决定**（2026-11-20 第 3 条）：页面 CSS 是 `--rf-titlebar-bg` /
//      `--rf-titlebar-symbol` 的唯一真源，渲染层读计算值随主题一起上报，本模块只管
//      校验 + 落到 setTitleBarOverlay。`TITLEBAR_THEME` 从"真源"降级为"默认值"
//      （窗口创建时与非法上报的兜底），不要再把它当第二份配置去同步；
//   4. 主题切换时主进程要跟着 `setTitleBarOverlay`，否则深色界面顶着浅色按钮图标。

/** 自绘标题栏高度（与 React 侧 CSS / WCO overlay 高度必须同值）。 */
const TITLEBAR_HEIGHT = 32;

/**
 * 兜底 padding 的 CSS。
 *
 * **本常量必须与 `TITLEBAR_HEIGHT` 同源，二者又必须与前端 `--rf-titlebar-height`（32px，
 * 定义在 frontend/src/styles/desktop-titlebar.css）逐值一致。** 只要有一个漂移，兜底层
 * 就会让页面要么差一条 32px 的缝，要么继续与系统三颗按钮互相遮挡（P1-1 症状）。
 * 所以这里从 TITLEBAR_HEIGHT 拼字符串，绝不写字面量 32。
 *
 * 选择器带 `:not(:has(.app-titlebar))` 是 2026-11-20 真机事故的修复：
 * `did-finish-load` 早于 React 挂载，此刻 `.app-titlebar` 必然还不存在，兜底会**误判**
 * 并注入一条无条件的 `body{padding-top:32px}`；随后标题栏自己挂载（它本来就是纵向
 * flex 的第一项），两条 32px 叠加 → 整页内容被顶下去 32px，系统三颗按钮浮在自绘标题栏
 * **上方**，页头/操作条与品牌条错位。条件化之后，这条 padding 只在标题栏真的不存在时
 * 生效，标题栏一挂载就自动失效（`:has()` 在 Electron 45 / Chromium 156 可用）。
 */
function titleBarFallbackCss(height = TITLEBAR_HEIGHT) {
  return `html:not(:has(.app-titlebar)) body{padding-top:${height}px}`;
}

/**
 * 标题栏覆盖层配色的**默认值**（2026-11-20 第 3 条之后不再是真源）。
 *
 * 真源是页面 CSS：`frontend/src/styles/desktop-titlebar.css` 的 `--rf-titlebar-bg` 与
 * `--rf-titlebar-symbol`。渲染层在主题变化时把**计算值**经 `desktop:set-theme` 报上来，
 * 本模块校验后直接落到 `setTitleBarOverlay`。这里的常量只剩两个用途：
 *   1. 窗口创建时（渲染层还没上报）先给一个不闪的值；
 *   2. 上报值缺失 / 非法时的兜底。
 *
 * 所以：**改色值改 CSS，不要改这里**。要让默认值也跟着变，改这两个常量即可，但两者
 * 不同步不会再造成色块——这正是这条改造要消灭的问题。
 *
 * `symbolColor` 是系统绘制的图标/悬停色，必须自己在任意底色上可读。
 */
const TITLEBAR_THEME = {
  light: { color: "#f5f7fa", symbolColor: "#3d4a5c" },
  dark: { color: "#151b23", symbolColor: "#c9d4e0" },
};

/**
 * 只接受**不透明**的 `#rrggbb`。
 *
 * alpha < 255 会让三颗按钮**连同字形一起消失**：Electron 在
 * `WinCaptionButtonContainer::UpdateBackground()` 里对 alpha < 255 调
 * `SetFillsBoundsOpaquely(false)`，整个按钮容器变成非不透明层（有项目正是靠这一点
 * 隐藏原生按钮）。2026-11-20 真机实测过 `color: "#00000000"`——按钮区一个深色像素都没有，
 * 窗口无法最小化/关闭。所以渲染层上报什么都要过这一关。
 */
const OPAQUE_COLOR = /^#[0-9a-f]{6}$/i;

/** @param {unknown} value @returns {boolean} 是否是不透明 `#rrggbb` */
function isOpaqueColor(value) {
  return typeof value === "string" && OPAQUE_COLOR.test(value.trim());
}

/** "system" 之类无法判定的值一律按浅色（应用初始主题也是浅色，避免启动闪深）。 */
function normalizeTheme(theme) {
  return theme === "dark" ? "dark" : "light";
}

/**
 * 把渲染层上报的载荷归一成形（形状校验，颜色格式由 `titleBarOverlayFor` 判）。
 *
 * 兼容两种形态：**字符串**（旧渲染层只报主题名）与 `{ theme, color, symbolColor }`
 * （2026-11-20 第 3 条之后的形态）。不是字符串也不是对象时按"未上报"处理。
 *
 * @param {unknown} input
 * @returns {{theme: "light" | "dark", color?: string, symbolColor?: string}}
 */
function normalizeThemePayload(input) {
  if (typeof input === "string") return { theme: normalizeTheme(input) };
  const source = input && typeof input === "object" ? input : {};
  const payload = { theme: normalizeTheme(source.theme) };
  if (typeof source.color === "string") payload.color = source.color;
  if (typeof source.symbolColor === "string") payload.symbolColor = source.symbolColor;
  return payload;
}

/**
 * 覆盖层选项：`height` 恒由 TITLEBAR_HEIGHT 给出；颜色取渲染层上报值，非法则回落默认值。
 *
 * @param {string} theme "light" / "dark" / "system"（后者按浅色）
 * @param {{color?: string, symbolColor?: string}} [colors] 渲染层上报的颜色（可只给一半）
 */
function titleBarOverlayFor(theme, colors) {
  const base = TITLEBAR_THEME[normalizeTheme(theme)];
  const pick = (key) => (isOpaqueColor(colors && colors[key]) ? colors[key].trim() : base[key]);
  return { color: pick("color"), symbolColor: pick("symbolColor"), height: TITLEBAR_HEIGHT };
}

/** titleBarOverlay 只有 Windows / Linux 支持；macOS 走红绿灯位置。 */
function supportsOverlay(platform) {
  return platform === "win32" || platform === "linux";
}

/**
 * BrowserWindow 的窗口壳选项（纯函数，可按平台断言）。
 * 不传 frame: false——titleBarStyle: "hidden" 在三个平台都保留窗口圆角/阴影/贴靠等系统行为。
 */
function windowChromeOptions({ platform = process.platform } = {}) {
  const options = { titleBarStyle: "hidden" };
  if (supportsOverlay(platform)) {
    options.titleBarOverlay = titleBarOverlayFor("light");
  } else if (platform === "darwin") {
    // 红绿灯默认贴左上角、会压在菜单文字上；React 侧同时留 78px 左内边距。
    options.trafficLightPosition = { x: 12, y: 10 };
  }
  return options;
}

/**
 * 主进程侧的标题栏控制器：窗口创建后读状态、主题变化时重刷覆盖层。
 *
 * @param {object} deps
 * @param {function(): (object|null)} deps.getWindow 当前主窗口
 * @param {string} [deps.platform] process.platform 的可注入替身
 * @param {function(string): void} [deps.logLine] 诊断日志
 */
function createTitleBarController(deps) {
  const { getWindow, platform = process.platform, logLine = () => {} } = deps;

  function liveWindow() {
    const win = getWindow();
    if (!win) return null;
    try {
      return win.isDestroyed() ? null : win;
    } catch {
      return null;
    }
  }

  /**
   * 主题上报（渲染进程经 IPC `desktop:set-theme`）：同步覆盖层配色。
   *
   * 载荷有两种形态（见 `normalizeThemePayload`）：旧渲染层的主题名字符串，或
   * `{ theme, color, symbolColor }`（2026-11-20 第 3 条起）。颜色必须是**不透明**
   * `#rrggbb`，否则回落默认值并留一条日志——静默回落会让"按钮消失"无从追查。
   *
   * 非 win32/linux 或 API 缺失时静默跳过（macOS 没有覆盖层）。
   *
   * @param {unknown} input 主题名字符串或 `{ theme, color, symbolColor }`
   * @returns {boolean} 是否真的写进了窗口
   */
  function applyTheme(input) {
    if (!supportsOverlay(platform)) return false;
    const win = liveWindow();
    if (!win || typeof win.setTitleBarOverlay !== "function") return false;
    const payload = normalizeThemePayload(input);
    const overlay = titleBarOverlayFor(payload.theme, payload);
    for (const key of ["color", "symbolColor"]) {
      if (payload[key] !== undefined && payload[key].trim() !== overlay[key]) {
        logLine(
          `titlebar: ignoring invalid ${key} ${JSON.stringify(payload[key])}; ` +
            `falling back to ${overlay[key]} (theme ${payload.theme})`,
        );
      }
    }
    try {
      win.setTitleBarOverlay(overlay);
      return true;
    } catch (err) {
      logLine(`titlebar: setTitleBarOverlay failed: ${err}`);
      return false;
    }
  }

  /** 当前窗口状态快照：渲染层用它在菜单里显示"最大化"还是"还原"，以及全屏时隐藏标题栏。 */
  function windowState() {
    const win = liveWindow();
    if (!win) return { maximized: false, fullscreen: false };
    try {
      return {
        maximized: Boolean(win.isMaximized && win.isMaximized()),
        fullscreen: Boolean(win.isFullScreen && win.isFullScreen()),
      };
    } catch {
      return { maximized: false, fullscreen: false };
    }
  }

  /** 最大化 / 还原 / 全屏状态变化时推给渲染层（React 菜单文案随之切换）。 */
  function sendWindowState() {
    const win = liveWindow();
    if (!win) return;
    try {
      win.webContents.send("desktop:window-state", windowState());
    } catch (err) {
      logLine(`titlebar: window state push failed: ${err}`);
    }
  }

  return {
    windowOptions: () => windowChromeOptions({ platform }),
    applyTheme,
    windowState,
    sendWindowState,
  };
}

/**
 * P1-1 方案 3 的最后一层兜底：加载完成后检查 `.app-titlebar` 到底有没有渲染出来。
 *
 * 为什么主进程也要管这件事：前两层（分流条件看 `window.splash.isDesktop`、`data-hidden`
 * 只信真实全屏事件）都在渲染层，而用户报的形态是"页面内容从 y=0 开始、三颗系统按钮压
 * 在页头/制作台操作条上、点击被吞（误点 = 最小化/关闭）"。一旦渲染层因为任何原因没渲染
 * 出标题栏（旧 dist、渲染异常、桥缺失），主进程是唯一还能补救的地方——补一条 padding，
 * 让内容整体让开 32px。补不上最多多一条缝，不补就是误关窗口。
 *
 * @param {object} deps
 * @param {object} deps.webContents 目标 webContents（需有 executeJavaScript / insertCSS）
 * @param {function(string): void} [deps.logLine] 诊断日志（写 desktop-main.log）
 * @returns {Promise<boolean>} true = 打了兜底
 */
function padForMissingTitleBar(deps) {
  const { webContents, logLine = () => {} } = deps || {};
  if (!webContents || typeof webContents.executeJavaScript !== "function") {
    return Promise.resolve(false);
  }
  const probe = () =>
    webContents.executeJavaScript("document.querySelector('.app-titlebar') !== null", true);
  return Promise.resolve(probe())
    .then((present) => {
      if (present) return false;
      // did-finish-load 早于 React 挂载：先给渲染层 800ms 把标题栏挂出来，
      // 免得把"还没挂载"误报成"旧 dist 没有标题栏"（2026-11-20 真机事故）。
      return new Promise((resolve) => setTimeout(resolve, 800)).then(probe);
    })
    .then((present) => {
      if (present) return false;
      // warning 级别：启动器与壳的诊断都是按 warning 收的，info 会被整条吞掉。
      logLine(
        `titlebar: .app-titlebar missing after load; applying ${TITLEBAR_HEIGHT}px body padding fallback`,
      );
      if (typeof webContents.insertCSS !== "function") return true;
      return Promise.resolve(webContents.insertCSS(titleBarFallbackCss())).then(() => true);
    })
    .catch((err) => {
      logLine(`titlebar: missing-titlebar check failed: ${err}`);
      return false;
    });
}

/**
 * 把上面那层兜底挂到**下一次** `did-finish-load` 上（在 loadURL 之前调用）。
 *
 * 挂在事件上而不是 loadURL 之后直接执行：loadURL 的 Promise 与 did-finish-load 的先后
 * 依赖 Electron 版本，而"document 已经就绪"是这条检查成立的前提。
 */
function installTitleBarFallbackOnLoad(deps) {
  const { webContents, logLine = () => {} } = deps || {};
  if (!webContents || typeof webContents.once !== "function") return;
  webContents.once("did-finish-load", () => {
    void padForMissingTitleBar({ webContents, logLine });
  });
}

module.exports = {
  TITLEBAR_HEIGHT,
  TITLEBAR_THEME,
  isOpaqueColor,
  normalizeTheme,
  normalizeThemePayload,
  titleBarOverlayFor,
  titleBarFallbackCss,
  supportsOverlay,
  windowChromeOptions,
  createTitleBarController,
  padForMissingTitleBar,
  installTitleBarFallbackOnLoad,
};
