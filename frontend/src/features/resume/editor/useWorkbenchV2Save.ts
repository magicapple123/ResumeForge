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
import type { ResumeLayout } from "../../../types";
import type { ResumeDocument } from "../../../types/resumeDocument";
import { useDocumentSave } from "../document/useDocumentSave";
import type { ResumeDocumentPipeline, SaveOutcome } from "../document/types";
import { outcomeFromError } from "../document/saveOutcome";

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

/** 一步保存的终态（QW-2 的二维结果：版式 / 正文各一格）。 */
export type SaveStepStatus = "saved" | "unchanged" | "failed" | "conflict";

/**
 * 一次整体保存的二维结果。
 *
 * `unchanged` 同时表示"这一维没有脏值、没发请求"与"服务端说不用写"——两者对用户是同一件事；
 * 版式失败后正文**不发请求**，那一格也是 `unchanged`（不是 `failed`：没有请求失败）。
 */
export interface SaveResult {
  /** 既有状态机消费的终态（冲突 / 失败 / 成功只由它决定）。 */
  outcome: SaveOutcome;
  layout: SaveStepStatus;
  document: SaveStepStatus;
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
  /**
   * QW-2：只存了版式（正文没脏）时的**唯一**一条成功提示。
   *
   * 以前版式那一步自己弹 toast，正文随后失败时用户先看到"保存成功"——现在成功提示只在
   * 真正确定"这一趟要存的东西都存上了"之后发一次：正文存了由宿主弹「简历修改已保存」，
   * 只存了版式才走这里。
   */
  notifyLayoutSaved?: () => void;
  /**
   * QW-5：恢复会话草稿时带上草稿的基准版本。保存用它做条件写——服务端版本已前进时
   * 自然拿到 409，走既有三选一浮层，而不是静默覆盖。
   */
  overrideRevision?: number | null;
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
  /** QW-2：最近一次保存的二维结果（版式 / 正文各自的终态）；没存过为 null。 */
  lastResult: SaveResult | null;
  /**
   * QW-2：版式已落库、正文没落库。动作条只出这一条提示 +「重试正文」，
   * 不再同时弹版式成功 toast、也不再重复渲染通用失败提示。
   */
  partialFailure: boolean;
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
  notifyLayoutSaved,
  overrideRevision = null,
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
  // R-30：宿主那份文档每帧都一样，序列化一次就够（以前每帧都全文档 JSON.stringify）。
  const serverSignature = useMemo(
    () => (serverDocument ? signature(serverDocument) : ""),
    [serverDocument],
  );
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
  const [lastResult, setLastResult] = useState<SaveResult | null>(null);

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

  /**
   * 一次完整保存：先版式、后正文，结果按**两维**记录。
   *
   * 与改动前相同的是顺序与"失败即停"；差别在对外表达：以前只回一个把两半揉在一起的
   * `SaveOutcome`，于是版式成功、正文失败时界面只有一句笼统的"保存没有成功"，而版式那半
   * 其实已经落库（宿主还会先弹一句成功 toast）。现在版式 / 正文各记一格，动作条据此
   * 只出一条「版式已保存，正文未保存」+「重试正文」。
   */
  const perform = async (): Promise<SaveOutcome> => {
    setLastResult(null);
    let revision = overrideRevision ?? documentPipeline?.revision ?? 0;
    let written = false;
    let savedLayout = false;
    let savedDocument = false;
    let layoutStatus: SaveStepStatus = "unchanged";
    let documentStatus: SaveStepStatus = "unchanged";
    let documentTried = false;
    let outcome: SaveOutcome | null = null;

    if (layoutDirty) {
      const layoutOutcome = documentPipeline
        ? await documentPipeline.saveLayout(revision)
        : await commitLayoutLegacy();
      layoutStatus = layoutOutcome.status;
      if (layoutOutcome.status === "conflict" || layoutOutcome.status === "failed") {
        // 版式没落库：正文**不发请求**（否则正文会写在一个连版式都没对齐的版本上）。
        outcome = layoutOutcome;
      } else {
        written = layoutOutcome.status === "saved" || written;
        revision = layoutOutcome.revision;
        savedLayout = true;
      }
    }

    if (!outcome && documentDirty) {
      documentTried = true;
      documentStatus = "failed";
      if (documentPipeline) {
        try {
          revision = await documentPipeline.saveContent(document, revision);
          written = true;
          savedDocument = true;
          documentStatus = "saved";
        } catch (error) {
          const failed = outcomeFromError(error);
          documentStatus = failed.status === "conflict" ? "conflict" : "failed";
          outcome = failed;
        }
      } else if (onSaveContent) {
        try {
          const next = await onSaveContent(document, revision);
          if (typeof next === "number") revision = next;
          written = true;
          savedDocument = true;
          documentStatus = "saved";
        } catch (error) {
          const failed = outcomeFromError(error);
          documentStatus = failed.status === "conflict" ? "conflict" : "failed";
          outcome = failed;
        }
      }
    }

    if (!outcome && isDraft && !documentDirty && !layoutDirty) {
      const published = documentPipeline
        ? await documentPipeline.publishDraft(revision)
        : await publishDraftLegacy();
      if (published.status === "conflict" || published.status === "failed") {
        outcome = published;
      } else {
        written = written || published.status === "saved";
      }
    }

    // 对应的一步真的落库之后才对齐基线（失败/冲突那半保持脏，用户能重试）。
    if (savedLayout) setLayoutSnapshot(layout ? cloneLayout(layout) : null);
    if (savedDocument) setDocumentBaseline(documentSig);

    const finalOutcome: SaveOutcome =
      outcome ?? (written ? { status: "saved", revision } : { status: "unchanged", revision });
    setLastResult({
      outcome: finalOutcome,
      // 版式失败后正文没跑：`failed` 只属于"发过请求并失败"，这里保留 unchanged。
      layout: layoutStatus,
      document: documentStatus,
    });
    // 只存了版式（正文没脏 / 没有正文通道）时补唯一一条成功提示；正文成功由宿主弹。
    if (savedLayout && !savedDocument && !documentTried && finalOutcome.status === "saved") {
      notifyLayoutSaved?.();
    }
    return finalOutcome;
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
    lastResult,
    partialFailure: lastResult?.layout === "saved" && lastResult.document === "failed",
    save: documentSave.save,
    cancel,
    settleConflict: documentSave.settleConflict,
    invalidateDocument: documentSave.invalidate,
    discardConfirm,
    setDiscardConfirm,
  };
}
