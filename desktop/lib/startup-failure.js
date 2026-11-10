// SPDX-License-Identifier: Apache-2.0
"use strict";

// 启动失败的可操作出口（从 main.js 下沉；日志失效链修复的一部分）。
//
// 启动图上的红框只有一行原因和一个需要手动复制的路径，用户拿它没办法。这里收尾成
// 一个**带按钮**的原生对话框：「打开日志目录」/「退出」。刻意不用
// dialog.showErrorBox——它不能带按钮（崩溃预算那条用它是对的：那条路没有可操作的
// 下一步）。
//
// 两个按钮都以退出收尾：「打开日志目录」只是让日志可见，失败本身没有修复，而留在
// 托盘里的进程会让下一次启动撞上单实例锁、再失败一次。所以必须在 app.quit() 之前
// 先置 quitting（由注入的 setQuitting 完成），否则窗口 close handler 会把窗口藏进
// 托盘，quit 永远走不完——这正是"退不掉"的成因。
//
// 不 require("electron")：离线用例直接注入假 dialog / shell，断言失败路径的失败路径
//（对话框被系统策略挡掉、Electron 没有 showMessageBoxSync、openPath 报错/拒绝）都
// 仍然退出。

/**
 * @param {object} deps
 * @param {object} deps.dialog Electron dialog（只用到 showMessageBoxSync 与 showErrorBox）
 * @param {object} deps.shell Electron shell（openPath；可能不存在）
 * @param {function(string): void} deps.logLine 诊断日志
 * @param {function(string, (string|undefined)): void} deps.sendStage 启动图阶段推送
 * @param {function(): (string|null)} deps.getLogDir 日志目录；不可写时 null
 * @param {function(boolean): void} deps.setQuitting 写主进程的 quitting 标志
 * @param {object} deps.app Electron app（quit）
 * @returns {function(Error|string): void}
 */
function createStartupFailureReporter(deps) {
  const { dialog, shell, logLine, sendStage, getLogDir, setQuitting, app } = deps;

  return function reportStartupFailure(err) {
    const message = err && err.message ? err.message : String(err);
    logLine(`startup failed: ${message}`);
    // 双保险：对话框被系统策略静默掉时，启动图仍然显示错误原因。
    sendStage("error", message);
    const logDir = getLogDir();
    // 默认取「退出」：连对话框都弹不出来时必须收摊，不能留在半启动状态。
    let choice = 1;
    if (typeof dialog.showMessageBoxSync === "function") {
      try {
        choice = dialog.showMessageBoxSync({
          type: "error",
          title: "简历通",
          message: "启动失败",
          detail:
            `${message}\n\n` +
            (logDir
              ? "诊断日志目录：\n" +
                `${logDir}\n\n` +
                "把这里的 desktop-main.log 与 desktop-backend.log 提供给维护者，" +
                "可以定位这次启动失败。"
              : "本次运行没能写下诊断日志（安装目录与系统临时目录都不可写）。"),
          buttons: ["打开日志目录", "退出"],
          defaultId: 0,
          cancelId: 1,
          noLink: true,
        });
      } catch (dialogError) {
        logLine(`startup failure dialog unavailable: ${dialogError}`);
      }
    }
    if (choice === 0 && logDir && shell && typeof shell.openPath === "function") {
      // openPath 用"返回错误字符串"而不是抛异常来报告失败；打不开不改变下的结论。
      Promise.resolve(shell.openPath(logDir)).catch((openError) =>
        logLine(`open log dir failed: ${openError}`),
      );
    }
    // 必须先置 quitting：否则 createWindow 的 close handler 会 preventDefault。
    setQuitting(true);
    app.quit();
  };
}

module.exports = { createStartupFailureReporter };
