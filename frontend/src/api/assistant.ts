// SPDX-License-Identifier: Apache-2.0
/** AI 求职助手：会话历史、附件和流式消息。 */
import type {
  AssistantAttachmentInput,
  AssistantConversationBrief,
  AssistantConversationDetail,
  AssistantConversationForkPayload,
  AssistantMessage,
  AssistantSurface,
  AssistantStreamEvent,
  AssistantWriteProposal,
  ReasoningEffort,
} from "../types";
import type { Material } from "../types";
import { getFilenameFromDisposition, request, requestRaw } from "./client";
import { consumeSSE } from "./stream";

function surfaceQuery(surface: AssistantSurface): string {
  return `surface=${encodeURIComponent(surface)}`;
}

/**
 * 列出会话（P0-2）：服务端分页上限 200，支持按标题 / 首条消息关键词搜索。
 * 不再硬编码 limit=100——那会把第 101 条之后的会话从列表里"藏掉"。
 */
export function listAssistantConversations(
  surface: AssistantSurface = "page",
  keyword = "",
): Promise<AssistantConversationBrief[]> {
  const params = new URLSearchParams({ limit: "200" });
  if (keyword.trim()) params.set("keyword", keyword.trim());
  params.set("surface", surface);
  return request(`/assistant/conversations?${params.toString()}`);
}

/** 导出格式：Markdown（可读可贴）、纯文本（去掉标记）、JSON（结构化，便于再加工）。 */
export type ConversationExportFormat = "md" | "txt" | "json";

/** 导出对话为文件；返回 blob 与服务端建议的文件名。 */
export async function exportConversation(
  id: number,
  format: ConversationExportFormat = "md",
  surface: AssistantSurface = "page",
): Promise<{ blob: Blob; filename: string }> {
  // 响应是文件内容，不是 JSON：走 requestRaw（错误分类与 request() 一致），导出大对话
  // 走 export 预算（10 分钟）。注意：这条是普通导出，不是流式消息路径（SSE 不走这里）。
  const resp = await requestRaw(
    `/assistant/conversations/${id}/export?format=${format}&${surfaceQuery(surface)}`,
    { budget: "export" },
  );
  return {
    blob: await resp.blob(),
    filename:
      getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ??
      `conversation.${format}`,
  };
}

/**
 * 把一段对话存进资料箱。
 *
 * 存进去的是一份可读的对话记录，助手之后能读它、总结它，或按用户要求整理进个人资料。
 */
export function conversationToMaterial(
  id: number,
  payload: { title?: string; category?: string; note?: string } = {},
  surface: AssistantSurface = "page",
): Promise<Material> {
  return request(`/assistant/conversations/${id}/to-material?${surfaceQuery(surface)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/**
 * 新建会话。`welcome: true` 时后端会附上一条内置引导消息——首次进入助手页、
 * 还没有任何会话时用它生成"默认引导对话"。
 */
export function createAssistantConversation(
  title = "",
  options: { welcome?: boolean; surface?: AssistantSurface } = {},
): Promise<AssistantConversationBrief> {
  return request("/assistant/conversations", {
    method: "POST",
    body: JSON.stringify({
      title,
      welcome: options.welcome ?? false,
      surface: options.surface ?? "page",
    }),
  });
}

/**
 * 会话详情（B5 按需加载）：`options.message_limit > 0` 时后端只下发最新 N 条
 * （`has_earlier` 标记还有更早的，`messages_total` 如实给全量数）；不传 = 全量（旧行为）。
 */
export function getAssistantConversation(
  id: number,
  surface: AssistantSurface = "page",
  options: { message_limit?: number } = {},
): Promise<AssistantConversationDetail> {
  const query = options.message_limit
    ? `${surfaceQuery(surface)}&message_limit=${options.message_limit}`
    : surfaceQuery(surface);
  return request(`/assistant/conversations/${id}?${query}`);
}

/** 「加载更早」：取 before_id 之前（更旧）的至多 limit 条消息，按时间正序返回。 */
export function getEarlierAssistantMessages(
  id: number,
  beforeId: number,
  limit = 50,
  surface: AssistantSurface = "page",
): Promise<{ items: AssistantMessage[]; has_earlier: boolean }> {
  return request(
    `/assistant/conversations/${id}/messages/earlier?before_id=${beforeId}&limit=${limit}&${surfaceQuery(surface)}`,
  );
}

export function renameAssistantConversation(
  id: number,
  title: string,
  surface: AssistantSurface = "page",
): Promise<AssistantConversationBrief> {
  return request(`/assistant/conversations/${id}?${surfaceQuery(surface)}`, {
    method: "PATCH",
    body: JSON.stringify({ title }),
  });
}

export function updateAssistantConversation(
  id: number,
  patch: {
    title?: string;
    pinned?: boolean;
    favorite?: boolean;
    archived?: boolean;
    group_name?: string;
  },
  surface: AssistantSurface = "page",
): Promise<AssistantConversationBrief> {
  return request(`/assistant/conversations/${id}?${surfaceQuery(surface)}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

/** 「在新对话中继续」：复制这段会话最近的上下文到一段新会话。 */
export function forkAssistantConversation(
  id: number,
  payload: AssistantConversationForkPayload = {},
  surface: AssistantSurface = "page",
): Promise<AssistantConversationDetail> {
  return request(`/assistant/conversations/${id}/fork?${surfaceQuery(surface)}`, {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteAssistantConversation(
  id: number,
  surface: AssistantSurface = "page",
): Promise<void> {
  return request(`/assistant/conversations/${id}?${surfaceQuery(surface)}`, { method: "DELETE" });
}

/**
 * 删除单条消息。
 *
 * 引用它的消息不会被级联删除：引用块是快照，删掉原消息后引用仍然可读。
 */
export function deleteAssistantMessage(
  conversationId: number,
  messageId: number,
  surface: AssistantSurface = "page",
): Promise<void> {
  return request(
    `/assistant/conversations/${conversationId}/messages/${messageId}?${surfaceQuery(surface)}`,
    { method: "DELETE" },
  );
}

/**
 * 一次删除多条消息（多选模式走这里）。
 *
 * 单独走批量接口而不是循环调单条：后端在一个事务里删完并校验会话归属，中途失败不会
 * 留下"删了一半"的状态。一次最多 200 条。
 */
export function deleteAssistantMessages(
  conversationId: number,
  messageIds: number[],
  surface: AssistantSurface = "page",
): Promise<{ deleted: number }> {
  return request(
    `/assistant/conversations/${conversationId}/messages/delete?${surfaceQuery(surface)}`,
    {
      method: "POST",
      body: JSON.stringify({ message_ids: messageIds }),
    },
  );
}

export function sendAssistantMessage(
  id: number,
  payload: {
    content: string;
    job_id?: number | null;
    resume_id?: number | null;
    include_profile?: boolean;
    web_search?: boolean;
    reasoning_effort?: ReasoningEffort;
    /** 引用某条历史消息追问；被引用内容的快照会存进消息里。 */
    quoted_message_id?: number | null;
    attachments?: AssistantAttachmentInput[];
  },
  onEvent: (event: AssistantStreamEvent) => void,
  signal?: AbortSignal,
  surface: AssistantSurface = "page",
): Promise<void> {
  return consumeSSE(
    `/api/assistant/conversations/${id}/messages?${surfaceQuery(surface)}`,
    payload,
    onEvent,
    signal,
  );
}

/** 批准并执行一条写入提案（后端在同一次请求里完成"批准→核销→执行"）。 */
export async function approveWriteProposal(
  proposalId: string,
): Promise<{ proposal: AssistantWriteProposal; summary: string; changed: boolean }> {
  return request(`/assistant/write-proposals/${proposalId}/approve`, { method: "POST" });
}

/** 拒绝一条写入提案（终态，不可复活）。 */
export async function rejectWriteProposal(
  proposalId: string,
): Promise<{ proposal: AssistantWriteProposal }> {
  return request(`/assistant/write-proposals/${proposalId}/reject`, { method: "POST" });
}

/** 读取提案当前状态；404 表示提案已失效（后端重启或不存在）。 */
export async function getWriteProposal(
  proposalId: string,
): Promise<{ proposal: AssistantWriteProposal }> {
  return request(`/assistant/write-proposals/${proposalId}`);
}
