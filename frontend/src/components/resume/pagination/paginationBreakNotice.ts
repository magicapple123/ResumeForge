// SPDX-License-Identifier: Apache-2.0
/**
 * 「断页设置在精确预览/导出里生效」这句轻提示的**首次**判定（Q09）。
 *
 * 分页面板（左栏版面组）与条目字段排版面板（结构页签）都有断页开关，两处共用这一个
 * 标记而不是各存一份：用户在任一处第一次拨动开关时看到一次，之后不再打扰。
 *
 * 用 sessionStorage 而不是模块级变量：制作台切换左栏页签会卸载/重挂面板，模块变量
 * 在"切走再切回"后会让同一条提示又出现一次。按会话（标签页）级别即可，不写 localStorage。
 */
export const PAGE_BREAK_TOAST_SESSION_KEY = "resumeforge.pagination.break-toast-shown.v1";

/** 本次会话是否该给轻提示；返回 true 时顺手把标记写掉（保证只提示一次）。 */
export function consumePageBreakToastOnce(): boolean {
  try {
    if (window.sessionStorage.getItem(PAGE_BREAK_TOAST_SESSION_KEY) === "1") return false;
    window.sessionStorage.setItem(PAGE_BREAK_TOAST_SESSION_KEY, "1");
    return true;
  } catch {
    // 隐私模式/无 storage 时每次都提示：宁可多一条提示，也不要让用户以为断页立即生效。
    return true;
  }
}
