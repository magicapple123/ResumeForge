// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲结构命令 → 文档状态的接线（W06，从 `ResumeZoomModal` 拆出）。
 *
 * 一条命令做三件事，顺序固定：
 * 1. 用纯函数算出新内容（`applyOutlineCommand`，失败时 UI 已先判锁，这里静默返回）；
 * 2. 按 id 对齐算"旧下标 → 新下标"，把加粗 overlay 与事实标注的 path 重映射——
 *    不做这一步，把第二个项目移到第一位后，`experience.1.*` 的加粗会绑到别的项目上；
 * 3. 把新内容写回编辑器的表单（标脏、记一次可撤回历史），保存仍由动作条统一触发。
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

interface Options {
  editorRef: RefObject<ResumeWorkbenchEditorHandle | null>;
  /** 宿主把 overlay / 事实标注的 path 改到新下标（由 `ResumeDetailModal` 实现）。 */
  onRemapPaths?: (remap: PathRemap) => void;
  /** 新内容的落点（缺省=直接写回编辑器表单；W03 传历史接线实现）。 */
  commit?: (next: ResumeContent) => void;
}

export function useWorkbenchOutline({ editorRef, onRemapPaths, commit }: Options) {
  return useCallback(
    (command: OutlineCommand, baseContent: ResumeContent) => {
      const applied = applyOutlineCommand(baseContent, command);
      if (!applied.ok) return;
      const remap = buildPathRemap(baseContent, applied.content);
      onRemapPaths?.(remap);
      if (commit) commit(applied.content);
      else editorRef.current?.replaceContent(applied.content);
    },
    [commit, editorRef, onRemapPaths],
  );
}
