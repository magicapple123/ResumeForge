// SPDX-License-Identifier: Apache-2.0
/** 对话技能接口（T14）：一个对话启用了哪些技能 + 注入预算。 */
import { request } from "./client";
import type { AssistantSurface } from "../types";

/** 一个对话最多能启用几个技能；与后端 MAX_SKILLS_PER_CONVERSATION 一致。 */
export const MAX_CONVERSATION_SKILLS = 8;

/** 对话里已启用的一项技能（菜单一次拿全：名称 + 一句话适用场景）。 */
export interface ConversationSkillItem {
  id: number;
  name: string;
  description: string;
}

/** 单个技能在本对话里的加载明细（R05）：完整块多长、实际拼进去多长。 */
export interface ConversationSkillLoadItem {
  skill_id: number;
  /** 该技能完整块（表头 + 适用场景 + 提示词 + 知识文件名）的字符数。 */
  requested_chars: number;
  /** 实际拼进系统提示的字符数：未截断时等于 requested，整块跳过时为 0。 */
  loaded_chars: number;
}

/** 本对话的技能注入预算：used_chars 是"所选技能完整块的字符数之和"（可能超上限）。 */
export interface ConversationSkillBudget {
  used_chars: number;
  loaded_chars: number;
  limit_chars: number;
  truncated_skill_ids: number[];
  /**
   * 逐技能加载明细；截断 chip 用它显示"只加载了前 N 字"。
   *
   * 可选：草稿态（没有会话）与升级前的后端响应都没有这一段，此时 chip 退回不带
   * 数字的通用说明，不因为缺字段就崩掉或显示 0 字。
   */
  per_skill?: ConversationSkillLoadItem[];
}

/** GET/PUT /api/assistant/conversations/{id}/skills 的统一载荷。 */
export interface ConversationSkillsPayload {
  skill_ids: number[];
  skills: ConversationSkillItem[];
  budget: ConversationSkillBudget;
}

function surfaceQuery(surface: AssistantSurface): string {
  return `surface=${encodeURIComponent(surface)}`;
}

export function getConversationSkills(
  conversationId: number,
  surface: AssistantSurface = "page",
): Promise<ConversationSkillsPayload> {
  return request(`/assistant/conversations/${conversationId}/skills?${surfaceQuery(surface)}`);
}

/** 整体替换一个对话启用的技能；返回生效后的完整载荷（前端直接覆盖本地状态）。 */
export function setConversationSkills(
  conversationId: number,
  skillIds: number[],
  surface: AssistantSurface = "page",
): Promise<ConversationSkillsPayload> {
  return request(`/assistant/conversations/${conversationId}/skills?${surfaceQuery(surface)}`, {
    method: "PUT",
    body: JSON.stringify({ skill_ids: skillIds }),
  });
}
