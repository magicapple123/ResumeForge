// SPDX-License-Identifier: Apache-2.0
/**
 * 拖放用例的**DOM 侧夹具**：造 `dataTransfer` 桩、按**视觉顺序**读行内容。
 *
 * 为什么单列文件：
 * 1. 两个组件级用例文件（`OutlinePanel.dragTargets.test.tsx` / `OutlinePanel.dragHover.test.tsx`）
 *    都要这两样，各抄一份会顶到 500 行预算，也容易一边改一边忘；
 * 2. "视觉顺序"是拖动语义的核心断言口：拖动中 DOM 顺序**不变**，换位靠 CSS `order`
 *    （真机上重排 DOM 会让 Chromium 扣掉 drop）。所以断言必须按 `style.order` 读，
 *    直接读 `querySelectorAll` 的返回顺序会永远"看起来没变"。
 */

/** 最小 `dataTransfer` 桩（jsdom 没有真实拖放会话）。 */
export function dragData(): DataTransfer {
  const store = new Map<string, string>();
  return {
    setData: (type: string, value: string) => store.set(type, value),
    getData: (type: string) => store.get(type) ?? "",
    clearData: () => store.clear(),
    dropEffect: "move",
    effectAllowed: "move",
    files: [],
    items: [],
    types: [],
    setDragImage: () => undefined,
  } as unknown as DataTransfer;
}

/** 按 CSS `order`（视觉顺序）排元素；`order` 未设置时按 DOM 顺序。 */
function byVisualOrder(elements: HTMLElement[]): HTMLElement[] {
  return elements
    .map((element, index) => ({
      element,
      index,
      order: element.style.order === "" ? index : Number(element.style.order),
    }))
    .sort((left, right) => left.order - right.order || left.index - right.index)
    .map((item) => item.element);
}

/** 「项目经历」条目的视觉顺序（读 `.resume-outline-title` 的文本）。 */
export function entryOrder(): string[] {
  return byVisualOrder(
    Array.from(document.querySelectorAll<HTMLElement>('[data-tree-key^="entry:projects:"]')),
  ).map((element) => element.querySelector(".resume-outline-title")?.textContent ?? "");
}

/** 要点行的视觉顺序（读 `.resume-outline-point-text` 的文本）。 */
export function pointOrder(): string[] {
  return byVisualOrder(
    Array.from(document.querySelectorAll<HTMLElement>('[data-tree-key^="point:"]')),
  ).map((element) => element.querySelector(".resume-outline-point-text")?.textContent ?? "");
}
