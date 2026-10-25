// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台的**结构预览**状态：大纲拖动排序时把"按新顺序排好的内容"临时交给右栏画布。
 *
 * 三条边界（与 W03 历史 / 保存链路的分工）：
 * 1. **只读**：这里永远不派发命令、不写库、不进历史；松手时仍由 `useWorkbenchOutline`
 *    的 commit 走既有链路（一条命令 = 一步历史）。
 * 2. **单值**：同一时刻最多一版预览；`null` = 没有预览（画布回落 `liveContent ?? content`）。
 * 3. **去重**：内容引用没变时不 setState——拖动中的 dragOver 很高频，重复 setState 会让
 *    整个三栏弹窗每帧重渲染（中栏表单也跟着重渲染，肉眼可见地卡）。
 */
import { useCallback, useState } from "react";
import type { ResumeContent } from "../../types";

export interface WorkbenchStructurePreview {
  /** 正在预览的一版内容；null = 没有预览。 */
  preview: ResumeContent | null;
  /** 大纲面板的预览出口（结束 / 取消时传 null）。 */
  handleStructurePreview: (content: ResumeContent | null) => void;
}

export function useWorkbenchStructurePreview(): WorkbenchStructurePreview {
  const [preview, setPreview] = useState<ResumeContent | null>(null);
  const handleStructurePreview = useCallback((content: ResumeContent | null) => {
    setPreview((previous) => (previous === content ? previous : content));
  }, []);
  return { preview, handleStructurePreview };
}
