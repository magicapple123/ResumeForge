// SPDX-License-Identifier: Apache-2.0
/**
 * 面板滚动锚定（R-10 / T06）：**元素锚定**，不是"记住 scrollTop 再写回去"。
 *
 * ## 为什么换掉旧模型（不是再加一个闸门）
 *
 * 旧实现记的是 `container.scrollTop` 这个**数字**，在每次 `dep` 变化后写回去。它有两个
 * 结构性缺陷，补丁补不掉：
 *
 * 1. **数字会过期**：用户滚到 200、上方内容因一次改动变矮 60px，浏览器已经把位置夹到
 *    140；此时把 200 写回去，用户看到的是"整块往上跳"——跳的方向取决于差值符号，跟
 *    用户刚才动的是哪一项无关。
 * 2. **"0 不能写"这类闸门只能挡住一种症状**：面板刚挂载、浏览器还没还原位置的那几帧里
 *    读到的 0 不可信，于是又得加一条"快照为 0 不写"。闸门越多，越难证明它没在别处
 *    帮倒忙（前几轮"改了好多轮都没好"就是这个模式）。
 *
 * 元素锚定换的是**参照物**：记"视口顶部第一个可见的那个节点 + 它离容器顶边多少"，
 * 改动提交后找**同一个节点**、量它的新偏移、把差值加到 `scrollTop` 上，**只写一次**。
 * 内容变高变矮、上方增删行，都不影响这个等式——因为它量的是同一个节点。
 *
 * ## 三条硬规则
 *
 * 1. **节点找不到就什么都不做**。绝不回落到"上次的数字"——那正是旧模型跳动的来源。
 * 2. **只写一次**（`scrollTop += delta`），不做动画、不做二次校正。
 * 3. **`≤1px` 的差当作没变**：亚像素写回去不会让用户看出差别，却会打断浏览器自己的
 *    滚动锚定。
 *
 * ## 快照什么时候更新
 *
 * 挂载时与每次滚动（`scroll`，passive）各取一次。用户主动滚动之后锚点自然换成新的
 * "第一个可见节点"；不从 `scroll` 事件里反向写位置，所以不会出现"用户滚不动"。
 */
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";

const SCROLLABLE_OVERFLOW = /^(auto|scroll|overlay)$/;

/** 宿主可以显式声明的滚动容器标记（结构页签面板上已加）。 */
const SCROLL_MARKER = "[data-panel-scroll]";

/**
 * 真正"会滚"的判定：`overflow-y` 允许滚动**且内容确实超出**。
 *
 * 旧实现只看 `overflow-y`：面板没真滚（内容比容器短）时也会被当成滚动容器挂上监听，
 * 监听器空转、锚点算出来恒为 0 —— 这是顺带修掉的一处 latent bug。
 */
function isScrollable(element: HTMLElement): boolean {
  const overflowY = window.getComputedStyle(element).overflowY;
  return SCROLLABLE_OVERFLOW.test(overflowY) && element.scrollHeight > element.clientHeight;
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

interface Anchor {
  /** 视口顶部第一个可见节点（跨一次重排仍指同一个 DOM 节点）。 */
  node: Element;
  /** 它当时距容器顶边的偏移（px，可为负——节点顶部已滚出容器）。 */
  offset: number;
}

/**
 * 找"视口顶部第一个可见元素"：文档序里第一个**下沿越过容器顶边**的叶子级元素。
 *
 * 只取"没有可见子元素"的那一层：取父级会让锚点变粗（一个 600px 高的分组跨两次改动
 * 都"部分可见"，差值算出来是 0，等于没锚）。叶子层则跟着具体那一行文字走。
 */
function firstVisibleNode(panel: HTMLElement, containerTop: number): Element | null {
  for (const element of panel.querySelectorAll<HTMLElement>("*")) {
    if (element.firstElementChild) continue;
    const rect = element.getBoundingClientRect();
    if (rect.height <= 0) continue;
    if (rect.bottom > containerTop + 1) return element;
  }
  return null;
}

/** 挂在面板根节点上的 **callback ref**（`ref={...}` 用法与普通 ref 一样）。 */
export type PanelScrollAnchorRef<T extends HTMLElement> = (node: T | null) => void;

/**
 * @param dep 只在它变化时校正一次（面板传 `document` 引用）。
 * @returns 挂在面板根节点上的 callback ref。
 */
export function usePanelScrollAnchor<T extends HTMLElement>(dep: unknown): PanelScrollAnchorRef<T> {
  const [node, setNode] = useState<T | null>(null);
  const anchorRef = useRef<Anchor | null>(null);

  const setAnchorRef = useCallback((element: T | null) => {
    setNode(element);
  }, []);

  /** 取一次锚点快照（挂载 / 每次用户滚动后）。 */
  const capture = useCallback((panel: T, container: HTMLElement) => {
    const containerTop = container.getBoundingClientRect().top;
    const target = firstVisibleNode(panel, containerTop);
    if (!target) {
      anchorRef.current = null;
      return;
    }
    anchorRef.current = {
      node: target,
      offset: target.getBoundingClientRect().top - containerTop,
    };
  }, []);

  useEffect(() => {
    if (!node) return;
    const container = findScrollContainer(node);
    // 节点卸载即丢弃锚点：切走页签再切回来要回顶部（与 `changeTab` 的归零口径一致）。
    if (!container) {
      anchorRef.current = null;
      return;
    }
    capture(node, container);
    const remember = () => capture(node, container);
    container.addEventListener("scroll", remember, { passive: true });
    return () => {
      container.removeEventListener("scroll", remember);
      anchorRef.current = null;
    };
  }, [node, capture]);

  useLayoutEffect(() => {
    if (!node) return;
    const anchor = anchorRef.current;
    // 规则 1：找不到锚点就什么都不做（绝不回落到旧数字）。
    if (!anchor || !anchor.node.isConnected) return;
    const container = findScrollContainer(node);
    if (!container) return;
    const offset = anchor.node.getBoundingClientRect().top - container.getBoundingClientRect().top;
    const delta = offset - anchor.offset;
    // 规则 3：亚像素 / 1px 内不动。
    if (Math.abs(delta) <= 1) return;
    // 规则 2：只写一次。
    container.scrollTop += delta;
    // 写完之后锚点自己就移回了原位；就地更新，避免同一批里第二次校正又叠一次 delta。
    anchor.offset = anchor.node.getBoundingClientRect().top - container.getBoundingClientRect().top;
  }, [dep, node]);

  return setAnchorRef;
}
