// SPDX-License-Identifier: Apache-2.0
"use strict";

// 桌面系统通知通道（CR-24）。
//
// 为什么需要它：渲染层的 Web Notification 依赖 `Notification.permission === "granted"`，
// 而全仓没有 requestPermission，桌面壳里这个权限永远是 "default"——那条路从不执行。
// 系统通知必须由主进程发；本模块就是唯一通道。
//
// 为什么在 lib/：`desktop/main.js` 正好贴着 500 行预算。本模块不 require("electron")，
// Notification / app / ipcMain / 窗口全部注入，离线用例可以塞假对象（见
// scripts/test-notification-channel.js）。
//
// 口径（§9）：`silent: true`（提示音统一由渲染层 WebAudio 出，避免双响）；v1 只做
// "点击跳转"，通知上不加按钮；同 dedupeKey 60 秒内只发一条；窗口聚焦且可见时不发。

/**
 * Windows toast 的身份（AUMID）。必须与 `desktop/electron-builder.yml` 的 appId
 * 完全一致——写错会显示成 "Electron"，且很难排查。
 */
const APP_USER_MODEL_ID = "top.huangcenguo.resumeforge";

/** 同一件事（dedupeKey）在窗口内只提醒一次。 */
const DEDUPE_WINDOW_MS = 60_000;

/** 把任意输入收敛成非负整数（角标只接受这个形状）。 */
function normalizeCount(value) {
  const number = Number(value);
  if (!Number.isFinite(number)) return 0;
  return Math.max(0, Math.trunc(number));
}

/**
 * 创建通知通道（不注册 IPC；调用 `install()` 才接上通道）。
 *
 * @param {object} deps
 * @param {object} deps.app Electron app（setAppUserModelId / setBadgeCount）
 * @param {object} deps.Notification Electron Notification 构造器（含 isSupported）
 * @param {object} deps.ipcMain Electron ipcMain
 * @param {function(): (object|null)} deps.getWindow 当前主窗口
 * @param {function(): (object|null)} [deps.getTrayManager] 托盘管理器（setPendingCount）
 * @param {string} [deps.platform] 覆盖 process.platform（用例注入 darwin）
 * @param {function(): number} [deps.now] 覆盖时钟（用例控制 60s 节流）
 * @param {function(string): void} [deps.logLine]
 */
function createNotificationChannel(deps) {
  const {
    app,
    Notification,
    ipcMain,
    getWindow,
    getTrayManager = () => null,
    platform = process.platform,
    now = () => Date.now(),
    logLine = () => {},
  } = deps || {};

  // AUMID 只在 Windows 有意义，而且必须在应用启动早期设置一次。
  if (platform === "win32" && app && typeof app.setAppUserModelId === "function") {
    try {
      app.setAppUserModelId(APP_USER_MODEL_ID);
    } catch (error) {
      logLine(`notification: setAppUserModelId failed: ${error && error.message ? error.message : error}`);
    }
  }

  /** dedupeKey -> 上次真正弹通知的时间戳。 */
  const lastShownAt = new Map();
  let installed = false;

  function currentWindow() {
    const window = typeof getWindow === "function" ? getWindow() : null;
    if (!window) return null;
    try {
      if (typeof window.isDestroyed === "function" && window.isDestroyed()) return null;
      return window;
    } catch {
      return null;
    }
  }

  /** 窗口在前台且可见：应用内 toast 已经能看见，不再发系统通知。 */
  function windowIsActive() {
    const window = currentWindow();
    if (!window) return false;
    try {
      const focused = typeof window.isFocused === "function" ? window.isFocused() : false;
      const visible = typeof window.isVisible === "function" ? window.isVisible() : false;
      return Boolean(focused && visible);
    } catch {
      return false;
    }
  }

  /** 点击通知：先恢复/唤起窗口，再把 deep_link 推给渲染层。 */
  function focusWindow() {
    const window = currentWindow();
    if (!window) return null;
    try {
      if (typeof window.isMinimized === "function" && window.isMinimized()) {
        window.restore();
      }
      window.show();
      window.focus();
    } catch {
      // 窗口已销毁（退出流程中）：只把 deep_link 发出去，能收到就收。
    }
    return window;
  }

  /**
   * 发一条系统通知。
   *
   * @param {{title: string, body?: string, deepLink?: string|null, dedupeKey?: string|null}} payload
   * @returns {{shown: boolean, reason?: string}}
   */
  function show(payload) {
    const data = payload || {};
    const title = String(data.title || "").trim();
    if (!title) return { shown: false, reason: "empty" };
    if (typeof Notification !== "function") return { shown: false, reason: "unsupported" };
    try {
      if (typeof Notification.isSupported === "function" && !Notification.isSupported()) {
        return { shown: false, reason: "unsupported" };
      }
    } catch {
      return { shown: false, reason: "unsupported" };
    }
    if (windowIsActive()) return { shown: false, reason: "focused" };

    const dedupeKey = data.dedupeKey ? String(data.dedupeKey) : null;
    if (dedupeKey) {
      const previous = lastShownAt.get(dedupeKey);
      const stamp = now();
      if (previous !== undefined && stamp - previous < DEDUPE_WINDOW_MS) {
        return { shown: false, reason: "throttled" };
      }
      lastShownAt.set(dedupeKey, stamp);
    }

    let notification;
    try {
      notification = new Notification({
        title,
        body: String(data.body || ""),
        silent: true,
      });
    } catch (error) {
      logLine(`notification: create failed: ${error && error.message ? error.message : error}`);
      return { shown: false, reason: "error" };
    }
    notification.on("click", () => {
      const window = focusWindow();
      try {
        window?.webContents?.send("notify:click", data.deepLink ?? null);
      } catch (error) {
        logLine(`notification: click forward failed: ${error && error.message ? error.message : error}`);
      }
    });
    try {
      notification.show();
    } catch (error) {
      logLine(`notification: show failed: ${error && error.message ? error.message : error}`);
      return { shown: false, reason: "error" };
    }
    return { shown: true };
  }

  /**
   * 同步角标与托盘 tooltip。计数由渲染层算（未读 + 待确认；取不到就传 0）。
   *
   * `app.setBadgeCount` 在 Windows 上可能不支持（返回 false），此时仍更新托盘
   * tooltip——那是 Windows 上看得见的那一处。
   */
  function setBadge(rawCount) {
    const count = normalizeCount(rawCount);
    let applied = false;
    if (app && typeof app.setBadgeCount === "function") {
      try {
        applied = app.setBadgeCount(count) !== false;
      } catch (error) {
        logLine(`notification: setBadgeCount failed: ${error && error.message ? error.message : error}`);
      }
    }
    const tray = typeof getTrayManager === "function" ? getTrayManager() : null;
    if (tray && typeof tray.setPendingCount === "function") {
      try {
        tray.setPendingCount(count);
      } catch (error) {
        logLine(`notification: tray count failed: ${error && error.message ? error.message : error}`);
      }
    }
    return applied;
  }

  /** 接上渲染层通道（只注册固定两个，不接受任意通道名）。 */
  function install() {
    if (installed) return true;
    if (!ipcMain || typeof ipcMain.handle !== "function") return false;
    ipcMain.handle("notify:show", (_event, payload) => show(payload));
    ipcMain.handle("notify:set-badge", (_event, count) => setBadge(count));
    installed = true;
    return true;
  }

  return { show, setBadge, install, APP_USER_MODEL_ID };
}

module.exports = { APP_USER_MODEL_ID, DEDUPE_WINDOW_MS, createNotificationChannel };
