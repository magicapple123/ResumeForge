// SPDX-License-Identifier: Apache-2.0
"use strict";

// 窗口 × 的关闭行为（问题清单 §18 + 2026-11-20 的"真开关"）：不再"静默藏进托盘"，
// 而是弹一次二选一，并允许用户记住选择。lift 成独立模块的原因与 quit-lifecycle.js
// 相同——main.js 已经贴着 500 行预算，而这里有几条**必须离线可断言**的分支：
//
//   1. quitting 为真时 close 必须放行（托盘退出 / 更新安装 / 启动失败收尾都靠它）；
//   2. 选「退出应用」必须**先 setQuitting(true) 再 app.quit()**，否则 app.quit()
//      触发的 close 又被当成"用户点了 ×"再弹一次，形成无限弹窗；
//   3. 偏好文件损坏 / 字段非法一律当作"还要询问"——宁可多问一次，不要误退；
//   4. 弹窗未关闭时再次 close 直接忽略，不叠出第二个 dialog。
//
// 偏好模型（2026-11-20 升级，托盘里那项从此是**真开关**，不是"有没有记住动作"的镜像）：
//
//   { "ask": true | false, "action": "minimize" | "quit" | null }
//
//   * `ask === true`  → 每次点 × 都弹卡片（默认）；
//   * `ask === false` → 直接执行 `action`；**`action` 为空时最小化到托盘**
//     （用户 2026-11-20 选定：取消询问 ≠ 允许误退）。
//   * 卡片上勾「记住我的选择」→ 写 `{ask:false, action:<本次选择>}`，两个按钮都生效。
//
// 旧文件迁移：`{ "remembered": "quit" }` → `{ ask: false, action: "quit" }`。
// 文件落在 app.getPath("userData")/close-behavior.json（与 window-state.js 同一处，
// 绝不写进仓库目录：升级/卸载会丢，而"记住的选择"属于用户配置）。

const fs = require("node:fs");
const path = require("node:path");

/** 偏好文件：{ "ask": boolean, "action": "minimize" | "quit" | null }。 */
const PREFERENCE_FILE = "close-behavior.json";
/** `action` 的两个取值（也是卡片按钮的语义：最小化到托盘 / 退出应用）。 */
const REMEMBER_MINIMIZE = "minimize";
const REMEMBER_QUIT = "quit";
/** 缺省：询问，且没有记住的动作。 */
const DEFAULT_STATE = Object.freeze({ ask: true, action: null });

/** 只接受两个已知动作；其余（缺字段 / 拼错 / 数字）一律当作"没有动作"。 */
function normalizeAction(value) {
  return value === REMEMBER_MINIMIZE || value === REMEMBER_QUIT ? value : null;
}

/**
 * 把磁盘上的任意形状收敛成 `{ ask, action }`。
 *
 * - 损坏 / 缺失 → 询问（宁可多问一次）；
 * - 旧格式（没有 `ask` 字段，只有 `remembered`）→ `{ ask: false, action }` 迁移；
 * - `ask` 只认明确的 `false`，其它值（"no"、0、缺失）都按询问处理。
 */
function normalizeState(raw) {
  if (!raw || typeof raw !== "object" || Array.isArray(raw)) return { ...DEFAULT_STATE };
  if (!Object.prototype.hasOwnProperty.call(raw, "ask")) {
    const legacy = normalizeAction(raw.remembered);
    return legacy ? { ask: false, action: legacy } : { ...DEFAULT_STATE };
  }
  return { ask: raw.ask !== false, action: normalizeAction(raw.action) };
}

/** 读偏好：任何异常（不存在 / 权限 / JSON 坏）一律缺省，绝不抛。 */
function readState(file) {
  try {
    return normalizeState(JSON.parse(fs.readFileSync(file, "utf8")));
  } catch {
    return { ...DEFAULT_STATE };
  }
}

/** 写偏好：失败静默（磁盘满 / 只读 / 目录不存在）。返回是否写成功。 */
function writeState(file, state) {
  const normalized = normalizeState(state);
  try {
    fs.mkdirSync(path.dirname(file), { recursive: true });
    fs.writeFileSync(file, `${JSON.stringify(normalized, null, 2)}\n`, "utf8");
    return true;
  } catch {
    return false;
  }
}

/**
 * 写「关闭窗口时询问」开关（托盘里那一项）。
 *
 * 只改 `ask`，保留 `action`：把询问重新打开只是"以后每次都问"，没必要顺手丢掉
 * 上次记住的动作（下次取消勾选时还能沿用）。
 */
function writeAsk(file, ask) {
  const current = readState(file);
  return writeState(file, { ask: Boolean(ask), action: current.action });
}

/** 记住本次选择 = 关掉询问 + 记下动作（卡片的「记住我的选择」走这里）。 */
function rememberAction(file, choice) {
  const action = normalizeAction(choice);
  if (!action) return false;
  return writeState(file, { ask: false, action });
}

/** 给主进程用的读写句柄：文件位置只有一个出处（userData 根），调用方不拼路径。 */
function createPreferenceStore({ app }) {
  const file = () => path.join(app.getPath("userData"), PREFERENCE_FILE);
  return {
    readState: () => readState(file()),
    writeAsk: (ask) => writeAsk(file(), ask),
    rememberAction: (choice) => rememberAction(file(), choice),
    getAsk: () => readState(file()).ask,
    getAction: () => readState(file()).action,
  };
}

/**
 * 关闭处理器（main.js 只装配，决策都在这里）。
 *
 * 依赖全部注入：本模块不 require("electron")，桌面离线用例（node --test）与
 * lifecycle-harness 的 VM 探针才能用假 dialog / 假 window 断言整条分支。
 *
 * @param {object} deps
 * @param {object} deps.app Electron app（只用于 quit()）
 * @param {function(object, object): Promise<{action: string, remember: boolean}>} deps.promptClose
 *   自绘关闭卡片（lib/close-dialog.js）。**决策仍在本模块**：它只返回用户点了什么。
 * @param {function(): (object|null)} deps.getWindow 当前主窗口
 * @param {function(): boolean} deps.isQuitting 是否已在退出流程中
 * @param {function(boolean): void} deps.setQuitting 写 main.js 的 quitting 标志
 * @param {object} deps.store 偏好读写句柄（createPreferenceStore）
 * @param {string} [deps.platform] process.platform 的可注入替身
 * @param {function(string): void} [deps.logLine] 诊断日志
 * @param {function(): void} [deps.onPreferenceChanged] 偏好变化后刷新托盘 tooltip/勾选态
 * @returns {{handleClose: function(object): boolean, getAsk: function(): boolean,
 *   setAsk: function(boolean): boolean, getAction: function(): (string|null),
 *   isPromptOpen: function(): boolean}}
 */
function createCloseBehavior(deps) {
  const {
    app,
    promptClose,
    getWindow,
    isQuitting,
    setQuitting,
    store,
    platform = process.platform,
    logLine = () => {},
    onPreferenceChanged = () => {},
  } = deps;

  // 弹窗未关闭时再点 × 直接忽略：否则连点会叠出多个模态框，且第一个的结果
  // 落地时窗口状态已经变了。
  let promptOpen = false;

  function liveWindow() {
    const win = getWindow();
    if (!win) return null;
    try {
      return win.isDestroyed() ? null : win;
    } catch {
      return null;
    }
  }

  function hideToTray(win) {
    // hide 失败（窗口已销毁）没有补救动作；关窗路径上也不该抛给 Electron。
    try {
      win.hide();
    } catch (err) {
      logLine(`close-behavior: hide failed: ${err}`);
    }
  }

  function quitNow() {
    // 顺序不可交换：app.quit() 会再次触发窗口 close，只有先置位才能让
    // handleClose 走"放行"分支，不然就是无限弹窗（§18.3-1）。
    setQuitting(true);
    app.quit();
  }

  /**
   * 问一次用户。
   *
   * **二次确认已折叠进自绘卡片的视图 2**（勾了记住 + 选退出时才出现），所以这里只处理
   * "用户最终选了什么 / 要不要记住"——两个按钮都会带 `remember`，决策逻辑与自绘前一致。
   */
  async function prompt(win) {
    const isMac = platform === "darwin";
    // Windows / Linux 用"最小化到托盘"；macOS 没有这种托盘惯例，退化为"关闭窗口"
    //（应用留在 Dock，菜单栏图标仍可重新打开）。口径由卡片按 `isMac` 自己渲染。
    const result = await promptClose(win, { isMac });
    const quit = Boolean(result && result.action === "quit");
    if (result && result.remember) {
      // 卡片只在"记住 + 退出"时走二次确认，所以能到这里就是用户确认过了。
      if (store.rememberAction(quit ? REMEMBER_QUIT : REMEMBER_MINIMIZE)) onPreferenceChanged();
    }
    if (quit) quitNow();
    else hideToTray(win);
  }

  /**
   * 窗口 close 事件入口。
   *
   * @returns {boolean} true = 放行默认关闭（仅 quitting 时）；false = 已 preventDefault。
   */
  function handleClose(event) {
    if (isQuitting()) return true;
    event.preventDefault();
    const win = liveWindow();
    if (!win) return false;
    const state = store.readState();
    if (state.ask === false) {
      if (state.action === REMEMBER_QUIT) {
        quitNow();
        return false;
      }
      // action 为空 = 用户只关掉了"询问"，没指定动作：最小化到托盘（可逆、不丢数据）。
      hideToTray(win);
      return false;
    }
    if (promptOpen) return false;
    promptOpen = true;
    prompt(win)
      .catch((err) => {
        // 对话框弹不出来时不能把窗口留在"关不掉"的状态：退化为最小化到托盘
        //（可逆、不丢数据），而不是静默退出。
        logLine(`close-behavior: prompt failed: ${err}`);
        hideToTray(win);
      })
      .finally(() => {
        promptOpen = false;
      });
    return false;
  }

  /** 托盘「关闭窗口时询问」的当前状态（真开关，不再是"有没有记住动作"的镜像）。 */
  function getAsk() {
    return store.getAsk();
  }

  /** 勾上 / 取消勾选。返回是否落盘成功（失败时托盘下次打开仍是旧值）。 */
  function setAsk(ask) {
    const ok = store.writeAsk(Boolean(ask));
    if (ok) onPreferenceChanged();
    return ok;
  }

  function getAction() {
    return store.getAction();
  }

  return {
    handleClose,
    getAsk,
    setAsk,
    getAction,
    isPromptOpen: () => promptOpen,
  };
}

module.exports = {
  DEFAULT_STATE,
  PREFERENCE_FILE,
  REMEMBER_MINIMIZE,
  REMEMBER_QUIT,
  normalizeAction,
  normalizeState,
  readState,
  writeState,
  writeAsk,
  rememberAction,
  createPreferenceStore,
  createCloseBehavior,
};
