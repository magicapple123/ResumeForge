// SPDX-License-Identifier: Apache-2.0
"use strict";

// 「等主进程退出，再静默运行安装器」的 PowerShell 命令构造（纯函数，可离线断言）。
//
// 2026-11-20 从 updater.js 下沉到这里：updater.js 贴着 500 行预算
// （backend/tests/test_file_size_budget.py 的 desktop 扫描没有豁免），而这段的注释
// 比代码还长——它记的是一条**严重**缺陷的根因，不能压缩。
//
// 两条约束（都来自实测）：
//
// 1. **必须等主进程 pid 退出**。NSIS 静默安装会覆盖 shell 的程序文件；在 Electron
//    进程还活着、exe 句柄未释放时启动安装会撞锁静默失败（实测缺陷③）。所以安装器
//    由 main.js 交给一个脱离的 PowerShell 等待进程：先 `Wait-Process`，再 `Start-Process`。
//    `-ErrorAction SilentlyContinue` 兜住"pid 恰好已经退出"的竞态。
//
// 2. **必须带 `--force-run`（第 9.1 条，严重）**。本项目是 assisted 安装器
//    （electron-builder.yml 的 `oneClick: false`），而 NSIS 模板只在
//
//      ${if} ${isForceRun}
//      ${andIf} ${Silent}
//        !insertmacro doStartApp
//      ${endIf}
//
//    成立时才在安装结束后启动应用（app-builder-lib/templates/nsis/installSection.nsh
//    第 104-109 行；`--force-run` 这个 flag 由 NsisTarget.js 声明）。只传 `/S` 的
//    实测后果：更新"装完了"，但应用再也不出现——而确认框承诺过"会自动重新打开"。
//
// ⚠️ 这条修复只对**装了含此修复的版本之后**的更新生效：正在用旧版本的人升级到这一版
// 时，跑的仍是旧版本里的 updater。发布说明里必须写"安装完成后请手动重新打开简历通"。

/**
 * @param {string} installerPath 已通过 sha256 校验的安装器路径
 * @param {number} mainPid 当前主进程 pid（安装器要等它退出）
 * @returns {{file: string, args: string[]}} spawn 的参数
 */
function installerWaitCommand(installerPath, mainPid) {
  // 单引号字符串里的单引号要写两遍，否则路径里的 ' 会把命令截断。
  const escaped = String(installerPath).replace(/'/g, "''");
  const script =
    `Wait-Process -Id ${Number(mainPid)} -ErrorAction SilentlyContinue; ` +
    `Start-Process -FilePath '${escaped}' -ArgumentList '/S --force-run'`;
  return {
    file: "powershell",
    args: ["-NoProfile", "-WindowStyle", "Hidden", "-Command", script],
  };
}

module.exports = { installerWaitCommand };
