// SPDX-License-Identifier: Apache-2.0
/**
 * 「每周最多提示一次」的自然周工具（#29F）。
 *
 * 单独成文件而不是塞进 ReviewPromptBanner：组件文件只导出组件（react-refresh 规则），
 * 常量与纯函数放这里，测试也能直接验证跨周边界。
 */
export const REVIEW_PROMPT_STORAGE_KEY = "resumeforge.knowledge.reviewPrompt.v1";

/** 当前自然周起点（周一）的 YYYY-MM-DD：跨周自动失效，不需要清理旧值。 */
export function currentWeekStart(now = new Date()): string {
  const date = new Date(now.getFullYear(), now.getMonth(), now.getDate());
  const offset = (date.getDay() + 6) % 7;
  date.setDate(date.getDate() - offset);
  const month = String(date.getMonth() + 1).padStart(2, "0");
  const day = String(date.getDate()).padStart(2, "0");
  return `${date.getFullYear()}-${month}-${day}`;
}

export function mutedThisWeek(): boolean {
  try {
    return window.localStorage.getItem(REVIEW_PROMPT_STORAGE_KEY) === currentWeekStart();
  } catch {
    return false;
  }
}

export function muteThisWeek(): void {
  try {
    window.localStorage.setItem(REVIEW_PROMPT_STORAGE_KEY, currentWeekStart());
  } catch {
    // 隐私模式禁用 localStorage 时降级为"本次访问不显示"（调用方 state 已隐藏）。
  }
}
