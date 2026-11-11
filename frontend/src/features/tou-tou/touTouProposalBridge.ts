// SPDX-License-Identifier: Apache-2.0
/**
 * 助理写操作 → 投投提案卡的桥（#27F × #13D）。
 *
 * ## 数据从哪来
 *
 * #13D 把每次写工具的**结构化预览**随 SSE `tool` 事件下发，落在助手流式 store 的
 * `streamingTools[].preview`（`AssistantToolWritePreview`：
 * `{before, after, version_id, undo_text, resume_id, revision}`）。本模块只**订阅**
 * 那个 store（`subscribeAssistantStream` / `getAssistantStreamState`），不修改 w1 的
 * 任何文件；收到带预览的写操作就把它转成投投的提案卡。
 *
 * 两类来源分开处理：
 * 1. **已执行的写**（`call.preview` 非空）：卡片直接进"已执行"态，显示「旧值 → 新值 +
 *    撤销」；撤销 = `POST /api/resumes/{id}/versions/{vid}/restore`（带执行后的
 *    `revision` 做条件写），文案常驻"整份简历恢复到版本 X"。
 * 2. **待确认的写提案**（`call.proposal`，#13D/RF-01）：卡片进"待执行"态，
 *    「按这个改」= `POST /api/assistant/write-proposals/{id}/approve`（服务端存储参数
 *    执行）；执行后若拿不到版本号，则如实显示"该操作暂不支持撤销"。
 *
 * ## 去重
 *
 * store 每次 delta 都会通知订阅者，而同一批工具在 `streamingTools` 里位置稳定。
 * 用"来源 + 版本/提案 id"组成 key，在 hook 里记 `seen`，同一次写只出一次卡片。
 */
import type {
  AssistantToolCall,
  AssistantToolWritePreview,
  AssistantWriteProposal,
} from "../../types";
import {
  proposalFromToolPreview,
  type TouTouProposalDraft,
  type TouTouToolPreview,
} from "./touTouProposalStore";

/** 已执行写操作的卡片 id 前缀（测试与日志用）。 */
export const EXECUTED_PROPOSAL_PREFIX = "tt-executed";
/** 待确认写提案的卡片 id 前缀。 */
export const PENDING_PROPOSAL_PREFIX = "tt-pending";

/** #13D 预览 → 提案 store 的输入形状（多带上 doc 身份供撤销用）。 */
export interface ExecutedPreviewPayload {
  preview: AssistantToolWritePreview;
  /** 工具名（进卡片 id，便于同一次回复里区分多个写操作）。 */
  toolName: string;
}

/** 已执行写操作的稳定 key：版本号 + resume + 工具名。 */
export function executedPreviewKey(payload: ExecutedPreviewPayload): string {
  const { preview, toolName } = payload;
  return [
    toolName,
    String(preview.resume_id),
    String(preview.version_id),
    preview.after ?? "",
  ].join(":");
}

/** 待确认提案的稳定 key：proposal_id 本身全局唯一。 */
export function pendingProposalKey(proposal: AssistantWriteProposal): string {
  return proposal.proposal_id;
}

/** 从工具调用里取出"已执行"的预览（没有就是 null）。 */
export function executedPreviewOf(call: AssistantToolCall): ExecutedPreviewPayload | null {
  if (!call.preview) return null;
  return { preview: call.preview, toolName: call.name };
}

/** 从工具调用里取出"待确认"的写提案（没有就是 null）。 */
export function pendingProposalOf(call: AssistantToolCall): AssistantWriteProposal | null {
  return call.proposal ?? null;
}

function toStorePreview(preview: AssistantToolWritePreview): TouTouToolPreview {
  return {
    before: preview.before,
    after: preview.after,
    version_id: preview.version_id,
    undo_text: preview.undo_text,
  };
}

/**
 * 已执行写 → 提案草稿。`undo` 只在 `resume_id` 与 `version_id` 都有时才注入
 * （缺任何一个都如实显示"该操作暂不支持撤销"，不假装能撤）。
 */
export function draftFromExecutedPreview(
  payload: ExecutedPreviewPayload,
  undo: ((resumeId: number, versionId: number, revision: number | null) => Promise<void>) | null,
): TouTouProposalDraft | null {
  const { preview } = payload;
  if (!preview.version_id && !preview.after) return null;
  const resumeId = preview.resume_id;
  const versionId = preview.version_id;
  const canUndo = undo !== null && resumeId !== null && versionId !== null;
  return proposalFromToolPreview(
    `${EXECUTED_PROPOSAL_PREFIX}:${executedPreviewKey(payload)}`,
    "touTou.proposal.title",
    toStorePreview(preview),
    {
      // 写已经执行：卡片直接进可撤销态，不显示没有意义的"执行"按钮。
      initialStatus: "applied",
      undo: canUndo ? () => undo(resumeId, versionId, preview.revision) : undefined,
    },
  );
}

/** 待确认写提案 → 提案草稿：审批 = 执行（服务端存储参数，前端只递 proposal id）。 */
export function draftFromPendingProposal(
  proposal: AssistantWriteProposal,
  approve: ((proposalId: string) => Promise<unknown>) | null,
): TouTouProposalDraft {
  const changes = proposal.preview.changes ?? [];
  const before = changes.map((change) => `${change.field}: ${change.before ?? ""}`).join("\n");
  const after = changes.map((change) => `${change.field}: ${change.after ?? ""}`).join("\n");
  return {
    id: `${PENDING_PROPOSAL_PREFIX}:${proposal.proposal_id}`,
    titleKey: "touTou.proposal.writeTitle",
    before,
    after,
    // 版本号要等执行后才有；执行前如实显示"不支持撤销"。
    versionId: null,
    undoText: "",
    initialStatus: "pending",
    apply:
      approve === null
        ? undefined
        : async () => {
            await approve(proposal.proposal_id);
          },
  };
}

/**
 * 一条工具调用 → 一份提案草稿（优先已执行的 diff 预览，其次待确认提案）。
 * 两者都没有返回 null。
 */
export function draftFromToolCall(
  call: AssistantToolCall,
  handlers: {
    undoExecuted:
      ((resumeId: number, versionId: number, revision: number | null) => Promise<void>) | null;
    approvePending: ((proposalId: string) => Promise<unknown>) | null;
  },
): TouTouProposalDraft | null {
  const executed = executedPreviewOf(call);
  if (executed) {
    return draftFromExecutedPreview(executed, handlers.undoExecuted);
  }
  const pending = pendingProposalOf(call);
  if (pending) return draftFromPendingProposal(pending, handlers.approvePending);
  return null;
}
