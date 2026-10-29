// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲树的**行几何量测**（`DropRowBox` 的唯一生产处）。
 *
 * ## 为什么不能量 `[data-tree-key]`（用户反馈 #4 的真根因）
 *
 * `data-tree-key` 挂在 `role="treeitem"` 的**外层容器**上，而一个条目/板块的 treeitem 是
 * **包含它展开的子树**的。真机实测（1680x1000、项目经历 3 条全展开）：
 *
 * | 元素 | 矩形 | 中心 |
 * |---|---|---|
 * | `entry:projects:ob_806…` treeitem | 250~486 | **368** |
 * | 它自己的 `.resume-outline-row` | 250~278 | **264** |
 * | `section:experience` treeitem | 高 740 | 比板块标题行低 **356px** |
 *
 * 于是"指针离哪一行最近"完全错位：用户把第 1 条拖到第 2 条的行上（指针 y=500）时，
 * 第 2 条的 treeitem 中心是 592、被拖行是 368，判据算出"还是离自己更近"——顺序不动。
 * 所有展开的条目都受影响，这正是"大部分情况下拖不动"的直接原因。
 *
 * 所以几何一律量**行元素本身**：条目/要点是 `:scope > .resume-outline-row`（要点行也带
 * 这个 class），板块头/个人信息是 `:scope > .resume-outline-section`。
 *
 * 单独成文件的原因：`useOutlineDragDrop` 已贴近 500 行预算，而"怎么从 treeitem 找到行元素"
 * 与"怎么用这些矩形判落点"是两件事（后者在 `outlineDropTargets` 里是纯函数）。
 */
import type { DropRowBox } from "./outlineDropTargets";

/** 行元素的 class：条目行与要点行都是 `.resume-outline-row`，板块头是 `.resume-outline-section`。 */
const ROW_CLASS = "resume-outline-row";
const SECTION_CLASS = "resume-outline-section";

/**
 * treeitem → 它自己的那一行（treeitem 的第一个子元素）。
 *
 * 不用 `:scope > .resume-outline-row` 选择器：拖动中的每一次量测都要对几十个节点做一次
 * 选择器解析，直接读 `children` + `classList` 便宜得多（这一层正是要压掉的成本）。
 */
function rowElementOf(treeitem: Element): HTMLElement | null {
  const children = treeitem.children;
  for (let index = 0; index < children.length; index += 1) {
    const child = children[index] as HTMLElement;
    const classList = child.classList;
    if (!classList) continue;
    if (classList.contains(ROW_CLASS) || classList.contains(SECTION_CLASS)) return child;
  }
  return null;
}

/**
 * 量出树里每一行的矩形（视口坐标）。`root` 是树滚动容器 `.resume-outline-tree`。
 *
 * 一次 `querySelectorAll` + 每个 treeitem 一次 `getBoundingClientRect`；调用方负责
 * **每帧最多调一次**（见 `useOutlineDragDrop` 的悬停帧合并），否则会和 React 的 DOM 写入
 * 抢同一帧、把布局反复作废（实测单次拖动 max dragover 间隔 373ms）。
 */
export function collectRowBoxes(root: HTMLElement | null): DropRowBox[] {
  if (!root) return [];
  const treeitems = root.querySelectorAll<HTMLElement>("[data-tree-key]");
  const boxes: DropRowBox[] = [];
  for (let index = 0; index < treeitems.length; index += 1) {
    const treeitem = treeitems[index];
    const key = treeitem.dataset.treeKey ?? "";
    if (!key) continue;
    const row = rowElementOf(treeitem);
    if (!row) continue;
    const rect = row.getBoundingClientRect();
    boxes.push({
      key,
      centerY: rect.top + rect.height / 2,
      top: rect.top,
      bottom: rect.bottom,
    });
  }
  return boxes;
}
