// SPDX-License-Identifier: Apache-2.0
/**
 * 搜索命中后的**定位与高亮**：滚到那张卡，并给它 2 秒的边框高亮。
 *
 * 为什么按标题文字找、而不是给 31 张卡各加一个 id：卡是各自独立的组件，加 id 要改 31 个
 * 文件（其中有别的任务正在改的卡），而索引里本来就有标题键——用标题找是零侵入的。
 * 标题来自同一份语言包，所以中英文界面下都能对上。
 */
const HIGHLIGHT_CLASS = "settings-card-target";
const HIGHLIGHT_MS = 2000;

/** 回顶时给内容区上沿留的余量，与 `.settings-body` 的 `scroll-margin-top` 同一个值。 */
export const SETTINGS_SCROLL_MARGIN = 16;

/**
 * 切组时要不要把内容区滚回顶部。
 *
 * 只有"内容顶已经滚出视口"才需要：`bodyTop` 是内容区顶边在**滚动内容坐标系**里的位置，
 * `margin` 是上沿余量。滚了不到一屏（0 / 50px）就回顶会让页面像被弹了一下——这正是
 * CR-15 报的"切组跳动"，而 `scrollIntoView` 无条件调用是它的来源。
 */
export function shouldResetScroll(scrollTop: number, bodyTop: number, margin: number): boolean {
  if (!Number.isFinite(scrollTop) || !Number.isFinite(bodyTop)) return false;
  if (scrollTop <= 0) return false;
  return scrollTop > Math.max(0, bodyTop - margin);
}

/** 找到真正滚动的祖先（`.app-content` 一类）；找不到时返回 null，交给调用方决定。 */
function findScrollParent(node: HTMLElement): HTMLElement | null {
  let parent = node.parentElement;
  while (parent !== null && parent !== document.body) {
    const overflowY = window.getComputedStyle(parent).overflowY;
    if (overflowY === "auto" || overflowY === "scroll" || overflowY === "overlay") return parent;
    parent = parent.parentElement;
  }
  return null;
}

/**
 * 内容区顶边相对滚动容器的偏移。用 rect 差 + 当前 scrollTop 算，
 * 不依赖 `offsetTop`（它在有定位祖先时会算错，jsdom 里也恒为 0）。
 */
function offsetWithin(node: HTMLElement, scroller: HTMLElement): number {
  const delta = node.getBoundingClientRect().top - scroller.getBoundingClientRect().top;
  return delta + scroller.scrollTop;
}

/**
 * 切组时把内容区滚回顶部——**只在需要时**。返回是否真的滚了，便于测试与兜底判断。
 *
 * 直接写 `scrollTop` 而不是 `scrollTo({behavior:"smooth"})`：切组本身是一次页面切换，
 * 平滑滚动会让"新一组"从屏幕外滑进来，比跳一下更晃眼。
 */
export function scrollSettingsToTop(node: HTMLElement | null): boolean {
  if (node === null) return false;
  const scroller = findScrollParent(node);
  if (scroller === null) return false;
  const bodyTop = offsetWithin(node, scroller);
  if (!shouldResetScroll(scroller.scrollTop, bodyTop, SETTINGS_SCROLL_MARGIN)) return false;
  scroller.scrollTop = Math.max(0, bodyTop - SETTINGS_SCROLL_MARGIN);
  return true;
}

/** 卡片的标题节点 → 整张卡；`Typography.Title` / 按钮这类非 Card 块退回自身。 */
function findSettingsCard(title: string): HTMLElement | null {
  // 只搜当前可见的那一组：非活动组仍留在 DOM 里（保留各自的取数状态），
  // 全文档搜会命中别的组里同名标题的卡。
  const scope =
    document.querySelector<HTMLElement>(".settings-section:not([hidden])") ?? document.body;
  const heads = scope.querySelectorAll<HTMLElement>(".ant-card-head-title");
  for (const head of heads) {
    if ((head.textContent ?? "").trim() === title) {
      return head.closest<HTMLElement>(".ant-card");
    }
  }
  const blocks = scope.querySelectorAll<HTMLElement>("h5, .ant-card, button");
  for (const block of blocks) {
    if ((block.textContent ?? "").trim() === title) {
      return block.closest<HTMLElement>(".ant-card, button");
    }
  }
  return null;
}

/**
 * 定位并高亮。找不到目标时静默返回：分组已经切过去了，用户至少能看到那一页。
 * 返回是否命中，便于测试断言"确实滚到了"。
 */
export function revealSettingsCard(title: string): boolean {
  const target = findSettingsCard(title);
  if (target === null) return false;
  target.scrollIntoView?.({ block: "start", behavior: "smooth" });
  // 同一张卡连点两次时也要重放动画：先摘掉、强制一次 reflow、再挂上。
  target.classList.remove(HIGHLIGHT_CLASS);
  void target.offsetWidth;
  target.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => target.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
  return true;
}

/**
 * 深链**锚点**的定位与高亮（`/settings?tab=assistant-behavior#conn-search-beta`）。
 *
 * 与 `revealSettingsCard` 有两处不同，都是 #9 的根因：
 *
 * 1. 目标行是**异步渲染**的（凭据列表要等一次 `/api/connections`），所以"现在找不到"
 *    不等于"不存在"——本函数只回答"这一次能不能命中"，重试交给调用方；命中才写
 *    `hashHandled` 那类状态，否则深链就会因为一次抢跑而永久失效；
 * 2. 目标所在的分组如果还是 `[hidden]`，滚过去也看不见（`display:none` 的元素没有
 *    布局盒）。这种情况**直接返回 false**：切分组是调用方的事（先切 tab 再滚动）。
 *
 * 合法锚点才会走到 `querySelector`：`#123` 这类会被当成 ID 选择器直接抛错，按"没命中"
 * 处理，不把整页炸掉。
 */
export function revealSettingsAnchor(hash: string): boolean {
  if (hash === "" || hash === "#") return false;
  let target: HTMLElement | null;
  try {
    target = document.querySelector<HTMLElement>(hash);
  } catch {
    return false;
  }
  if (target === null) return false;
  if (target.closest(".settings-section[hidden]") !== null) return false;
  target.scrollIntoView?.({ block: "start", behavior: "smooth" });
  target.classList.remove(HIGHLIGHT_CLASS);
  void target.offsetWidth;
  target.classList.add(HIGHLIGHT_CLASS);
  window.setTimeout(() => target.classList.remove(HIGHLIGHT_CLASS), HIGHLIGHT_MS);
  return true;
}
