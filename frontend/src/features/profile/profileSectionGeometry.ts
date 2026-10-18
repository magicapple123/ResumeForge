/**
 * 分区拖拽的**几何采集**：拖动激活时读一次 DOM，把栈几何与被拖卡的跟手参数算齐。
 *
 * 从 `useProfileSectionReorder.ts` 抽出以满足单文件 500 行预算，行为逐字保留
 * （包括 `content-visibility` 的强制真实布局、按屏幕位置算栈几何、前缀和推栈底）。
 *
 * 为什么只读一次：此后 pointermove / 自动滚动全程用前缀和模型推算，零 DOM 查询；
 * 滚动只平移几何（见 `dragReorder.applyScrollShift`），不重新测量。
 */

import { stackBottomOf, type DragStackGeometry } from "../../components/profile/dragReorder";
import type { ProfileSectionKey } from "../../components/profile/ProfileSectionConfig";

/** 拖拽期挂在每个分区上的类（强制真实布局，见 useProfileSectionReorder 文件头说明）。 */
export const SECTION_REORDERING_CLASS = "is-section-reordering";

export interface CaptureGeometryParams {
  /** 被拖动的分区 key。 */
  sectionKey: ProfileSectionKey;
  /** 当前顺序（store 里的权威顺序，heights 按它逐位对齐）。 */
  order: ProfileSectionKey[];
  /** 指针按下时的 y；为 null 表示没有起点（退回「按卡高一半」的抓取点）。 */
  pointerStartY: number | null;
}

export interface CapturedSectionGeometry {
  /** 栈几何（heights 与 order 逐位对齐，重排时同步 splice）。 */
  geometry: DragStackGeometry;
  /** 指针按下点在被拖分区内的纵向偏移（0~h），跟手位置 = 指针 y − 它。 */
  grabOffset: number;
  /** 被拖分区的高度（自动滚动的 clamp 用）。 */
  draggedHeight: number;
  /** 被拖分区的布局上缘（方向跟踪与行程锚点的起点）。 */
  draggedTop: number;
  /** 被拖分区的根元素（后续直改 transform）。 */
  element: HTMLElement;
}

/**
 * 采集栈几何；任一前提不满足（没有分区、找不到被拖卡）时返回 null。
 *
 * 副作用只有一处：给全部分区补上 `SECTION_REORDERING_CLASS`，否则离屏分区的
 * `content-visibility: auto` 会让 rect 高度退化成 `contain-intrinsic-size` 的假高度。
 */
export function captureSectionGeometry(
  params: CaptureGeometryParams,
): CapturedSectionGeometry | null {
  const { sectionKey, order, pointerStartY } = params;
  const elements = Array.from(document.querySelectorAll<HTMLElement>("[data-profile-section-key]"));
  if (elements.length === 0) return null;
  const draggedElement = elements.find(
    (element) => element.dataset.profileSectionKey === sectionKey,
  );
  if (!draggedElement) return null;
  // 拖拽期强制真实布局：离屏分区默认 `content-visibility: auto`，rect 高度会退化成
  // `contain-intrinsic-size` 的 420px 假高度（真机实测：屏幕外分区全部 h=420，
  // 实际 1280/880/688…）。不先把类补上就量，向下拖到视口外时几何整段错位。
  // 这里同步补类（React 侧随后由 `reordering` prop 保持同一个类），再读 rect。
  elements.forEach((element) => element.classList.add(SECTION_REORDERING_CLASS));
  const rects = elements.map((element) => element.getBoundingClientRect());
  const heightByKey = new Map<string, number>();
  elements.forEach((element, index) => {
    heightByKey.set(element.dataset.profileSectionKey ?? "", rects[index].height);
  });
  const heights = order.map((key) => heightByKey.get(key) ?? 0);

  // 分区栈按 CSS `order` 摆放后，DOM 顺序不再等于视觉顺序：栈几何按屏幕位置算。
  const visualRects = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
  const gap =
    visualRects.length >= 2
      ? Math.max(0, visualRects[1].top - (visualRects[0].top + visualRects[0].height))
      : 0;
  const stackTop = visualRects[0].top;
  // 栈底由前缀和推导（不用末项 bottom）：保证 clamp 上限与插入判定的前缀和自洽。
  const stackBottom = stackBottomOf(stackTop, gap, heights);

  const draggedRect = draggedElement.getBoundingClientRect();
  const rawOffset =
    pointerStartY !== null ? pointerStartY - draggedRect.top : draggedRect.height / 2;
  return {
    geometry: { stackTop, stackBottom, gap, heights },
    grabOffset: Math.min(Math.max(rawOffset, 0), draggedRect.height),
    draggedHeight: draggedRect.height,
    draggedTop: draggedRect.top,
    element: draggedElement,
  };
}
