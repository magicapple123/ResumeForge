// SPDX-License-Identifier: Apache-2.0
/**
 * #7 结构树**条目行**的菜单动作（上移 / 下移 / 移除 / 排版整条 / 边界判断）。
 *
 * 从 `useStructurePanel` 拆出：那支 hook 已接近 500 行预算，而这一组动作只依赖
 * 「文档 + 一条命令出口 + 选中出口」，与树 / 搜索 / 拖拽状态无关，单独成文件既
 * 让预算留出余量，也让「条目右键能做什么」只有一个落点。
 *
 * 菜单的**结构**（6 项 + 两条分隔线）不在这里：它与画布条目卡共用
 * `components/resume-editor/entryMenuItems.ts`，本文件只管点击之后做什么。
 */
import { useCallback } from "react";
import type { ResumeDocument } from "../../../types/resumeDocument";
import type { StructureNode } from "../../../features/resume-document/summarize";
import { removeEntry as removeEntryAtPath } from "../../../features/resume-document/entries";
import { t } from "../../../i18n";
import { moveEntryOneStep, type StructureCommandResult } from "./structureCommands";

export interface StructureEntryMenuApi {
  /** 上移一位（到边界时给提示，不改文档）。 */
  moveEntryUp: (node: StructureNode) => void;
  /** 下移一位。 */
  moveEntryDown: (node: StructureNode) => void;
  /** 移除条目：改完文档、清掉选中（被删的那一行不该继续是选中态）。 */
  removeEntry: (node: StructureNode) => void;
  /** 这一条还能不能往 `delta` 方向移动（菜单禁用态）。树节点不带下标，按文档里顺序判。 */
  canMoveEntry: (node: StructureNode, delta: -1 | 1) => boolean;
  /** 请求宿主为**整条**打开排版浮层；没有宿主时静默跳过（不弹空浮层）。 */
  requestEntryStyle: (request: { path: string; x: number; y: number }) => void;
}

export interface StructureEntryMenuOptions {
  document: ResumeDocument;
  readOnly: boolean;
  /** 命令执行器（成功才写文档、失败给"不能放这里 / 已到边界"提示）。 */
  run: (result: StructureCommandResult, successMessage?: string) => void;
  notify: (message: string) => void;
  onChange: (next: ResumeDocument) => void;
  onSelectPath?: (path: string | null) => void;
  /** 清空多选（删掉的条目不能留在批量目标里）。 */
  clearSelection: () => void;
  onRequestEntryStyle?: (request: { path: string; x: number; y: number }) => void;
}

export function useStructureEntryMenu({
  document,
  readOnly,
  run,
  notify,
  onChange,
  onSelectPath,
  clearSelection,
  onRequestEntryStyle,
}: StructureEntryMenuOptions): StructureEntryMenuApi {
  const canMoveEntry = useCallback(
    (node: StructureNode, delta: -1 | 1): boolean => {
      if (node.kind !== "entry" || !node.path || !node.sectionKey) return false;
      const section = document.sections.find((candidate) => candidate.key === node.sectionKey);
      if (!section) return false;
      const index = section.entries.findIndex((candidate) => candidate.id === node.entryId);
      if (index < 0) return false;
      return delta === -1 ? index > 0 : index < section.entries.length - 1;
    },
    [document],
  );

  const moveEntryUp = useCallback(
    (node: StructureNode) => run(moveEntryOneStep(document, node, -1)),
    [document, run],
  );
  const moveEntryDown = useCallback(
    (node: StructureNode) => run(moveEntryOneStep(document, node, 1)),
    [document, run],
  );

  const removeEntry = useCallback(
    (node: StructureNode) => {
      if (readOnly || node.kind !== "entry" || !node.path) return;
      const next = removeEntryAtPath(document, node.path);
      if (next === document) {
        notify(t("structure.drag.invalid"));
        return;
      }
      onChange(next);
      onSelectPath?.(null);
      clearSelection();
      notify(t("document.toast.entryRemoved"));
    },
    [clearSelection, document, notify, onChange, onSelectPath, readOnly],
  );

  const requestEntryStyle = useCallback(
    (request: { path: string; x: number; y: number }) => {
      if (readOnly) return;
      onRequestEntryStyle?.(request);
    },
    [onRequestEntryStyle, readOnly],
  );

  return { moveEntryUp, moveEntryDown, removeEntry, canMoveEntry, requestEntryStyle };
}
