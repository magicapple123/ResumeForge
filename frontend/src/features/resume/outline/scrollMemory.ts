// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲/画布的**滚动位置记忆与恢复**（D01："定位后恢复原滚动位置"）。
 *
 * 为什么是独立纯模块：滚动在 jsdom 里没有布局、真实浏览器里又受容器/iframe 影响，
 * 把"记哪个元素、按什么键、恢复成多少"抽出来之后，两侧（大纲树、画布 iframe）共用一份
 * 实现，测试可以直接喂假元素断言读写，不用依赖真实滚动。
 *
 * 两类位置：
 * - 大纲树是普通 DOM 元素（`scrollTop`）；
 * - 画布是若干 iframe，每帧各自有 `contentWindow.scrollTop/scrollLeft`，按帧序保存。
 *   恢复时帧数量可能变了（预览重排换 iframe），只恢复仍然存在的帧，不报错。
 */

/** 一份可跨渲染持有的滚动位置记忆（面板 ref 里放一个）。 */
export interface ScrollMemory {
  remember: (key: string, top: number) => void;
  /** 读取记忆值（没有返回 null）。 */
  peek: (key: string) => number | null;
  has: (key: string) => boolean;
  /** 把记忆值写回元素；没有记忆或元素为空返回 false（不重置成 0）。 */
  restore: (key: string, element: ScrollableLike | null | undefined) => boolean;
  forget: (key: string) => void;
}

/** 任何带 scrollTop 的元素（真实 DOM 与测试假对象都满足）。 */
export interface ScrollableLike {
  scrollTop: number;
}

export function createScrollMemory(): ScrollMemory {
  const values = new Map<string, number>();
  return {
    remember: (key, top) => {
      if (typeof top === "number" && Number.isFinite(top)) values.set(key, Math.max(0, top));
    },
    peek: (key) => (values.has(key) ? (values.get(key) as number) : null),
    has: (key) => values.has(key),
    restore: (key, element) => {
      if (!element || !values.has(key)) return false;
      element.scrollTop = values.get(key) as number;
      return true;
    },
    forget: (key) => {
      values.delete(key);
    },
  };
}

/** 记住某个元素的滚动位置（元素为空时什么都不做，保留旧记忆）。 */
export function rememberElementScroll(
  memory: ScrollMemory,
  key: string,
  element: ScrollableLike | null | undefined,
): void {
  if (!element || typeof element.scrollTop !== "number") return;
  memory.remember(key, element.scrollTop);
}

/** 恢复某个元素的滚动位置；返回是否真的写了（没有记忆 = false）。 */
export function restoreElementScroll(
  memory: ScrollMemory,
  key: string,
  element: ScrollableLike | null | undefined,
): boolean {
  return memory.restore(key, element);
}

/** 一帧 iframe 的滚动位置（帧序即容器里 iframe 的 DOM 顺序）。 */
export interface FrameScrollSnapshot {
  top: number;
  left: number;
}

interface FrameLike {
  contentWindow?: { scrollTop?: number; scrollLeft?: number } | null;
}

interface FramesHostLike {
  querySelectorAll: (selector: string) => ArrayLike<FrameLike>;
}

/** 读取容器内所有 iframe 的滚动位置（拿不到的帧记为 0，保持帧序）。 */
export function rememberFrameScrolls(
  host: FramesHostLike | null | undefined,
): FrameScrollSnapshot[] {
  if (!host) return [];
  const frames = Array.from(host.querySelectorAll("iframe"));
  return frames.map((frame) => ({
    top: typeof frame.contentWindow?.scrollTop === "number" ? frame.contentWindow.scrollTop : 0,
    left: typeof frame.contentWindow?.scrollLeft === "number" ? frame.contentWindow.scrollLeft : 0,
  }));
}

/** 把帧滚动位置写回去（帧数变化时只恢复两端都存在的帧）。 */
export function restoreFrameScrolls(
  host: FramesHostLike | null | undefined,
  snapshot: readonly FrameScrollSnapshot[] | null | undefined,
): boolean {
  if (!host || !snapshot || snapshot.length === 0) return false;
  const frames = Array.from(host.querySelectorAll("iframe"));
  if (frames.length === 0) return false;
  let restored = false;
  snapshot.forEach((position, index) => {
    const frame = frames[index];
    const window = frame?.contentWindow;
    if (!window) return;
    if (typeof window.scrollTop === "number") {
      window.scrollTop = position.top;
      restored = true;
    }
    if (typeof window.scrollLeft === "number") window.scrollLeft = position.left;
  });
  return restored;
}

/** 树行滚到可视区（`scrollIntoView` 不存在时返回 false，测试可注入桩）。 */
export function scrollTreeKeyIntoView(
  container: { querySelector: (selector: string) => unknown } | null | undefined,
  treeKey: string,
): boolean {
  if (!container || !treeKey) return false;
  const node = container.querySelector(`[data-tree-key="${treeKey}"]`) as {
    scrollIntoView?: (options?: ScrollIntoViewOptions) => void;
  } | null;
  if (!node || typeof node.scrollIntoView !== "function") return false;
  node.scrollIntoView({ block: "nearest" });
  return true;
}
