// SPDX-License-Identifier: Apache-2.0
/**
 * 拖动激活时把**全部**大分区折叠成 52px 紧凑条（P3）。
 *
 * ## 为什么这次可以折叠，前两轮为什么不行
 *
 * 折叠会改文档高度——被拖卡上方的分区一收，它的视口上缘就整体上移；而跟手位置是
 * 「指针 − 抓取偏移」的绝对量，几何一错卡片立刻脱手。历史上前两轮分别翻在这两处：
 *
 * 1. **滚动被夹死**：整页变矮后 `scrollTop` 被浏览器夹小，塌缩后的 rect 反而比塌缩
 *    前更低，按 `pre − post` 算出的补偿符号与量级全错；
 * 2. **插入判定错位**：拿紧凑栈坐标去比「还停在展开态位置」的指针，激活瞬间就算出
 *    错误的插入位（顺序在手指刚动 7px 时就凭空上移两位）。
 *
 * 现在这两条都在激活那一刻被显式处理，顺序是「量 → 折叠 → 补偿 → 量」：
 *
 * - `switchToCompactLayout` 先记 `beforeTop`，同步折叠，再读 `afterTop`，把差值写进
 *   `scrollTop`（被边界夹住时按实际可滚范围写，写完再量一次真实位置）——被拖卡
 *   尽可能留在原处；
 * - `resolveCompactGrabOffset` 在「折叠确实把卡片挪出了指针」（补偿被页顶/页底夹掉）
 *   时把抓取偏移重设成「指针 − 紧凑条上缘」：激活这一刻 `desiredTop` 就等于紧凑条
 *   上缘、`transform` 为 0，不跳位，之后一指的位移就是一格的位移；
 * - 几何在折叠**之后**采集（`profileSectionGeometry.captureSectionGeometry` 读到的
 *   就是 52px 的紧凑高度），前缀和 / clamp / 换位 / 行程换算复用同一套模型；
 * - 真正「被拿在手上」的视觉就是紧凑条本身（`transform` 直写、`is-dragging` 置顶），
 *   不再另起浮条——用户要的是"卡片本身跟手"。
 *
 * 松手时由调用方在同一个 `flushSync` 里复位紧凑态，再由
 * `dragAutoScroll.compensateReleaseShift` 逐帧补偿「恢复展开」造成的整页位移；
 * 位移收敛后再由本文件的 `centerElementInContainer` 把视角落回被拖卡片
 * （折叠/恢复会让文档变矮，浏览器可能把 `scrollTop` 夹到 0，界面就停在页顶）。
 */

/** 紧凑条高度（px）：必须与 styles/profile.css 的 `.profile-section-sortable.is-compact` 一致。 */
export const COMPACT_SECTION_HEIGHT_PX = 52;

/** 折叠切换的入参。 */
export interface CompactLayoutSwitchParams {
  /** 被拖动的分区根元素；拿不到时仍然折叠，只是不做位移补偿。 */
  element: HTMLElement | null;
  /** 把紧凑态同步提交进 DOM（调用方负责用 `flushSync` 包住 store 写入）。 */
  enterCompactLayout: () => void;
  /** 解析本次拖拽的滚动容器（内层 `.app-content` 或文档滚动元素）。 */
  resolveContainer: (element: HTMLElement | null) => HTMLElement | null;
}

/** 一次折叠切换的结果（全部为视口坐标）。 */
export interface CompactLayoutSwitch {
  /** 折叠前被拖卡的上缘；拿不到元素时为 null。 */
  beforeTop: number | null;
  /** 折叠 + 补偿后（重新量过）被拖卡的上缘。 */
  afterTop: number | null;
  /** 实际写进 `scrollTop` 的补偿量（正数 = 内容上移）；被容器边界夹住的量不在此列。 */
  scrollShift: number;
}

/**
 * 折叠全部大分区，并补偿由此产生的整页位移。
 *
 * 调用点必须是原生事件 / rAF 回调（`enterCompactLayout` 内含 `flushSync`）。返回的
 * `afterTop` 只用于诊断与断言：随后的几何采集会自己再量一次 rect。
 */
export function switchToCompactLayout({
  element,
  enterCompactLayout,
  resolveContainer,
}: CompactLayoutSwitchParams): CompactLayoutSwitch {
  if (!element) {
    // 拿不到被拖卡也要折叠：用户要看到的是「所有大卡片一起收起来」，只是无从补偿。
    enterCompactLayout();
    return { beforeTop: null, afterTop: null, scrollShift: 0 };
  }
  const beforeTop = element.getBoundingClientRect().top;
  // 必须等 React 把 `is-compact` 真正写进每个分区壳之后才能量：既要真实的紧凑高度，
  // 也要折叠造成的位移量，所以这次提交是同步的。
  enterCompactLayout();
  const collapsedTop = element.getBoundingClientRect().top;
  const delta = collapsedTop - beforeTop;
  if (delta === 0) return { beforeTop, afterTop: collapsedTop, scrollShift: 0 };
  const container = resolveContainer(element);
  if (!container) return { beforeTop, afterTop: collapsedTop, scrollShift: 0 };
  const scrollShift = shiftScrollTop(container, delta);
  // 补偿可能被滚到边界夹住：以**补偿后**的真实位置为准。
  const afterTop = scrollShift === 0 ? collapsedTop : element.getBoundingClientRect().top;
  return { beforeTop, afterTop, scrollShift };
}

/**
 * 把容器的 `scrollTop` 尽量挪 `delta` 像素（浏览器负责夹到可滚范围），返回落地增量。
 *
 * 向上补偿在 `scrollTop === 0` 处无可再滚（用户正停在页顶）：残差由
 * `resolveCompactGrabOffset` 兜住——不让卡片硬跳，而是把拖拽原点改到卡片当前位置。
 * 容器完全不可滚（内容没超高）时直接返回 0，不写无意义的 `scrollTop`。
 */
export function shiftScrollTop(container: HTMLElement, delta: number): number {
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  if (maxScrollTop <= 0) return 0;
  const before = container.scrollTop;
  const target = Math.min(Math.max(before + delta, 0), maxScrollTop);
  if (target === before) return 0;
  container.scrollTop = target;
  return container.scrollTop - before;
}

/**
 * 折叠后重算抓取偏移；返回 null 表示沿用几何采集算出的值（指针仍落在紧凑条内）。
 *
 * @param pointerStartY 指针按下点（折叠前）的视口 y。
 * @param compactTop 折叠 + 补偿后被拖卡的视口上缘。
 * @param compactHeight 被拖卡折叠后的高度（52）。
 */
export function resolveCompactGrabOffset(
  pointerStartY: number | null,
  compactTop: number,
  compactHeight: number,
): number | null {
  if (pointerStartY === null) return null;
  const offset = pointerStartY - compactTop;
  // 常见路径：把手就在卡片顶部（抓取点距上缘几十像素），折叠 + 补偿后指针仍落在
  // 52px 的紧凑条里 → 沿用原抓取偏移，手感与折叠前一致。
  if (offset >= 0 && offset <= compactHeight) return null;
  // 卡片被折叠挪出了指针（补偿被页顶/页底夹掉）：把「指针 − 紧凑条上缘」当作抓取
  // 偏移，让激活这一刻 transform = 0。否则 desiredTop 会离原位好几槽，手指刚动就连跳多位。
  return offset;
}

/**
 * 把元素滚到容器视口内**垂直居中**（松手后的视角落点）。
 *
 * ## 为什么需要它
 *
 * 拖动期全部卡片折成 52px，松手立刻恢复展开：文档在松手那一帧**变高**，而折叠时被
 * 浏览器夹小的 `scrollTop` 不会自动复原。用户在页面中部拖一张卡片，松手后界面却停在
 * 页顶（`scrollTop ≈ 0`）——被拖的那张卡早已滚出视口，用户以为卡片丢了。
 *
 * ## 为什么要「居中」而不是「滚到可见」
 *
 * `scrollIntoView({block:"nearest"})` 在卡片大半露在视口里时一动不动，用户仍然找不到
 * 刚拖过的那张卡（它可能刚被换到视口边缘）。居中是无歧义的落点：卡片回到视觉中心，
 * 手指最后停在哪、卡片就在哪。
 *
 * ## 为什么不用 `focus()`
 *
 * 焦点收尾（`profileSectionFocus.ts`）走的是 `preventScroll`，靠这里显式滚；若让
 * `focus()` 驱动滚动，浏览器会在聚焦时二次调整视口，与本次滚动叠加、最终落点不可控。
 * 也刻意不用 `behavior: "smooth"`：松手即到位，动画会让"刚拖完"的反馈滞后。
 *
 * @param element 被拖动的分区壳；为 null 时什么都不做（拖拽未激活的兜底）。
 * @param container 滚动容器（`.app-content`，或退化为 `document.scrollingElement`）；
 *   为 null 时退回 `scrollIntoView({block:"center"})`。
 */
export function centerElementInContainer(
  element: HTMLElement | null,
  container: HTMLElement | null,
): void {
  if (!element) return;
  if (!container) {
    // 拿不到滚动容器（元素已脱离文档 / 拖拽未激活）：交给浏览器兜底。
    if (typeof element.scrollIntoView === "function") {
      element.scrollIntoView({ block: "center", behavior: "auto" });
    }
    return;
  }
  // 容器完全不可滚（内容没超高）：没有可写的 scrollTop，直接结束。
  const maxScrollTop = Math.max(0, container.scrollHeight - container.clientHeight);
  if (maxScrollTop <= 0) return;
  const rect = element.getBoundingClientRect();
  const containerRect = container.getBoundingClientRect();
  // 目标 = 当前 scrollTop + 元素相对容器视口的上缘 − 居中所需的偏移。
  const target =
    container.scrollTop +
    (rect.top - containerRect.top) -
    (container.clientHeight - rect.height) / 2;
  // 夹到可滚范围：越界时浏览器也会夹，但显式夹住能让测试与真机拿到同一个值。
  container.scrollTop = Math.min(Math.max(target, 0), maxScrollTop);
}
