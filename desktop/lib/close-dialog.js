// SPDX-License-Identifier: Apache-2.0
"use strict";

// 自绘关闭卡片（Q11）：只负责"窗口怎么弹"，**不做任何决策**。
//
// 为什么不用原生 MessageBox：标题栏、蓝色 i 图标、按钮描边、复选框全由 Windows 画，
// `showMessageBox` 的参数里只有 type / noLink / checkboxLabel，没有任何旋钮能改外观。
//
// 五条硬约束（少一条就退化）：
// 1. 弹窗未关时再点 × 不叠窗 —— 由 close-behavior 的 `promptOpen` 守卫负责，这里只保证
//    同一时刻只有一个窗口实例；
// 2. Esc = 最小化到托盘 —— 在 HTML 里绑 keydown（不是取消退出）；
// 3. `parent + modal + frame:false + resizable:false + skipTaskbar`，主窗口 closed 时
//    连带 `destroy()`，否则留孤儿框；
// 4. 加载失败由调用方（close-behavior 的 catch）回落到最小化，**不要改成退出**；
// 5. 深色主题自己跟：HTML 用 `prefers-color-scheme`，与 `nativeTheme.shouldUseDarkColors`
//    同源（Windows 上两者都取系统设置）。

const path = require("node:path");
const { pathToFileURL } = require("node:url");

/**
 * 造一个 `promptClose(win, { isMac }) => Promise<{action:"hide"|"quit", remember:boolean}>`。
 *
 * @param {object} deps
 * @param {object} deps.BrowserWindow Electron BrowserWindow 构造器
 * @param {object} deps.ipcMain Electron ipcMain
 * @param {function(): (object|null)} deps.getWindow 当前主窗口
 * @param {string} deps.dirname 本文件所在目录（用于定位 html / preload）
 * @param {function(string): void} [deps.logLine]
 */
function createClosePrompt(deps) {
  const { BrowserWindow, ipcMain, getWindow, dirname, logLine = () => {} } = deps;
  let pendingWindow = null;

  // 只注册一次：处理器内部按 `pendingWindow` 找当前实例。
  ipcMain.handle("close-dialog:platform", () => process.platform === "darwin");
  ipcMain.on("close-dialog:resolve", (event, payload) => {
    const win = pendingWindow;
    if (!win) return;
    // 只接受自己那个窗口发来的消息：其它渲染层（主窗口）不该能替用户点这个框。
    if (event.sender !== win.webContents) return;
    const action = payload && payload.action === "quit" ? "quit" : "hide";
    const remember = Boolean(payload && payload.remember);
    const resolve = win.__rfResolve;
    closeWindow(win);
    if (resolve) resolve({ action, remember });
  });

  function closeWindow(win) {
    pendingWindow = null;
    try {
      if (!win.isDestroyed()) win.destroy();
    } catch (error) {
      logLine(`close-dialog: destroy failed: ${error}`);
    }
  }

  return function promptClose(parent, options = {}) {
    const isMac = Boolean(options.isMac);
    return new Promise((resolve, reject) => {
      const host = parent && !parent.isDestroyed() ? parent : getWindow();
      if (!host) {
        reject(new Error("no parent window"));
        return;
      }
      const win = new BrowserWindow({
        width: 420,
        height: isMac ? 236 : 244,
        parent: host,
        modal: true,
        frame: false,
        resizable: false,
        minimizable: false,
        maximizable: false,
        fullscreenable: false,
        skipTaskbar: true,
        show: false,
        backgroundColor: "#00000000",
        webPreferences: {
          preload: path.join(dirname, "..", "close-dialog-preload.js"),
          contextIsolation: true,
          nodeIntegration: false,
          sandbox: true,
        },
      });
      win.__rfResolve = resolve;
      pendingWindow = win;

      // 主窗口被销毁（例如用户在别处退出）：连带销毁，别留一个孤儿框。
      const onParentClosed = () => closeWindow(win);
      try {
        host.once("closed", onParentClosed);
      } catch {
        // 某些环境下拿不到事件接口：下面的 loadFile catch 仍然兜底。
      }
      win.once("closed", () => {
        try {
          host.removeListener("closed", onParentClosed);
        } catch {
          // 忽略：窗口已经没了。
        }
        if (pendingWindow === win) pendingWindow = null;
      });

      const file = path.join(dirname, "..", "close-dialog.html");
      win
        .loadURL(pathToFileURL(file).href)
        .then(() => {
          win.show();
          win.focus();
        })
        .catch((error) => {
          logLine(`close-dialog: load failed: ${error}`);
          // 调用方的 catch 会把失败回落成"最小化到托盘"（可逆、不丢数据）。
          closeWindow(win);
          reject(error);
        });
    });
  };
}

module.exports = { createClosePrompt };
