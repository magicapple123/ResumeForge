// SPDX-License-Identifier: Apache-2.0
/**
 * 把助手流式事件里的写操作预览接进投投提案卡（#27F × #13D）。
 *
 * 只订阅、不修改：数据源是 w1 的 `assistantStreamStore` 两个公开出口
 * （`subscribeAssistantStream` / `getAssistantStreamState`），因此**不需要改
 * w1 的消息组件**。工具事件到达 → 一次/多次 store 通知 → 这里按
 * "已执行 diff / 待确认提案"两种来源各出一次提案卡。
 *
 * 参数化 adapter 只为了测试：单测可以喂一份假 store，不需要真的发流。
 */
import { useEffect, useRef } from "react";
import { approveWriteProposal } from "../../api/assistant";
import {
  getAssistantStreamState,
  subscribeAssistantStream,
} from "../assistant/hooks/assistantStreamStore";
import { restoreVersion } from "../resume-versions/versionsApi";
import type { AssistantToolCall } from "../../types";
import {
  draftFromToolCall,
  executedPreviewKey,
  executedPreviewOf,
  pendingProposalKey,
  pendingProposalOf,
} from "./touTouProposalBridge";
import { proposeTouTouChange } from "./touTouProposalStore";

export interface TouTouProposalStreamAdapter {
  subscribe: (listener: () => void) => () => void;
  getTools: () => readonly AssistantToolCall[];
}

const defaultAdapter: TouTouProposalStreamAdapter = {
  subscribe: subscribeAssistantStream,
  getTools: () => getAssistantStreamState().streamingTools,
};

/** 撤销 = 恢复整份简历到写前留档的命名版本（带执行后的 revision 做条件写）。 */
async function undoExecutedWrite(
  resumeId: number,
  versionId: number,
  revision: number | null,
): Promise<void> {
  await restoreVersion(resumeId, versionId, revision ?? undefined);
}

/** 待确认提案的"执行" = 后端批准并用**服务端存储的参数**执行。 */
async function approvePendingWrite(proposalId: string): Promise<unknown> {
  return approveWriteProposal(proposalId);
}

/** 扫描一次工具列表，把还没见过的写操作转成提案卡。 */
function scanForProposals(tools: readonly AssistantToolCall[], seen: Set<string>): void {
  for (const call of tools) {
    // 失败的写操作不做提案：它没有真正改动数据，也没有可撤销的版本。
    if (call.ok === false) continue;
    const executed = executedPreviewOf(call);
    const pending = pendingProposalOf(call);
    const key = executed
      ? `executed:${executedPreviewKey(executed)}`
      : pending
        ? `pending:${pendingProposalKey(pending)}`
        : null;
    if (!key || seen.has(key)) continue;
    seen.add(key);
    const draft = draftFromToolCall(call, {
      undoExecuted: undoExecutedWrite,
      approvePending: approvePendingWrite,
    });
    if (draft) proposeTouTouChange(draft);
  }
}

/**
 * 订阅助手流，把写操作实时翻译成投投提案卡。
 *
 * `seen` 用 ref 保存、跨流不重置：同一份 session 里重复到达的同一次写入不会反复弹卡；
 * 用户关掉卡片后也不会因为下一条 delta 又冒出来。
 */
export function useTouTouProposalBridge(
  adapter: TouTouProposalStreamAdapter = defaultAdapter,
): void {
  const seenRef = useRef<Set<string>>(new Set());
  useEffect(() => {
    const scan = () => scanForProposals(adapter.getTools(), seenRef.current);
    // 挂载时先扫一次：可能已经有工具结果在 store 里（例如从别的页面切回来）。
    scan();
    return adapter.subscribe(scan);
  }, [adapter]);
}
