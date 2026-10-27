// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台与"文档保存通道"之间的三根线（W02 收尾从 `ResumeZoomModal` 拆出）。
 *
 * 拆出原因：外壳文件要同时装三栏编排 + 冲突条 + W14/W15/W06 挂载点，已贴住单文件 500 行
 * 预算（零豁免）。这三根线都是**纯接线**、不持有状态：
 *
 * 1. `handleContentSave`：把编辑器交来的正文送进条件写通道（有 pipeline 带 expectedRevision，
 *    没有则退回老宿主的无条件写）；
 * 2. `readLocalContent`：冲突时"比较 / 另存副本"要的本地内容（表单值 + 照片 + 纸面加粗）；
 * 3. `adoptLatest`：冲突"用最新的"——宿主替换 detail/html/layout 并清 overlay，本层再清表单草稿。
 */
import { useCallback } from "react";
import type { RefObject } from "react";
import type { ResumeContent, ResumeDetail } from "../../types";
import type { ResumeDocumentPipeline } from "../../features/resume-document/types";
import type { ResumeWorkbenchEditorHandle } from "./ResumeWorkbenchEditorColumn";

interface Options {
  documentPipeline?: ResumeDocumentPipeline;
  onSaveContent?: (content: ResumeContent, expectedRevision?: number) => Promise<number | void>;
  editorRef: RefObject<ResumeWorkbenchEditorHandle | null>;
  content?: ResumeContent | null;
  mergeLive?: (content: ResumeContent | null) => ResumeContent | null;
  /**
   * 中栏未挂载（两栏 / 单栏档）时的本地正文来源：统一历史里的文档内容。
   *
   * 冲突条上的「比较差异 / 另存副本」读的是"本地还没保存的那一版"；窄档的编辑器不在，
   * 只回落到宿主已保存的 `content` 会让这两个动作拿旧正文去比/去存。
   */
  documentContent?: () => ResumeContent | null;
}

export interface WorkbenchDocumentBridge {
  /** 第二个参数由整体保存状态机在"先版式后内容"的第二步显式给出。 */
  handleContentSave: (next: ResumeContent, expectedRevision?: number) => Promise<number | void>;
  /** 本地还没保存的内容（含照片与加粗 overlay）；null = 没有可比较的内容。 */
  readLocalContent: () => ResumeContent | null;
  /** "用最新的"：宿主替换本地文档，本层清掉表单草稿。 */
  adoptLatest: (latest: ResumeDetail) => Promise<void>;
}

export function useWorkbenchDocumentBridge({
  documentPipeline,
  onSaveContent,
  editorRef,
  content,
  mergeLive,
  documentContent,
}: Options): WorkbenchDocumentBridge {
  const handleContentSave = useCallback(
    async (next: ResumeContent, expectedRevision?: number): Promise<number | void> => {
      if (documentPipeline) {
        return await documentPipeline.saveContent(
          next,
          expectedRevision ?? documentPipeline.revision,
        );
      }
      return await onSaveContent?.(next, expectedRevision);
    },
    [documentPipeline, onSaveContent],
  );

  const readLocalContent = useCallback((): ResumeContent | null => {
    const local = editorRef.current?.readContent() ?? documentContent?.() ?? content ?? null;
    if (!local) return null;
    return mergeLive?.(local) ?? local;
  }, [content, documentContent, mergeLive, editorRef]);

  const adoptLatest = useCallback(
    async (latest: ResumeDetail): Promise<void> => {
      if (!documentPipeline) return;
      await documentPipeline.adoptLatest(latest);
      editorRef.current?.clearDraft();
    },
    [documentPipeline, editorRef],
  );

  return { handleContentSave, readLocalContent, adoptLatest };
}
