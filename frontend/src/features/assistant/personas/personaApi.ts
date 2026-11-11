// SPDX-License-Identifier: Apache-2.0
/**
 * 助手视角接口（18C，后端 app/api/assistant_breadth.py）。
 *
 * 视角是**预设提示词**：后端把视角 prompt 作为内置技能挂到当前对话（系统提示下一轮生效），
 * 工具集完全不变。前端只负责选、显示与切换，不自己拼提示词。
 */
import { request } from "../../../api/client";

/** 三个 preset 的协议值（与后端 services/assistant/assistant_personas.py 逐字一致）。 */
export const PERSONA_IDS = ["hr_scan", "interviewer", "headhunter"] as const;
export type PersonaId = (typeof PERSONA_IDS)[number];
/** 空串 = 不启用视角（通用助手）。 */
export type PersonaSelection = "" | PersonaId;

export interface PersonaListResponse {
  items: Array<{ id: PersonaId }>;
  count: number;
}

export function listPersonas(): Promise<PersonaListResponse> {
  return request<PersonaListResponse>("/assistant/personas", { budget: "task" });
}

export function readConversationPersona(
  conversationId: number,
): Promise<{ persona_id: PersonaSelection }> {
  return request<{ persona_id: PersonaSelection }>(
    `/assistant/conversations/${conversationId}/persona`,
    { budget: "task" },
  );
}

export function saveConversationPersona(
  conversationId: number,
  personaId: PersonaSelection,
): Promise<{ persona_id: PersonaSelection }> {
  return request<{ persona_id: PersonaSelection }>(
    `/assistant/conversations/${conversationId}/persona`,
    {
      method: "PUT",
      body: JSON.stringify({ persona_id: personaId }),
      budget: "task",
    },
  );
}
