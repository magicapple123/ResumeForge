// SPDX-License-Identifier: Apache-2.0
/**
 * 助手记忆接口（#31C / #18D；后端 app/api/assistant_memory.py，前缀 /api/assistant/memories）。
 *
 * 记忆是**用户可见可改**的数据：手填（#18D，source=manual）与自动抽取（#31A，
 * source=extracted）共用同一张表。前端只做展示/编辑，白名单与敏感信息校验都在后端
 * （services/assistant/memory.py），这里不复制第二套规则。
 */
import { request } from "../../api/client";

/** 七类 kind（与后端 models/assistant_memory.py 的 MEMORY_KINDS 逐字一致）。 */
export const MEMORY_KINDS = [
  "target_role",
  "city",
  "salary_floor",
  "avoid_company",
  "work_mode",
  "skill_tag",
  "constraint",
] as const;
export type MemoryKind = (typeof MEMORY_KINDS)[number];

export type MemorySource = "manual" | "extracted";
export type MemoryStatus = "active" | "superseded" | "suppressed" | "deleted";

export interface AssistantMemory {
  id: number;
  kind: string;
  /** 后端给的展示名兜底；界面优先走语言包映射。 */
  kind_label: string;
  key: string;
  value: string;
  confidence: number;
  status: string;
  source: string;
  source_conversation_id: number | null;
  source_message_id: number | null;
  /** 来源消息摘录（≤60 字）：显示"这句话是从哪儿学来的"。 */
  source_excerpt?: string;
  created_at: string;
  updated_at: string;
}

export interface MemoryKindOption {
  kind: string;
  label: string;
}

export interface AssistantMemorySettings {
  auto_extract: boolean;
}

export interface AssistantMemoryCreateInput {
  kind: string;
  value: string;
  key?: string;
}

export interface AssistantMemoryUpdateInput {
  value: string;
  key?: string;
}

const MEMORY_BUDGET = "task" as const;

/** 列表：默认不含已删除（后端口径），按 updated_at 新→旧。 */
export function listAssistantMemories(): Promise<AssistantMemory[]> {
  return request<AssistantMemory[]>("/assistant/memories?limit=200", { budget: MEMORY_BUDGET });
}

/** kind 白名单 + 后端展示名（前端只用它兜底未知 kind）。 */
export function listMemoryKinds(): Promise<MemoryKindOption[]> {
  return request<MemoryKindOption[]>("/assistant/memories/kinds", { budget: MEMORY_BUDGET });
}

export function createAssistantMemory(input: AssistantMemoryCreateInput): Promise<AssistantMemory> {
  return request<AssistantMemory>("/assistant/memories", {
    method: "POST",
    body: JSON.stringify(input),
    budget: MEMORY_BUDGET,
  });
}

export function updateAssistantMemory(
  memoryId: number,
  input: AssistantMemoryUpdateInput,
): Promise<AssistantMemory> {
  return request<AssistantMemory>(`/assistant/memories/${memoryId}`, {
    method: "PATCH",
    body: JSON.stringify(input),
    budget: MEMORY_BUDGET,
  });
}

/** 删除（软删，不再注入；后台保留可回溯）。204 无正文。 */
export function deleteAssistantMemory(memoryId: number): Promise<void> {
  return request<void>(`/assistant/memories/${memoryId}`, {
    method: "DELETE",
    budget: MEMORY_BUDGET,
  });
}

/** 「永不使用」：停用（status=suppressed），条目仍在列表里，可恢复；不是删除。 */
export function neverUseAssistantMemory(memoryId: number): Promise<AssistantMemory> {
  return request<AssistantMemory>(`/assistant/memories/${memoryId}/never-use`, {
    method: "POST",
    budget: MEMORY_BUDGET,
  });
}

/** 「恢复使用」：把停用的条目改回 active，重新参与注入。 */
export function restoreAssistantMemory(memoryId: number): Promise<AssistantMemory> {
  return request<AssistantMemory>(`/assistant/memories/${memoryId}/restore`, {
    method: "POST",
    budget: MEMORY_BUDGET,
  });
}

export interface AssistantMemoryEvent {
  id: number;
  action: string;
  before: string;
  after: string;
  at: string;
}

/** 变更历史（时间倒序，最多 50 条）。 */
export function getAssistantMemoryHistory(memoryId: number): Promise<AssistantMemoryEvent[]> {
  return request<AssistantMemoryEvent[]>(`/assistant/memories/${memoryId}/history`, {
    budget: MEMORY_BUDGET,
  });
}

export function getAssistantMemorySettings(): Promise<AssistantMemorySettings> {
  return request<AssistantMemorySettings>("/assistant/memories/settings", {
    budget: MEMORY_BUDGET,
  });
}

export function saveAssistantMemorySettings(
  autoExtract: boolean,
): Promise<AssistantMemorySettings> {
  return request<AssistantMemorySettings>("/assistant/memories/settings", {
    method: "PUT",
    body: JSON.stringify({ auto_extract: autoExtract }),
    budget: MEMORY_BUDGET,
  });
}
