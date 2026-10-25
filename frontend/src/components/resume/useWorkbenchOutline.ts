// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲结构命令 → 文档状态的接线（W06，从 `ResumeZoomModal` 拆出）。
 *
 * 两条出口，共用同一个 hook 是为了让"提交"与"预览"在同一个地方被看见：
 *
 * 1. `command`（拖拽落点 / 键盘 Enter / 属性区动作）：用纯函数算出新内容
 *    （`applyOutlineCommand`），按 id 对齐算"旧下标 → 新下标"把加粗 overlay 与事实标注的
 *    path 重映射——不做这一步，把第二个项目移到第一位后 `experience.1.*` 的加粗会绑到
 *    别的项目上——最后写回编辑器表单（标脏、记一次可撤回历史），保存仍由动作条统一触发。
 * 2. `preview` / `onPreview`（拖动过程中）：只是把"新顺序的内容"交给右栏画布，不写库、
 *    不进历史；松手时由 `command` 真正提交。两者共用同一套排序命令，不会出现
 *    "拖的时候看到 A、松手变成 B"。
 */
import { useCallback } from "react";
import type { RefObject } from "react";
import type { ResumeContent } from "../../types";
import {
  applyOutlineCommand,
  buildPathRemap,
  type OutlineCommand,
} from "../../features/resume-outline";
import type { PathRemap } from "../../features/resume-outline/paths";
import type { ResumeWorkbenchEditorHandle } from "./ResumeWorkbenchEditorColumn";
import {
  useWorkbenchStructurePreview,
  type WorkbenchStructurePreview,
} from "./useWorkbenchStructurePreview";

interface Options {
  editorRef: RefObject<ResumeWorkbenchEditorHandle | null>;
  /** 宿主把 overlay / 事实标注的 path 改到新下标（由 `ResumeDetailModal` 实现）。 */
  onRemapPaths?: (remap: PathRemap) => void;
  /**
   * 新内容的落点（缺省=直接写回编辑器表单；W03 传历史接线实现）。
   *
   * 第二个参数是"旧下标 → 新下标"的映射：历史快照里的加粗 overlay 必须与内容**同一步**
   * 换键，否则撤销会先退一个"只换了键"的空步骤。
   */
  commit?: (next: ResumeContent, remap: PathRemap) => void;
}

export interface WorkbenchOutlineBridge extends WorkbenchStructurePreview {
  /** 结构命令出口（大纲面板 `onCommand`）。 */
  command: (command: OutlineCommand, baseContent: ResumeContent) => void;
}

export function useWorkbenchOutline({
  editorRef,
  onRemapPaths,
  commit,
}: Options): WorkbenchOutlineBridge {
  const command = useCallback(
    (outlineCommand: OutlineCommand, baseContent: ResumeContent) => {
      const applied = applyOutlineCommand(baseContent, outlineCommand);
      if (!applied.ok) return;
      const remap = buildPathRemap(baseContent, applied.content);
      onRemapPaths?.(remap);
      if (commit) commit(applied.content, remap);
      else editorRef.current?.replaceContent(applied.content);
    },
    [commit, editorRef, onRemapPaths],
  );
  const { preview, handleStructurePreview } = useWorkbenchStructurePreview();
  return { command, preview, handleStructurePreview };
}
