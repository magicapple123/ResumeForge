// SPDX-License-Identifier: Apache-2.0
/**
 * 采集节奏折叠状态的持久化（localStorage）。
 *
 * 为什么放 localStorage：这是**偏好**（这一块要不要展开），不是草稿正文；偏好与正文
 * 分开对待是仓库既有约定。key 带 `.v1`：以后默认值或语义变化时可以换 key 重来，
 * 而不是去猜旧值是什么意思。
 *
 * 读不到（隐私模式、被清空）一律按"折叠"处理——默认折叠是设计口径，失败不该反过来
 * 变成全展开。
 */

export const RHYTHM_OPEN_KEY = "resumeforge.apply.collect-rhythm.v1";

export function readRhythmOpen(): boolean {
  try {
    return window.localStorage.getItem(RHYTHM_OPEN_KEY) === "open";
  } catch {
    return false;
  }
}

export function writeRhythmOpen(open: boolean): void {
  try {
    window.localStorage.setItem(RHYTHM_OPEN_KEY, open ? "open" : "collapsed");
  } catch {
    // 写不进去只是"这次选择不跨刷新保留"，不影响当前会话的展开/折叠。
  }
}
