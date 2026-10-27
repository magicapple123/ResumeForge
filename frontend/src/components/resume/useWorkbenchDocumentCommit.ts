// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台里**正文改动与统一历史之间的窄档接线**（用户反馈 #4 的修复，从 `ResumeZoomModal` 拆出）。
 *
 * ## 为什么需要这一层
 *
 * 三栏档的正文是"中栏表单"在管：大纲命令与外部采纳都经 `editorRef.replaceContent` 写回表单，
 * 表单再把草稿送进 `draftStore`（右栏画布唯一的内容来源），脏值也由编辑器上报。
 *
 * **两栏 / 单栏档**（CSS 宽度 ≤1280px）把中栏收进抽屉，未打开时**根本没挂载**：
 * `editorRef.current` 是 null，`replaceContent` 是空操作。于是同一条大纲命令会变成
 * "左栏的树变了、右栏的纸面不动"，而且顶部不出现「保存修改」、关闭也不问一句——改动静默丢失。
 *
 * 这里补的就是那条缺失的出口，三件事一处收口：
 * 1. 结构命令后直接把新正文写进 `draftStore`，右栏实时预览立即跟随；
 * 2. 中栏未挂载时把"文档正文脏"上报给整体保存状态机（保存按钮 / 关闭确认的来源）；
 * 3. 提供该状态下一对保存 / 放弃出口（`WorkbenchDocumentContentBridge`）。
 *
 * 只在**中栏未挂载**时起作用；三栏档的行为逐字不变（脏值仍由编辑器上报、保存仍走表单）。
 */
import { useCallback, useState } from "react";
import type { RefObject } from "react";
import type { ResumeContent } from "../../types";
import type { PathRemap } from "../../features/resume-outline/paths";
import type { SaveOutcome } from "../../features/resume-document/types";
import type { ResumeDocumentPipeline } from "../../features/resume-document/types";
import { outcomeFromError } from "../../features/resume-document/saveOutcome";
import type { ResumeDraftStore } from "../../features/resume/resumeDraftContent";
import { contentSignature } from "../../utils/contentSignature";
import type { ResumeWorkbenchEditorHandle } from "./ResumeWorkbenchEditorColumn";
import type { WorkbenchDocumentContentBridge } from "./useWorkbenchOverallSave";
import type { WorkbenchHistory } from "./useWorkbenchHistory";

interface Options {
  /** 宿主已保存的正文（新的基线）；变化即"保存成功 / 用最新的 / 版本恢复"。 */
  content?: ResumeContent | null;
  documentPipeline?: ResumeDocumentPipeline;
  /** 中栏的句柄：null = 中栏未挂载（窄档且抽屉没打开）。 */
  editorRef: RefObject<ResumeWorkbenchEditorHandle | null>;
  /** 右栏画布唯一的内容来源。 */
  draftStore: ResumeDraftStore;
  /** 统一历史：结构命令改到的正文在这里。 */
  history: WorkbenchHistory;
  /** 文档写入通道（条件写 / 旧宿主的无条件写）。 */
  handleContentSave: (next: ResumeContent, expectedRevision?: number) => Promise<number | void>;
}

export interface WorkbenchDocumentCommit {
  /** 中栏未挂载时的正文脏值（并入整体脏值后才会有保存按钮与关闭确认）。 */
  dirty: boolean;
  /** 交替给 `useWorkbenchOverallSave` 的保存 / 放弃出口。 */
  bridge: WorkbenchDocumentContentBridge;
  /** 大纲结构命令的落点（先写历史，再补草稿与脏值）。 */
  outlineCommit: (next: ResumeContent, remap: PathRemap) => void;
}

export function useWorkbenchDocumentCommit({
  content,
  documentPipeline,
  editorRef,
  draftStore,
  history,
  handleContentSave,
}: Options): WorkbenchDocumentCommit {
  const [dirty, setDirty] = useState(false);
  /**
   * 宿主换了新的正文基线（保存成功 / 用最新的 / 版本恢复）：窄档的文档脏值归零。
   * 用"渲染期守卫式 state 调整"（与 `useWorkbenchOverallSave` 的 prevOpen 同一写法）：
   * ref 不允许在渲染期读写，effect 里 setState 又会多一轮级联渲染。
   */
  const [hostContent, setHostContent] = useState<ResumeContent | null | undefined>(content);
  if (!Object.is(hostContent, content)) {
    setHostContent(content);
    if (dirty) setDirty(false);
  }

  const save = useCallback(
    async (expectedRevision: number): Promise<SaveOutcome> => {
      try {
        const revision = await handleContentSave(history.content, expectedRevision);
        draftStore.clear();
        setDirty(false);
        return {
          status: "saved",
          revision: typeof revision === "number" ? revision : expectedRevision,
        };
      } catch (error) {
        return outcomeFromError(error);
      }
    },
    [draftStore, handleContentSave, history.content],
  );

  const discard = useCallback(() => {
    draftStore.clear();
    if (content) {
      history.restoreServerContent({ content, revision: documentPipeline?.revision ?? 0 });
    }
    setDirty(false);
  }, [content, documentPipeline?.revision, draftStore, history]);

  const outlineCommit = useCallback(
    (next: ResumeContent, remap: PathRemap) => {
      history.commitContent(next, undefined, remap);
      // 中栏未挂载时 replaceContent 是空操作：右栏画布的内容来源是草稿 store，必须直接写。
      draftStore.set(next, contentSignature(next));
      if (!editorRef.current) setDirty(true);
    },
    [draftStore, editorRef, history],
  );

  return { dirty, bridge: { dirty, save, discard }, outlineCommit };
}
