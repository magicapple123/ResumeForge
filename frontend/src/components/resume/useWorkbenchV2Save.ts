// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台顶部那对整体动作（保存 / 取消）的 v2 状态机：脏值、两步提交、冲突、版式回滚。
 *
 * 与旧 useWorkbenchOverallSave 的差别只有"内容存在哪"：v2 的正文是一份 ResumeDocument，
 * 保存直接走宿主的 ResumeDocumentPipeline（条件写，409 进冲突态），不再经过编辑器表单句柄。
 * 顺序仍是先版式后正文：版式 PATCH 会返回重排后的 html，先落它，后面正文失败时"版式这一半"
 * 已经是确定的；两步之间本地推进 revision，不依赖宿主下一轮渲染。
 *
 * 快照只在对应一步确认落库之后才对…（对齐），提前对齐会让没存上的那一半看起来存上了。
 */
import { useMemo, useState } from "react";
import type { ResumeLayout } from "../../types";
import type { ResumeDocument } from "../../types/resumeDocument";
import { useDocumentSave } from "../../features/resume-document/useDocumentSave";
import type { ResumeDocumentPipeline, SaveOutcome } from "../../features/resume-document/types";
import { outcomeFromError } from "../../features/resume-document/saveOutcome";

/** 版式深拷贝：format_config 是嵌套对象，浅拷贝会让"打开时"与"现在"永远相等。 */
export function cloneLayout(layout: ResumeLayout): ResumeLayout {
  return JSON.parse(JSON.stringify(layout)) as ResumeLayout;
}

function signature(value: unknown): string {
  try {
    return JSON.stringify(value);
  } catch {
    return "";
  }
}

export interface WorkbenchV2SaveOptions {
  open: boolean;
  /** 当前草稿文档（用户眼前这一版）。 */
  document: ResumeDocument;
  /** 宿主那份已保存的正文：取消/放弃时退回它。 */
  serverDocument?: ResumeDocument | null;
  layout?: ResumeLayout;
  onApplyLayout?: (next: ResumeLayout) => void;
  documentPipeline?: ResumeDocumentPipeline;
  /** 没有 pipeline 的只读宿主（生成流程）：无条件写。 */
  onSaveContent?: (content: ResumeDocument, expectedRevision?: number) => Promise<number | void>;
  /** 老宿主的版式落库（无版本条件）；缺省时保存退化为"只存内容"。 */
  onCommitLayout?: () => Promise<boolean>;
  onPublishDraft?: () => Promise<boolean>;
  isDraft?: boolean;
  /** 取消：把本地文档退回宿主那一版。 */
  onResetDocument?: () => void;
  /**
   * 取消时回滚版式：把"打开制作台那一刻"的版式交给宿主。
   *
   * 与 onResetDocument 分开的原因：历史快照里的 layout 必须同步回打开版式，否则
   * 宿主 layout prop 变了、history.layout 还停在改后版式，dirty 永远清不掉。
   */
  onRestoreLayout?: (opening: ResumeLayout) => void;
}

export interface WorkbenchV2Save {
  dirty: boolean;
  documentDirty: boolean;
  layoutDirty: boolean;
  saving: boolean;
  conflict: boolean;
  saveFailed: boolean;
  save: () => Promise<void>;
  cancel: () => void;
  settleConflict: () => void;
  invalidateDocument: () => void;
  discardConfirm: boolean;
  setDiscardConfirm: (value: boolean) => void;
}

export function useWorkbenchV2Save({
  open,
  document,
  serverDocument,
  layout,
  onApplyLayout,
  documentPipeline,
  onSaveContent,
  onCommitLayout,
  onPublishDraft,
  isDraft = false,
  onResetDocument,
  onRestoreLayout,
}: WorkbenchV2SaveOptions): WorkbenchV2Save {
  // 打开那一刻的版式基线（取消/关闭时回滚到它）。
  const [layoutSnapshot, setLayoutSnapshot] = useState<ResumeLayout | null>(() =>
    open && layout ? cloneLayout(layout) : null,
  );
  const [documentBaseline, setDocumentBaseline] = useState<string>(() =>
    serverDocument ? signature(serverDocument) : "",
  );
  const [prevOpen, setPrevOpen] = useState(open);
  const [prevServer, setPrevServer] = useState<string>(() =>
    serverDocument ? signature(serverDocument) : "",
  );
  if (prevOpen !== open) {
    setPrevOpen(open);
    setLayoutSnapshot(open && layout ? cloneLayout(layout) : null);
    setDocumentBaseline(serverDocument ? signature(serverDocument) : "");
  }
  const serverSignature = serverDocument ? signature(serverDocument) : "";
  if (prevServer !== serverSignature) {
    setPrevServer(serverSignature);
    // 宿主换了一版（保存成功 / 用最新的）：把这版当新基线；内容与本地的差异仍算脏。
    setDocumentBaseline(serverSignature);
  }

  const documentSig = signature(document);
  const documentDirty = useMemo(
    () => documentSig !== documentBaseline,
    [documentBaseline, documentSig],
  );
  const layoutDirty = useMemo(() => {
    if (!layout || !layoutSnapshot) return false;
    return signature(layout) !== signature(layoutSnapshot);
  }, [layout, layoutSnapshot]);
  const dirty = documentDirty || layoutDirty;

  const [discardConfirm, setDiscardConfirm] = useState(false);

  const commitLayoutLegacy = async (): Promise<SaveOutcome> => {
    if (!onCommitLayout) return { status: "unchanged", revision: 0 };
    const committed = await onCommitLayout().catch(() => false);
    return committed === false
      ? { status: "failed", error: null }
      : { status: "saved", revision: 0 };
  };
  const publishDraftLegacy = async (): Promise<SaveOutcome> => {
    if (!onPublishDraft) return { status: "unchanged", revision: 0 };
    const published = await onPublishDraft().catch(() => false);
    return published === false
      ? { status: "failed", error: null }
      : { status: "saved", revision: 0 };
  };

  const perform = async (): Promise<SaveOutcome> => {
    let written = false;
    let revision = documentPipeline?.revision ?? 0;
    let savedLayout = false;
    let savedDocument = false;
    if (layoutDirty) {
      const outcome = documentPipeline
        ? await documentPipeline.saveLayout(revision)
        : await commitLayoutLegacy();
      if (outcome.status === "conflict" || outcome.status === "failed") return outcome;
      written = outcome.status === "saved" || written;
      revision = outcome.revision;
      savedLayout = true;
    }
    if (documentDirty) {
      if (documentPipeline) {
        try {
          revision = await documentPipeline.saveContent(document, revision);
          written = true;
          savedDocument = true;
        } catch (error) {
          const outcome = outcomeFromError(error);
          if (outcome.status === "conflict" || outcome.status === "failed") return outcome;
        }
      } else if (onSaveContent) {
        try {
          const next = await onSaveContent(document, revision);
          if (typeof next === "number") revision = next;
          written = true;
          savedDocument = true;
        } catch (error) {
          return outcomeFromError(error);
        }
      }
    }
    if (isDraft && !documentDirty && !layoutDirty) {
      const published = documentPipeline
        ? await documentPipeline.publishDraft(revision)
        : await publishDraftLegacy();
      if (published.status === "conflict" || published.status === "failed") return published;
      written = written || published.status === "saved";
    }
    // 对应的一步真的落库之后才对齐基线（失败/冲突那半保持脏，用户能重试）。
    if (savedLayout) setLayoutSnapshot(layout ? cloneLayout(layout) : null);
    if (savedDocument) setDocumentBaseline(documentSig);
    return written ? { status: "saved", revision } : { status: "unchanged", revision };
  };

  const documentSave = useDocumentSave({ perform });

  /** 放弃修改：退回宿主正文 + 回滚版式（只回滚真的动过的那一维）。 */
  const cancel = () => {
    onResetDocument?.();
    if (layoutDirty && layoutSnapshot) {
      const opening = cloneLayout(layoutSnapshot);
      // 先让历史快照回到打开版式（dirty 的唯一来源），再交给宿主重排；
      // 只做后者会出现"纸面回去了、保存按钮还在"的残留脏值。
      if (onRestoreLayout) {
        onRestoreLayout(opening);
      } else {
        onApplyLayout?.(opening);
      }
    }
    setDiscardConfirm(false);
  };

  return {
    dirty,
    documentDirty,
    layoutDirty,
    saving: documentSave.saving,
    conflict: documentSave.conflict,
    saveFailed: documentSave.status === "failed",
    save: documentSave.save,
    cancel,
    settleConflict: documentSave.settleConflict,
    invalidateDocument: documentSave.invalidate,
    discardConfirm,
    setDiscardConfirm,
  };
}
