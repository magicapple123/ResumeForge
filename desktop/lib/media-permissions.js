// SPDX-License-Identifier: Apache-2.0
"use strict";

// 媒体权限：桌面壳里语音输入要用麦克风，面试录像要用摄像头。
//
// 为什么需要显式放行：Electron 目前对 media 是默认放行，但那属于"默认行为"，升级后
// 可能变（同一类问题在 notification / clipboard 上已经发生过）。这里把策略写在应用里，
// 升级不再改变行为。
//
// 为什么不做 origin 白名单：单用户本机应用，窗口只加载本机页面（dev server 或打包后的
// 入口），多一层 origin 判断只会多一种出错方式，而且写错了没有任何可观测信号。
//
// 其余权限一律拒绝：桌面壳用不到（通知/剪贴板读都有各自的明确入口）。
//
// 为什么单独成文件：main.js 正好卡在 500 行预算上（见 backend/tests/test_file_size_budget.py），
// 装配文件里只留一行调用。

/**
 * Electron 把"用麦克风/摄像头"统一归在 `media` 这一个 permission 名下，具体是哪一路
 * 由 `details.mediaTypes` 给出（`"audio"` = 麦克风，`"video"` = 摄像头）。
 */
const MEDIA_PERMISSION = "media";

/** 放行的媒体类型：语音输入要 audio，面试录像要 video（**不**顺带放行屏幕共享等）。 */
const ALLOWED_MEDIA_TYPES = new Set(["audio", "video"]);

/**
 * 这是一个麦克风/摄像头请求吗？
 *
 * 没有 `mediaTypes`（旧版 Electron、以及部分平台把整包 media 一次问的情况）时按放行
 * 处理：宁可让 Chromium 自己在取流时判，也不要因为"读不到细节"把语音输入静默挡死
 * ——那种失败在界面上表现为"点了没反应"，最难排查。
 */
function allowsMediaRequest(details) {
  const types = details && Array.isArray(details.mediaTypes) ? details.mediaTypes : null;
  if (!types || types.length === 0) return true;
  return types.some((type) => ALLOWED_MEDIA_TYPES.has(String(type).toLowerCase()));
}

/**
 * 放行 media（麦克风/摄像头），其余一律拒绝。
 *
 * macOS 分支要特别注意：系统授权由 `systemPreferences.askForMediaAccess("microphone")`
 * 决定，但**请求本身仍要过这一层**。这里把 `audio` 显式放进 `ALLOWED_MEDIA_TYPES`，
 * 否则 mac 上授权了也拿不到流。
 *
 * @param {object|null} session Electron 的 session（装配时传 `session.defaultSession`）。
 * @returns {boolean} 是否真的装上了（无 session / 无该方法时为 false）。
 */
function installMediaPermissionHandler(session) {
  if (!session || typeof session.setPermissionRequestHandler !== "function") {
    return false;
  }
  session.setPermissionRequestHandler((_webContents, permission, callback, details) => {
    callback(permission === MEDIA_PERMISSION && allowsMediaRequest(details));
  });
  return true;
}

/**
 * macOS 首次麦克风授权（I-08）。
 *
 * 为什么必须显式调用：macOS 的麦克风是 TCC 级别的系统权限，Chromium 第一次
 * `getUserMedia` 时会触发系统弹窗，而弹窗里显示的那句话来自 Info.plist 的
 * `NSMicrophoneUsageDescription`（在 `electron-builder.yml` 的 `mac.extendInfo` 里声明）。
 * 缺这个键时系统直接拒绝，严重时进程退出。提前问一次能让拒绝发生在**我们能给提示的时刻**，
 * 而不是用户点开语音输入时莫名其妙没有声音。
 *
 * 返回值语义：`true` 已授权、`false` 被拒、`null` 不适用/查不到（非 darwin、无 API、
 * 调用异常）。**`false` 不能当失败信号**：dev 形态没有签名，`askForMediaAccess`
 * 会稳定返回 false，而实际上用户手动授权后仍然能用。
 *
 * @param {{ systemPreferences?: object, platform?: string, log?: (line: string) => void }} options
 * @returns {Promise<boolean|null>} 永不 reject：失败只记日志。
 */
async function requestMacMicrophoneAccess(options) {
  const { systemPreferences, platform, log } = options || {};
  const targetPlatform = platform || process.platform;
  const write = typeof log === "function" ? log : () => {};
  if (targetPlatform !== "darwin") return null;
  if (!systemPreferences || typeof systemPreferences.askForMediaAccess !== "function") {
    write("mac microphone: systemPreferences.askForMediaAccess is unavailable; skipped");
    return null;
  }
  try {
    const granted = await systemPreferences.askForMediaAccess("microphone");
    write(`mac microphone access: ${granted ? "granted" : "not granted"}`);
    return Boolean(granted);
  } catch (error) {
    // 只记日志：这条链失败不该拦住窗口与后端启动（用户仍可能在系统设置里手动打开）。
    write(`mac microphone access failed: ${error && error.message ? error.message : error}`);
    return null;
  }
}

module.exports = { installMediaPermissionHandler, requestMacMicrophoneAccess };
