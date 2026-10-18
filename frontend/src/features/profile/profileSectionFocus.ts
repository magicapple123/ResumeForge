/**
 * 分区排序后的**焦点收尾**（R10）：把焦点送回被移动的那个分区。
 *
 * 从 `useProfileSectionReorder.ts` 抽出以满足单文件 500 行预算，行为逐字保留：
 *
 * DOM 里分区是按 CSS `order` 摆放的，顺序一变，键盘用户原来聚焦的节点还在旧的
 * tab 序位置，接着按键就动到别的分区去了。优先聚焦拖动把手（它自带方向键），
 * 没有把手（`basic_info`）时退到分区根节点（`tabIndex=-1`，可编程聚焦）。
 * **绝不**聚焦上移/下移按钮：越到边界越会 disabled，焦点会掉回 body。
 *
 * 之所以走 `requestAnimationFrame`：顺序提交（store notify → React 重渲 → 新内联
 * `order` 落到 DOM）要到下一帧才生效，同步聚焦会落到旧的视觉位置上。
 */

import type { ProfileSectionKey } from "../../components/profile/ProfileSectionConfig";

/** 把焦点送回被移动的分区（下一帧执行，此时新顺序已落到 DOM）。 */
export function focusReorderedSection(sectionKey: ProfileSectionKey): void {
  requestAnimationFrame(() => {
    const root = document.querySelector<HTMLElement>(`[data-profile-section-key="${sectionKey}"]`);
    if (!root) return;
    const handle = root.querySelector<HTMLElement>(".profile-section-drag-handle");
    (handle ?? root).focus({ preventScroll: true });
  });
}
