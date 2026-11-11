// SPDX-License-Identifier: Apache-2.0
/**
 * #27F × #13D 的纯逻辑：写操作预览 → 提案草稿、去重 key、撤销/审批回调注入。
 * 不依赖 React，也不真正发请求（回调注入后断言参数）。
 */
import { describe, expect, it, vi } from "vitest";
import type {
  AssistantToolCall,
  AssistantToolWritePreview,
  AssistantWriteProposal,
} from "../../types";
import {
  draftFromExecutedPreview,
  draftFromPendingProposal,
  draftFromToolCall,
  executedPreviewKey,
  executedPreviewOf,
  pendingProposalKey,
  pendingProposalOf,
} from "./touTouProposalBridge";

const PREVIEW: AssistantToolWritePreview = {
  before: "负责后端开发",
  after: "用 Go 重构订单服务，P99 从 800ms 降到 120ms",
  version_id: 7,
  undo_text: "整份简历恢复到版本「助手修改前」",
  resume_id: 3,
  revision: 12,
};

function call(extra: Partial<AssistantToolCall> = {}): AssistantToolCall {
  return {
    name: "update_resume_field",
    arguments: { resume_id: 3 },
    summary: "改了一段经历",
    link: "",
    ok: true,
    error: "",
    ...extra,
  };
}

describe("已执行的写 → 提案草稿（可撤销）", () => {
  it("字段逐字对齐 #13D，并直接进入已执行态", () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const draft = draftFromExecutedPreview(
      { preview: PREVIEW, toolName: "update_resume_field" },
      undo,
    );
    expect(draft).not.toBeNull();
    expect(draft).toMatchObject({
      titleKey: "touTou.proposal.title",
      before: PREVIEW.before,
      after: PREVIEW.after,
      versionId: 7,
      undoText: PREVIEW.undo_text,
      initialStatus: "applied",
    });
    expect(draft?.apply).toBeUndefined(); // 已经执行：不再提供"执行"
  });

  it("撤销回调带 (resumeId, version_id, revision) 三个参数（条件写）", async () => {
    const undo = vi.fn().mockResolvedValue(undefined);
    const draft = draftFromExecutedPreview(
      { preview: PREVIEW, toolName: "update_resume_field" },
      undo,
    );
    await draft?.undo?.();
    expect(undo).toHaveBeenCalledWith(3, 7, 12);
  });

  it("没有 resume_id / version_id 时如实不给撤销入口", () => {
    const undo = vi.fn();
    const draft = draftFromExecutedPreview(
      { preview: { ...PREVIEW, resume_id: null }, toolName: "update_resume_field" },
      undo,
    );
    expect(draft?.undo).toBeUndefined();
    const noVersion = draftFromExecutedPreview(
      { preview: { ...PREVIEW, version_id: null }, toolName: "update_resume_field" },
      undo,
    );
    expect(noVersion?.undo).toBeUndefined();
  });

  it("before 为 null（新增）时留空串，由卡片用「新增」兜底", () => {
    const draft = draftFromExecutedPreview(
      { preview: { ...PREVIEW, before: null }, toolName: "update_resume_field" },
      vi.fn(),
    );
    expect(draft?.before).toBe("");
  });

  it("去重 key 区分不同版本/工具", () => {
    const a = executedPreviewKey({ preview: PREVIEW, toolName: "update_resume_field" });
    const b = executedPreviewKey({
      preview: { ...PREVIEW, version_id: 8 },
      toolName: "update_resume_field",
    });
    expect(a).not.toBe(b);
    expect(executedPreviewKey({ preview: PREVIEW, toolName: "x" })).not.toBe(a);
  });

  it("没有预览/没有版本也没有 after 时不产提案", () => {
    expect(
      draftFromExecutedPreview(
        { preview: { ...PREVIEW, version_id: null, after: null }, toolName: "t" },
        vi.fn(),
      ),
    ).toBeNull();
  });
});

describe("待确认写提案 → 提案草稿（可执行）", () => {
  it("用 preview.changes 拼旧值/新值，执行 = 批准提案", async () => {
    const approve = vi.fn().mockResolvedValue({ summary: "ok", changed: true });
    const draft = draftFromPendingProposal(
      {
        proposal_id: "wp-1",
        tool_name: "update_resume_field",
        dataset_id: "main",
        created_at: "2026-11-11T00:00:00Z",
        expires_at: "2026-11-11T00:10:00Z",
        status: "pending",
        preview: {
          target: "简历·工作经历",
          scope: "一个字段",
          changes: [{ field: "description", before: "旧", after: "新" }],
        },
      },
      approve,
    );
    expect(draft).toMatchObject({
      id: "tt-pending:wp-1",
      titleKey: "touTou.proposal.writeTitle",
      before: "description: 旧",
      after: "description: 新",
      initialStatus: "pending",
      versionId: null,
    });
    await draft.apply?.();
    expect(approve).toHaveBeenCalledWith("wp-1");
    expect(draft.undo).toBeUndefined(); // 版本号要等执行后才有
  });
});

describe("工具调用 → 提案草稿（优先级与空值）", () => {
  it("同时有 preview 与 proposal 时优先已执行的 diff", () => {
    const draft = draftFromToolCall(
      call({
        preview: PREVIEW,
        proposal: {
          proposal_id: "wp-1",
          tool_name: "update_resume_field",
          dataset_id: "main",
          created_at: "",
          expires_at: "",
          status: "pending",
          preview: { target: "t", scope: "s", changes: [] },
        },
      }),
      { undoExecuted: vi.fn(), approvePending: vi.fn() },
    );
    expect(draft?.initialStatus).toBe("applied");
  });

  it("两者都没有 → null；proposal 单独存在 → pending", () => {
    expect(
      draftFromToolCall(call(), { undoExecuted: vi.fn(), approvePending: vi.fn() }),
    ).toBeNull();
    const pending = draftFromToolCall(
      call({
        proposal: {
          proposal_id: "wp-2",
          tool_name: "update_profile",
          dataset_id: "main",
          created_at: "",
          expires_at: "",
          status: "pending",
          preview: {
            target: "资料",
            scope: "一个字段",
            changes: [{ field: "city", before: "北京", after: "上海" }],
          },
        },
      }),
      { undoExecuted: vi.fn(), approvePending: vi.fn() },
    );
    expect(pending?.initialStatus).toBe("pending");
  });

  it("取值助手只认工具调用里的那两个字段", () => {
    expect(executedPreviewOf(call())).toBeNull();
    expect(pendingProposalOf(call())).toBeNull();
    expect(executedPreviewOf(call({ preview: PREVIEW }))?.toolName).toBe("update_resume_field");
    expect(pendingProposalKey({ proposal_id: "wp-2" } as AssistantWriteProposal)).toBe("wp-2");
  });
});
