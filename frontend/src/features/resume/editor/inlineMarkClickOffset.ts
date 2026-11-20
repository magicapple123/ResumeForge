// SPDX-License-Identifier: Apache-2.0
/**
 * 「点静态富文本块的哪个字 → 光标落在纯文本的哪个下标」。
 *
 * 为什么需要它：预览态（`InlineMarkStatic`）是一个普通 `<div>`，没有文本域那套
 * `selectionStart`。用户点中间某个字时，我们要么把光标送到他点的位置，要么一律落末尾——
 * 后者会让"改一个字"变成"滚到最后再挪回来"。
 *
 * 坐标系：静态块里渲染的就是**纯文本**（`value`），标记字符已在上游换算掉，所以 DOM 文本
 * 顺序累加长度 == 纯文本下标，**不需要**可见↔源串换算（见 `InlineMarkTextArea` 文件头）。
 *
 * 兜底策略：拿不到点位（jsdom 没有 `caretRangeFromPoint`、点在 padding 上、API 抛错）
 * 一律返回 `null`，由调用方决定落哪里（当前实现落末尾）。**绝不猜一个中间值。**
 */

type CaretDocument = Document & {
  caretRangeFromPoint?: (x: number, y: number) => Range | null;
  caretPositionFromPoint?: (x: number, y: number) => { offsetNode: Node; offset: number } | null;
};

/**
 * 文本节点 + 节点内偏移 → 容器内**纯文本**下标。
 *
 * 只认文本节点：`caretRangeFromPoint` 点在元素边界时会回 `(element, childIndex)`，
 * 那时下标语义是"第几个子节点"而不是"第几个字"，直接用会跳到错误位置。
 */
export function textOffsetOf(container: Node, node: Node, offset: number): number | null {
  if (node.nodeType !== Node.TEXT_NODE) return null;
  const doc = container.ownerDocument;
  if (!doc) return null;
  const walker = doc.createTreeWalker(container, NodeFilter.SHOW_TEXT);
  let total = 0;
  let current = walker.nextNode();
  while (current) {
    if (current === node) {
      const length = current.textContent?.length ?? 0;
      return total + Math.max(0, Math.min(offset, length));
    }
    total += current.textContent?.length ?? 0;
    current = walker.nextNode();
  }
  return null;
}

/** 视口坐标 → 容器内纯文本下标；不可用时返回 `null`。 */
export function clickOffsetFromPoint(container: HTMLElement, x: number, y: number): number | null {
  const doc = container.ownerDocument as CaretDocument | null;
  if (!doc) return null;
  let node: Node | null = null;
  let offset = 0;
  try {
    const range = doc.caretRangeFromPoint?.(x, y) ?? null;
    if (range) {
      node = range.startContainer;
      offset = range.startOffset;
    } else {
      const position = doc.caretPositionFromPoint?.(x, y) ?? null;
      if (position) {
        node = position.offsetNode;
        offset = position.offset;
      }
    }
  } catch {
    return null;
  }
  if (!node || !container.contains(node)) return null;
  return textOffsetOf(container, node, offset);
}
