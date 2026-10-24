// SPDX-License-Identifier: Apache-2.0
/**
 * 服务端"已经写库"的两类新内容如何落回制作台（从 `ResumeZoomModal` 拆出，行数预算）。
 *
 * | 来源 | 落地方式 |
 * | --- | --- |
 * | W17 表达资产插入 | 路径按 id 重映射 → 写回中栏表单 → **记一步历史**（可撤销） |
 * | W13 版本恢复 | 写回中栏表单 → **清空历史**（服务端已是新基线，撤回到恢复前会不一致） |
 *
 * 版本弹窗也在这里渲染：外壳只拿到"打开入口 + 一个节点"，不再持有版本状态。
 */
import { useState } from "react";
import type { ResumeContent, ResumeDetail } from "../../types";
import type { VersionRestoreOut } from "../../features/resume-versions/types";
import type { WorkbenchHistory } from "./useWorkbenchHistory";
import VersionsModal from "./versions/VersionsModal";

interface Options {
  resumeId?: number;
  /** W02 当前 revision：恢复版本时作为 expected_revision（过期 409 不自动覆盖）。 */
  currentRevision?: number;
  /** 当前草稿正文：变体同步的路径来源（不会整份发送）。 */
  currentContent?: ResumeContent | null;
  history: WorkbenchHistory;
  /** 服务端已有新版本：宿主刷新 detail/html/revision。 */
  onDocumentSynced?: (detail: ResumeDetail) => void;
}

export interface WorkbenchServerSync {
  /** W17 插入成功：历史上记一步 + 刷新宿主。 */
  handlePhraseInserted: (resume: { content: unknown; revision: number }) => void;
  versions: {
    openVersions: () => void;
    /** 直接渲染到外壳里的版本弹窗节点。 */
    modalNode: React.ReactNode;
  };
}

export function useWorkbenchServerSync({
  resumeId,
  currentRevision,
  currentContent,
  history,
  onDocumentSynced,
}: Options): WorkbenchServerSync {
  const [versionsOpen, setVersionsOpen] = useState(false);

  const handlePhraseInserted = (resume: { content: unknown; revision: number }) => {
    history.applyInsertedContent(resume);
    onDocumentSynced?.(resume as unknown as ResumeDetail);
  };

  const handleRestored = (result: VersionRestoreOut) => {
    history.restoreServerContent({
      content: result.resume.content,
      revision: result.revision,
    });
    onDocumentSynced?.(result.resume as unknown as ResumeDetail);
  };

  return {
    handlePhraseInserted,
    versions: {
      openVersions: () => setVersionsOpen(true),
      modalNode: (
        <VersionsModal
          open={versionsOpen}
          onClose={() => setVersionsOpen(false)}
          resumeId={resumeId}
          currentRevision={currentRevision}
          currentContent={(currentContent ?? null) as Record<string, unknown> | null}
          onRestored={handleRestored}
        />
      ),
    },
  };
}
