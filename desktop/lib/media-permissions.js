// SPDX-License-Identifier: Apache-2.0
"use strict";

// 媒体权限：桌面壳里语音输入要用麦克风。
//
// 为什么需要显式放行：Electron 目前对 media 是默认放行，但那属于"默认行为"，升级后
// 可能变（同一类问题在 notification / clipboard 上已经发生过）。这里把策略写在应用里，
// 升级不再改变行为。
//
// 为什么不做 origin 白名单：单用户本机应用，窗口只加载本机页面（dev server 或打包后的
// 入口），多一层 origin 判断只会多一种出错方式，而且写错了没有任何可观测信号。
//
// 其余权限一律拒绝：桌面壳用不到（摄像头/通知/剪贴板读都有各自的明确入口）。
//
// 为什么单独成文件：main.js 正好卡在 500 行预算上（见 backend/tests/test_file_size_budget.py），
// 装配文件里只留一行调用。

/** 放行 media，其余一律拒绝。返回是否真的装上了（无 session / 无该方法时为 false）。 */
function installMediaPermissionHandler(session) {
  if (!session || typeof session.setPermissionRequestHandler !== "function") {
    return false;
  }
  session.setPermissionRequestHandler((_webContents, permission, callback) => {
    callback(permission === "media");
  });
  return true;
}

module.exports = { installMediaPermissionHandler };
