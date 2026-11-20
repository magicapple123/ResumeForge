// SPDX-License-Identifier: Apache-2.0
"use strict";

// 更新过程中**给用户的反馈**（2026-11-20 第二轮，第 9.2 / 9.3 / 9.4 条）。
//
// 为什么单独一个文件：updater.js 本来就在 500 行预算内（`_DESKTOP_EXEMPTIONS` 是空的，
// `backend/tests/test_file_size_budget.py::test_desktop_files_stay_under_line_budget`
// 会扫 `desktop/**/*.js`），而这一批要加的东西全是"怎么告诉用户"——
// 六种原生对话框 + 任务栏进度条 + 启动对账。把它们和"怎么下载/校验"分开之后，
// updater.js 只剩流程，文案与窗口副作用都在这里。
//
// 三条硬约束（都是踩过的坑）：
//   1. **不 require("electron")**：dialog / shell / app 全部由 updater.js 注入，
//      离线用例可以直接构造假对象（与 lib/quit-lifecycle.js 同一条约定）。
//   2. **语言来自壳层的 `getLocale()`**（应用内语言），与 lib/quit-lifecycle.js 一致；
//      没注入时才回落到系统语言，那只是让 dev 入口 / 用例不炸。
//   3. **对话框弹出前先把窗口带回前台**（revealWindow）：窗口可能正藏在托盘里，
//      对话框跟着一个看不见的窗口 = 用户永远看不到更新提示（实测缺陷②）。
//
// 文案表在 lib/shell-locale.js（"update.*"）。本文件里出现的中文只有注释。

const { resolveShellLocale, t } = require("./shell-locale");
const {
  clearUpdateAttempt,
  reconcileUpdateAttempt: reconcileAttemptFile,
} = require("./update-attempt");

/** 发布页：所有"手动下载"出口都指向它（与更新器检查的是同一个仓库）。 */
const RELEASES_PAGE = "https://github.com/magicapple123/ResumeForge/releases/latest";

/**
 * 当前用户可见文案的语言。
 *
 * @param {{getLocale?: function(): string}} deps
 * @param {object} app Electron app（只在没注入 getLocale 时才碰）
 * @returns {"zh" | "en"}
 */
function resolveLocale(deps, app) {
  const injected = deps && typeof deps.getLocale === "function" ? deps.getLocale() : null;
  if (injected === "zh" || injected === "en") return injected;
  try {
    return resolveShellLocale(app.getLocale());
  } catch {
    return "en";
  }
}

/**
 * 装配一组"更新反馈"出口。
 *
 * @param {{app: object, dialog: object, shell: object}} electron Electron 的三个模块
 *   （注入而不是 require，见文件头约束 1）
 * @param {{getLocale?: function(): string, getLogDir?: function(): (string|null),
 *   logLine?: function(string): void}} [deps]
 * @returns {object} 见下方返回对象
 */
function createUpdateFeedback(electron, deps = {}) {
  const { app, dialog, shell } = electron || {};
  const log = typeof deps.logLine === "function" ? deps.logLine : () => {};

  const locale = () => resolveLocale(deps, app);

  /**
   * 窗口可能正藏在托盘里：弹任何更新对话框之前先把它带回来并抢焦点。
   * 窗口为 null / 已销毁时返回 null，调用方退化为无 parent 的弹窗（对话框仍会显示）。
   */
  function revealWindow(parentWindow) {
    if (!parentWindow || typeof parentWindow.isDestroyed !== "function") return null;
    try {
      if (parentWindow.isDestroyed()) return null;
      if (typeof parentWindow.isMinimized === "function" && parentWindow.isMinimized()) {
        parentWindow.restore();
      }
      parentWindow.show();
      parentWindow.focus();
      return parentWindow;
    } catch {
      // 任何窗口操作失败都不该拦住对话框本身。
      return null;
    }
  }

  function show(parentWindow, options) {
    const target = revealWindow(parentWindow);
    return target ? dialog.showMessageBox(target, options) : dialog.showMessageBox(options);
  }

  /** 更新失败对话框里「打开日志」的目标目录。 */
  function resolveLogTarget() {
    if (typeof deps.getLogDir === "function") {
      try {
        const dir = deps.getLogDir();
        if (dir) return dir;
      } catch {
        // 落到下面的 app.getPath("logs")。
      }
    }
    try {
      return app.getPath("logs");
    } catch {
      return null;
    }
  }

  /**
   * 任务栏进度条（第 9.4 条）：188 MB 的安装包在慢网下要几分钟，全程无反馈时用户
   * 以为卡死了。`total` 未知（服务端没给 Content-Length）时**不动**——算不出比例，
   * 宁可没有，也不要拿"0%"骗人。
   */
  function progress(parentWindow, received, total) {
    if (!total || total <= 0) return;
    setProgress(parentWindow, Math.min(received / total, 1));
  }

  /** ratio < 0 清除进度条。窗口可能已隐藏 / 已销毁，一律判空 + try/catch。 */
  function setProgress(parentWindow, ratio) {
    if (!parentWindow || typeof parentWindow.setProgressBar !== "function") return;
    try {
      if (typeof parentWindow.isDestroyed === "function" && parentWindow.isDestroyed()) return;
      parentWindow.setProgressBar(ratio);
    } catch {
      // 进度条只是锦上添花，绝不能打断下载流程。
    }
  }

  /**
   * 启动对账（第 9.2 条）：上一次"下载校验都过了但没装成"的更新，这次要告诉用户。
   *
   * 判定在 lib/update-attempt.js（纯函数 + 文件读写，有离线用例）；
   * 三种结论见那里的注释。提示**只用一次**：弹完就删标记，否则每次启动都会重复弹
   * 同一件事，而用户已经被告知过了；下一次真正尝试安装会重新写一份。
   */
  async function reconcile(parentWindow) {
    let userDataDir = null;
    try {
      userDataDir = app.getPath("userData");
    } catch {
      return { status: "none", attempt: null };
    }
    if (!userDataDir) return { status: "none", attempt: null };
    const result = reconcileAttemptFile(userDataDir, app.getVersion());
    if (result.status !== "failed" || !result.attempt) return result;

    const attempt = result.attempt;
    log(`update attempt did not install: ${attempt.from} -> ${attempt.to} (installer ${attempt.installer})`);
    const logDir = resolveLogTarget();
    const zhOrEn = locale();
    let choice = null;
    try {
      choice = await show(parentWindow, {
        type: "warning",
        message: t(zhOrEn, "update.failed.message"),
        detail: logDir
          ? t(zhOrEn, "update.failed.body", { from: attempt.from, to: attempt.to, logDir })
          : t(zhOrEn, "update.failed.bodyNoLog", { from: attempt.from, to: attempt.to }),
        buttons: [
          t(zhOrEn, "update.failed.button.download"),
          t(zhOrEn, "update.failed.button.openLogDir"),
          t(zhOrEn, "update.failed.button.ack"),
        ],
        defaultId: 0,
        // 「知道了」只是关掉提示，不该被当成"再来一次"。
        cancelId: 2,
      });
    } catch {
      choice = null;
    }
    clearUpdateAttempt(userDataDir);
    if (choice && choice.response === 0) {
      try {
        if (shell && typeof shell.openExternal === "function") await shell.openExternal(RELEASES_PAGE);
      } catch {
        log("update attempt: openExternal failed");
      }
    } else if (choice && choice.response === 1 && logDir) {
      try {
        if (shell && typeof shell.openPath === "function") await shell.openPath(logDir);
      } catch {
        log(`update attempt: openPath failed: ${logDir}`);
      }
    }
    return result;
  }

  return {
    locale,
    revealWindow,
    // ---- 对话框（文案全在 lib/shell-locale.js） --------------------------------
    /** 发现新版本：授权"下载 → 校验 → 安装 → 重开"全程，并说明数据不会被动。 */
    confirm: (parentWindow, version) =>
      show(parentWindow, {
        type: "info",
        message: t(locale(), "update.available.message", { version }),
        detail: t(locale(), "update.available.body"),
        buttons: [t(locale(), "update.button.install"), t(locale(), "update.button.later")],
        defaultId: 0,
        cancelId: 1,
      }),
    /** 发布页缺附件（手动检查才弹；自动检查保持安静）。 */
    incomplete: (parentWindow, version, missing) =>
      show(parentWindow, {
        type: "warning",
        message: t(locale(), "update.incomplete.message"),
        detail: t(locale(), "update.incomplete.body", { version, missing }),
        buttons: [t(locale(), "update.button.ok")],
      }).catch(() => undefined),
    /** 手动检查且已是最新。 */
    upToDate: (parentWindow, version) =>
      show(parentWindow, {
        type: "info",
        message: t(locale(), "update.upToDate.message"),
        detail: t(locale(), "update.upToDate.body", { version }),
        buttons: [t(locale(), "update.button.ok")],
      }),
    /** macOS 没有 NSIS 安装器协议：如实引导到发布页，不假装能静默升级。 */
    manualMac: () =>
      dialog
        .showMessageBox({
          type: "info",
          message: t(locale(), "update.manual.message"),
          detail: t(locale(), "update.manual.body"),
          buttons: [t(locale(), "update.button.openReleases"), t(locale(), "update.button.close")],
          defaultId: 0,
          cancelId: 1,
        })
        .then((result) => {
          if (result.response === 0) shell.openExternal(RELEASES_PAGE);
        })
        .catch(() => {}),
    /** 检查更新本身失败（网络 / 403 / 域名白名单）。 */
    errorBox: (reason) => {
      try {
        dialog.showErrorBox(
          t(locale(), "update.error.title"),
          t(locale(), "update.error.body", { reason }),
        );
      } catch {
        // 对话框弹不出来也不能影响退出/重试。
      }
    },
    // ---- 非对话框反馈 ---------------------------------------------------------
    progress,
    clearProgress: (parentWindow) => setProgress(parentWindow, -1),
    reconcile,
  };
}

module.exports = { RELEASES_PAGE, createUpdateFeedback, resolveLocale };
