// SPDX-License-Identifier: Apache-2.0
/**
 * 投投写操作提案的模块级队列（#27F）。
 *
 * 与 `workbenchLayoutStore` / `profileSaveBridge` 同一套做法：提案的**生产者**可能是
 * 球（划词改写后回填）也可能是别处的动作，而**消费者**是挂在 `TouTouOrb` 上的提案卡，
 * 两者没有共享 props 链，用一块模块级快照最省。
 *
 * 数据形状**对齐 #13D 的 `preview`**：`{before, after, version_id, undo_text}`
 * （后端 `document_write_tools` 的结构化预览）。这里多存两个可选的执行函数：
 * 提案卡不自己发请求，"按这个改"与"撤销"由提出提案的那条链路注入——
 * 这样在 #13D 合入前，本模块与提案卡可以先独立测试、独立合入。
 */
import { useSyncExternalStore } from "react";
import type { MessageKey } from "../../i18n";

/** #13D 的 `ToolResult.preview` 结构（前端镜像；字段名与后端逐字对应）。 */
export interface TouTouToolPreview {
  before: string | null;
  after: string | null;
  version_id: number | string | null;
  undo_text: string;
}

export interface TouTouProposalDraft {
  /** 稳定 id：同一份提案重开时提案卡据此复位状态机。 */
  id: string;
  /** 提案标题（通常是"改这一段经历"这类动作名）。 */
  titleKey: MessageKey;
  /** 改前 / 改后的展示文本（diff 卡的两栏）。 */
  before: string;
  after: string;
  /** 撤销目标版本（来自 #13D 的 `version_id`）；null = 这条链路给不出可撤销版本。 */
  versionId: number | string | null;
  /** 执行后可撤销时给用户的提示（来自 #13D 的 `undo_text`）。 */
  undoText: string;
  /**
   * 提案卡打开时的初始状态。
   * - `pending`（默认）：还没执行，显示「按这个改 / 先不改」；
   * - `applied`：#13D 的 tool 事件把"已执行"的写操作连同 diff 一起送来时，
   *   卡片直接显示已执行 + 「撤销」，不再提供一个没有意义的"执行"按钮。
   */
  initialStatus?: "pending" | "applied";
  /** 执行提案（写操作）。缺省 = 还没有接线（#13D 未合入）。 */
  apply?: () => Promise<void>;
  /** 撤销提案（通常 = 恢复到 `versionId`）。缺省 = 该操作暂不支持撤销。 */
  undo?: () => Promise<void>;
}

let current: TouTouProposalDraft | null = null;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): TouTouProposalDraft | null {
  return current;
}

/** 提出一份提案（覆盖当前未处理提案：同一时刻只显示最新一份）。 */
export function proposeTouTouChange(draft: TouTouProposalDraft): void {
  current = draft;
  emit();
}

/** 收起当前提案；传 id 时只在仍是这份提案时收起（避免旧回调关掉新提案）。 */
export function clearTouTouProposal(id?: string): void {
  if (!current) return;
  if (id !== undefined && current.id !== id) return;
  current = null;
  emit();
}

export function getTouTouProposal(): TouTouProposalDraft | null {
  return current;
}

export function useTouTouProposal(): TouTouProposalDraft | null {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 测试清理：与其它 store 的 `reset*` 成对使用。 */
export function resetTouTouProposal(): void {
  current = null;
  emit();
}

/**
 * 把 #13D 的 `preview` 转成提案草稿。`apply` / `undo` / `initialStatus` 由调用方注入
 * 真实的写链路（执行过的写操作由 `applied` 直接进入可撤销态）。
 */
export function proposalFromToolPreview(
  id: string,
  titleKey: MessageKey,
  preview: TouTouToolPreview,
  handlers: Pick<TouTouProposalDraft, "apply" | "undo" | "initialStatus"> = {},
): TouTouProposalDraft {
  return {
    id,
    titleKey,
    before: preview.before ?? "",
    after: preview.after ?? "",
    versionId: preview.version_id,
    undoText: preview.undo_text,
    ...handlers,
  };
}
