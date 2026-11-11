// SPDX-License-Identifier: Apache-2.0
/** 助手技能接口：列出、查看详情、导入、创建、更新、启用/停用与删除。 */
import { request } from "./client";
import type {
  AssistantSkill,
  AssistantSkillCreatePayload,
  AssistantSkillDetail,
  AssistantSkillUpdatePayload,
} from "../types";

export function listSkills(): Promise<AssistantSkill[]> {
  return request("/assistant/skills");
}

/** 技能详情：含提示词正文，用于查看与编辑。 */
export function getSkill(id: number): Promise<AssistantSkillDetail> {
  return request(`/assistant/skills/${id}`);
}

/**
 * 导入一份技能：单个 `.md`（只有提示词）或一个 `.zip`（提示词 + 知识文件）。
 *
 * `Content-Type` 写死并用文件名区分，不信浏览器给的 `File.type`——系统映射给出的
 * 类型不可靠，而后端的类型白名单是拒绝导入的唯一依据。
 *
 * 请求体是裸文件字节，文件名不在里面，所以额外用一个头带上它：没有它，后端只能用
 * 随机临时文件名当技能名，而且同一个文件反复导入会变成一堆新技能而不是覆盖更新。
 * 头只能放 latin-1，中文文件名必须先编码。
 */
export async function importSkill(file: File): Promise<AssistantSkill> {
  const contentType = /\.zip$/i.test(file.name) ? "application/zip" : "text/markdown";
  return request("/assistant/skills/import", {
    method: "POST",
    headers: {
      "Content-Type": contentType,
      "X-Skill-Filename": encodeURIComponent(file.name),
    },
    body: file,
    // 技能包（含知识文件）可能有几 MB，走 upload 预算（10 分钟）。
    budget: "upload",
  });
}

/** 在工作台手动创建技能。 */
export function createSkill(payload: AssistantSkillCreatePayload): Promise<AssistantSkillDetail> {
  return request("/assistant/skills", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 更新技能；`files` 提交时整体替换知识文件。 */
export function updateSkill(
  id: number,
  payload: AssistantSkillUpdatePayload,
): Promise<AssistantSkillDetail> {
  return request(`/assistant/skills/${id}`, {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

export function setSkillEnabled(id: number, enabled: boolean): Promise<AssistantSkill> {
  return request(`/assistant/skills/${id}`, {
    method: "PATCH",
    body: JSON.stringify({ enabled }),
  });
}

export function deleteSkill(id: number): Promise<void> {
  return request(`/assistant/skills/${id}`, { method: "DELETE" });
}

// ===== #31D/E/F 技能学习（从对话生成技能，默认待验证）=====

/** 四段内容（缺一段后端即 422）。 */
export interface SkillLearningDraft {
  name: string;
  description: string;
  when_to_use: string;
  steps: string[];
  pitfalls: string[];
}

export interface SkillLearningDetection {
  conversation_id: number;
  /** repeat_workflow / persistent_rule / long_success_trajectory 的任意组合。 */
  triggers: string[];
  draft: SkillLearningDraft | null;
}

export interface SkillLearningAccepted {
  skill_id: number;
  name: string;
  mode: "create" | "update";
  version: number;
  generated: boolean;
  validation_status: string;
  near_duplicate_skill_id: number | null;
}

export interface SkillArchiveCandidate {
  skill_id: number;
  name: string;
  last_loaded_at: string | null;
}

/** 检测一个对话是否出现可生成技能的信号；证据不足时 triggers 为空、draft=null。 */
export function detectSkillCandidate(conversationId: number): Promise<SkillLearningDetection> {
  return request(`/assistant/skills/learning/detect?conversation_id=${conversationId}`);
}

/** 接受四段草稿：生成「待验证」技能（默认不启用），或更新近义的已有技能。 */
export function acceptSkillDraft(
  draft: SkillLearningDraft,
  existingSkillId?: number,
): Promise<SkillLearningAccepted> {
  return request("/assistant/skills/learning/accept", {
    method: "POST",
    body: JSON.stringify({ draft, existing_skill_id: existingSkillId ?? null }),
  });
}

/** 标记「已验证」（#31F）：首次被加载并完成任务后由用户确认。 */
export function validateSkill(id: number): Promise<SkillLearningAccepted> {
  return request(`/assistant/skills/learning/${id}/validate`, { method: "POST" });
}

/** 90 天未被加载的自动生成技能（只提示归档，不自动删）。 */
export function listSkillArchiveCandidates(): Promise<SkillArchiveCandidate[]> {
  return request("/assistant/skills/learning/archive-candidates");
}
