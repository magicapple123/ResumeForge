// SPDX-License-Identifier: Apache-2.0
/**
 * 面板滚动锚定（审计 R-10）。
 *
 * 场景：左栏「条目字段排版」里的灰字段列表在改动后会重排 / 增删一行，容器高度随
 * 之变化，浏览器（或 antd 的 auto-scroll）会把滚动位置调到一个"看起来没跳"的值，
 * 但用户看到的是整块内容上下位移——尤其在 360px 窄栏里，一行的位移就足以让刚点的
 * 控件跑出视野。
 *
 * 做法（与验收判据「切「前/后」行不移动、`scrollTop` 不变」一一对应）：
 * 1. 用**callback ref** 把面板根节点记进 state，再找它**最近的可滚动祖先**
 *    （左栏页签面板 `.resume-wb-structure-tab` 带 `overflow-y: auto`；宿主也可以用
 *    `[data-panel-scroll]` 显式标记）；
 * 2. 监听它的 `scroll`，把当前位置存在 ref 里 —— 这就是"变化前"的快照；
 * 3. **只在 `dep` 变化时**用 `useLayoutEffect` 把快照写回去一次（绘制前，不闪）。
 *    不用 `useEffect`：那会在浏览器已经画完错位的一帧之后才纠正。
 *    写回有三个闸门：没有快照不写、**快照为 0 不写**（0 不可信，见布局效应里的注释）、
 *    与当前位置差 ≤1px 不写（亚像素差写回去只会打断浏览器的滚动锚定）。
 *
 * ## 为什么节点必须是 state 而不是 ref（QA 复验发现的反向 Bug）
 *
 * 左栏的结构面板是**条件渲染**的：切到「本份简历结构」页签之前，那个 div 根本不存在。
 * 早先的写法把 `useEffect(..., [])` 的依赖写死成空数组，体内第一行 `if (!node) return`：
 * 首帧 ref 还是 null → **scroll 监听从没挂上**，快照永远是初值 0；等用户真把面板滚到
 * 200 再改一次文档，`useLayoutEffect([dep])` 看到 `scrollTop(200) !== 0`，反而**主动写
 * 0**，面板跳回顶部。把节点放进依赖（callback ref → state）之后：节点出现的下一帧就
 * 建好快照，`hasSnapshot` 之前一律不写回。
 *
 * 注意：只在 `dep` 引用变化时恢复一次，用户自己滚动不会被拽回去（滚动会刷新快照）。
 *
 * 另一条边界：**节点卸载即丢弃快照**。左栏换页签本来就把整列 `scrollTop` 归零，所以
 * 切走再切回结构页签应当回到顶部、而不是恢复上一次的位置（内容变短后恢复旧偏移还会
 * 落在被夹取的边界上，观感更像 bug）。验收判据只要求"在面板内改内容时位置不动"。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay)$/;

/** 宿主可以显式声明的滚动容器标记（结构页签面板上已加）。 */
const SCROLL_MARKER = "[data-panel-scroll]";

function isScrollable(element: HTMLElement): boolean {
  const overflowY = window.getComputedStyle(element).overflowY;
  return SCROLLABLE_OVERFLOW.test(overflowY);
}

/** 从面板节点往上找"真正会滚"的那一层；找不到返回 null（面板不滚动时无需锚定）。 */
function findScrollContainer(start: HTMLElement | null): HTMLElement | null {
  if (!start) return null;
  const marked = start.closest<HTMLElement>(SCROLL_MARKER);
  if (marked && isScrollable(marked)) return marked;
  let current: HTMLElement | null = start.parentElement;
  while (current) {
    if (isScrollable(current)) return current;
    current = current.parentElement;
  }
  return null;
}

/** 挂在面板根节点上的 **callback ref**（`ref={...}` 用法与普通 ref 一样）。 */
export type PanelScrollAnchorRef<T extends HTMLElement> = (node: T | null) => void;

/**
 * @param dep 只在它变化时恢复一次滚动位置（面板传 `document` 引用）。
 * @returns 挂在面板根节点上的 callback ref。
 */
export function usePanelScrollAnchor<T extends HTMLElement>(dep: unknown): PanelScrollAnchorRef<T> {
  const [node, setNode] = useState<T | null>(null);
  const scrollTopRef = useRef(0);
  /**
   * 有没有拿到过"变化前"的快照。
   *
   * 条件渲染的面板（结构页签）首次出现时这个值还是 false：此时 `scrollTopRef` 只是
   * 初值 0，把它写回去就等于"把刚打开的面板拉到顶部"。所以布局效应里先看它。
   */
  const hasSnapshotRef = useRef(false);

  /** callback ref：节点进 state，节点出现的下一帧才可能建立快照。 */
  const setAnchorRef = useCallback((element: T | null) => {
    setNode(element);
  }, []);

  // 节点出现（或换了一个节点）才挂监听：依赖里必须有 node，否则条件渲染的面板永远挂不上。
  useEffect(() => {
    if (!node) return;
    const container = findScrollContainer(node);
    if (!container) return;
    // 先记一次快照再挂监听：否则第一次恢复会把这个面板拉回顶部。
    scrollTopRef.current = container.scrollTop;
    hasSnapshotRef.current = true;
    const remember = () => {
      scrollTopRef.current = container.scrollTop;
    };
    container.addEventListener("scroll", remember, { passive: true });
    return () => {
      container.removeEventListener("scroll", remember);
      // 节点卸载即**丢弃快照**：切走页签再切回来要回顶部，不恢复上一次的位置。
      // 这与宿主 `changeTab` 把整列 scrollTop 归零的口径一致（换页签 = 回到顶部）。
      // 重新挂载时由上面那两行重新取当前值（通常就是 0）。
      hasSnapshotRef.current = false;
      scrollTopRef.current = 0;
    };
  }, [node]);

  useLayoutEffect(() => {
    // 没有快照 = 面板刚出现（或从来没滚动过）：什么都别写，否则会把 200 写成 0。
    if (!hasSnapshotRef.current) return;
    const target = scrollTopRef.current;
    /**
     * `0` 一律不写。
     *
     * 快照为 0 只有两种来路：用户本来就在顶部（写 0 没意义），或者"面板刚挂载、浏览器还没把
     * 位置还原回来"这个几帧的窗口里取了值（写 0 就是把用户正在看的位置拽回顶部——本任务的
     * 现象正是它）。两种情况都不该写，所以这里不是"少写一次"，而是绝不能写 0。
     */
    if (target <= 0) return;
    // 容器在每次布局效应里就地解析：不把它存进 ref，避免"跨效应共享可变 DOM 引用"。
    const container = findScrollContainer(node);
    if (!container) return;
    // 差 ≤1px 当作没变化：亚像素位置写回去不会让用户看到差别，反而会打断浏览器的滚动锚定。
    if (Math.abs(container.scrollTop - target) <= 1) return;
    container.scrollTop = target;
  }, [dep, node]);

  return setAnchorRef;
}
