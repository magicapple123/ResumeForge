/**
 * 快捷键在既有界面上的两个"外部落点"（R5）。
 *
 * App 只认得"搜索 / 助手 / 新建岗位"三个动作的语义，具体打开哪个输入框、哪个弹窗
 * 属于页面自己的事，所以经这里转发，而不是让 App 去 import 页面内部状态：
 *
 * - 搜索框：首页是懒加载路由，`navigate("/")` 之后的同一帧里搜索框还没挂上，
 *   因此按帧重试几次而不是只试一次；
 * - 新建岗位：岗位页在挂载时登记自己的打开逻辑，离开页面即注销（App 侧再按
 *   `pathname === "/jobs"` 兜一道，避免在别的页面上"按了却悄悄打开了弹窗"）。
 */

/** 首页全站搜索框：antd `Input.Search` 的内层 input 自带 `type="search"`。 */
export const HOME_SEARCH_SELECTOR = 'input[type="search"], .home-search input';

const FOCUS_RETRY_COUNT = 8;
const FOCUS_RETRY_INTERVAL_MS = 60;

/**
 * 找到并聚焦首页搜索框，返回一个"取消"函数（组件卸载时清掉重试定时器）。
 * 找不到元素时静默结束——快捷键不该因为页面还没渲染完就抛错。
 */
export function focusHomeSearch(
  attempts = FOCUS_RETRY_COUNT,
  intervalMs = FOCUS_RETRY_INTERVAL_MS,
): () => void {
  let remaining = attempts;
  let timer: number | null = null;

  const tryFocus = () => {
    const element = document.querySelector<HTMLInputElement>(HOME_SEARCH_SELECTOR);
    if (element) {
      element.focus();
      element.select?.();
      return;
    }
    remaining -= 1;
    if (remaining > 0) timer = window.setTimeout(tryFocus, intervalMs);
  };

  if (typeof window.requestAnimationFrame === "function") {
    window.requestAnimationFrame(tryFocus);
  } else {
    timer = window.setTimeout(tryFocus, 0);
  }

  return () => {
    if (timer !== null) window.clearTimeout(timer);
  };
}

export type JobCreateHandler = () => void;

let jobCreateHandler: JobCreateHandler | null = null;

/** 岗位页挂载时登记"打开新建岗位弹窗"，传 null 表示注销。 */
export function registerJobCreateHandler(handler: JobCreateHandler | null): void {
  jobCreateHandler = handler;
}

/** App 侧触发。返回 false 表示当前没有页面认领（例如用户并不在岗位广场）。 */
export function triggerJobCreate(): boolean {
  if (!jobCreateHandler) return false;
  jobCreateHandler();
  return true;
}
