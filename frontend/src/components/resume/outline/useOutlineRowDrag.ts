// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲行的**整行拖起**（用户反馈 #4：用户抓行/标题拖，而旧实现只有 18px 手柄可拖）。
 *
 * 三条边界，写在这里而不是面板里：
 * 1. **手柄自己的 dragstart 优先**：手柄是给键盘用户的精确入口，它的事件已经在
 *    `OutlineRows` 里处理过；行级处理器看到事件来自手柄就直接让路（否则会拖两次）；
 * 2. **行内动作按钮不劫持拖动**：隐藏/复制按钮被按住拖动时 cancel 掉 dragstart——
 *    用户想点按钮，不该变成"把条目拖走"；
 * 3. 行本身可拖之后，**点击选中仍然成立**（浏览器只在真的移动后才进入拖放，不会吃掉 click）。
 */
import type { DragEvent } from "react";
import type { OutlineEntry, OutlinePoint } from "../../../features/resume-outline/model";

interface Options {
  beginEntryDrag: (entry: OutlineEntry) => void;
  beginPointDrag: (entry: OutlineEntry, point: OutlinePoint) => void;
  /** 只读宿主（无 onCommand）不拖：与面板不渲染手柄同一判据。 */
  enabled: boolean;
}

export interface OutlineRowDragApi {
  startEntryRowDrag: (entry: OutlineEntry, event: DragEvent<HTMLDivElement>) => void;
  startPointRowDrag: (
    entry: OutlineEntry,
    point: OutlinePoint,
    event: DragEvent<HTMLDivElement>,
  ) => void;
}

export function useOutlineRowDrag({
  beginEntryDrag,
  beginPointDrag,
  enabled,
}: Options): OutlineRowDragApi {
  const startEntryRowDrag = (entry: OutlineEntry, event: DragEvent<HTMLDivElement>) => {
    if (!enabled) return;
    const target = event.target as HTMLElement | null;
    // 手柄自己的 dragstart 已经把 payload/会话建好了：这里只让路，不重复开始。
    if (target?.closest?.("button.resume-outline-handle")) return;
    // 行内动作按钮（隐藏/复制）不劫持拖动：按住它们移动不应把条目拖走。
    if (target?.closest?.("button")) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData("text/plain", entry.objectId);
    beginEntryDrag(entry);
  };

  const startPointRowDrag = (
    entry: OutlineEntry,
    point: OutlinePoint,
    event: DragEvent<HTMLDivElement>,
  ) => {
    if (!enabled) return;
    const target = event.target as HTMLElement | null;
    if (target?.closest?.("button.resume-outline-handle")) return;
    if (target?.closest?.("button")) {
      event.preventDefault();
      return;
    }
    event.dataTransfer?.setData("text/plain", point.pointId);
    beginPointDrag(entry, point);
  };

  return { startEntryRowDrag, startPointRowDrag };
}
