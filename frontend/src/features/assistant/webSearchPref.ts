// SPDX-License-Identifier: Apache-2.0
/**
 * 「允许联网」的跨会话记忆（#7）。
 *
 * 为什么单独一个文件：与 `readStoredReasoningEffort.ts` 同层、同命名风格，
 * 页面与投投浮窗共用同一份 key（不带 surface），关掉浮窗再打开、从别的页跳回
 * `/assistant` 都不会重置。
 *
 * 三条纪律：
 * 1. **默认 false**：没有存储值时**不**自动开启联网——联网会发外部请求、有延迟与
 *    隐私面，不能靠默认值替用户决定。
 * 2. 读写都包 try/catch：隐私模式、存储被策略禁用时 `getItem/setItem` 会抛，
 *    此时退回"不记忆"而不是打断页面（与 `welcomeGate.ts` 同一纪律）。
 * 3. 值用 `"1"` / `"0"` 而不是 `"true"`：与仓库既有布尔偏好保持同一编码，
 *    任何非 `"1"` 的值都按关处理。
 */

const WEB_SEARCH_KEY = "resumeforge.assistant.web_search";

function storage(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    return null;
  }
}

/** 读上次的选择；缺失 / 异常 / 被禁用 → false（关）。 */
export function readStoredWebSearch(): boolean {
  const store = storage();
  if (!store) return false;
  try {
    return store.getItem(WEB_SEARCH_KEY) === "1";
  } catch {
    return false;
  }
}

/** 写选择；存储不可用时静默放弃（记忆是便利功能，不阻断页面）。 */
export function writeStoredWebSearch(value: boolean): void {
  const store = storage();
  if (!store) return;
  try {
    store.setItem(WEB_SEARCH_KEY, value ? "1" : "0");
  } catch {
    // 配额满 / 隐私模式：忽略。
  }
}
