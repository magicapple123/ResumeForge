// SPDX-License-Identifier: Apache-2.0
/**
 * 投投「顺便问」侧问客户端（#27E）。
 *
 * 侧问 = 一次性问答：后端 `POST /api/assistant/side-ask` 问完即弃，不写会话、不写历史、
 * 不调工具。前端这边只负责"把这一问说清楚"：问题 + 可选选中文本 + 可选页面名。
 *
 * 动作指令（改写 / STAR / 找数字 / 解释 / 达不达标 / 关键词 / 识别填资料）都是
 * **喂给模型的 prompt**，不是界面文案——所以它们不在这里，而是按动作 id 拼成英文指令
 * （模型按用户问题的语言回答；界面语言由 i18n 负责，两者不混）。
 */
import { request } from "../../api/client";

/** 侧问请求体（字段与后端 `AssistantSideAskRequest` 逐字对应；超长在前端先截断）。 */
export interface TouTouSideAskPayload {
  question: string;
  selection?: string;
  page?: string;
}

export interface TouTouSideAskAnswer {
  answer: string;
  model: string;
}

export const SIDE_ASK_QUESTION_MAX = 2_000;
export const SIDE_ASK_SELECTION_MAX = 4_000;
export const SIDE_ASK_PAGE_MAX = 200;

function clip(value: string, max: number): string {
  const text = value.trim();
  return text.length > max ? text.slice(0, max) : text;
}

/** 发一次侧问。调用方负责 `AbortSignal` 与结果展示；本函数不写任何存储。 */
export function askTouTouSideQuestion(
  payload: TouTouSideAskPayload,
  options: { signal?: AbortSignal } = {},
): Promise<TouTouSideAskAnswer> {
  return request<TouTouSideAskAnswer>("/assistant/side-ask", {
    method: "POST",
    // 单次模型回答，和岗位解读同档预算（默认 15s 会误杀慢模型）。
    budget: "analysis",
    signal: options.signal,
    body: JSON.stringify({
      question: clip(payload.question, SIDE_ASK_QUESTION_MAX),
      selection: clip(payload.selection ?? "", SIDE_ASK_SELECTION_MAX),
      page: clip(payload.page ?? "", SIDE_ASK_PAGE_MAX),
    }),
  });
}

/** 划词动作里需要模型回答的那几种。本地动作（复制/存资料库/查重复）不在其中。 */
export type TouTouSideAskAction =
  "rewrite" | "star" | "numbers" | "jd-match" | "keywords" | "explain" | "recognize";

/**
 * 动作指令（prompt，不进语言包）。
 *
 * 三条共同约束：不许编造事实/数字、只回答这一问、用用户的语言回答。这和后端
 * system prompt 是同一条边界的两处保险。
 */
const ACTION_INSTRUCTIONS: Record<TouTouSideAskAction, string> = {
  rewrite:
    "Rewrite the selected resume text: keep every fact unchanged, do not invent numbers, tools or experiences, start with strong verbs and cut filler. Return one improved version only.",
  star: "Restructure the selected resume text as STAR (Situation, Task, Action, Result). Do not invent facts; if a part is missing, say what is missing instead of filling it.",
  numbers:
    "List the quantifiable facts already present in the selected text (numbers, scale, frequency, duration). If none exist, say so and point out which parts could be quantified without inventing values.",
  "jd-match":
    "The selected text is from a job description. Go through its concrete requirements one by one and say whether the user's resume evidence visible in the provided context supports each requirement. Be explicit about what you cannot see.",
  keywords:
    "Extract the keywords and skills this job description emphasizes, split into hard requirements and nice-to-have, keep the original wording.",
  explain:
    "Explain the selected passage in plain language in a few sentences, then give one concrete next step the user can take for their application.",
  recognize:
    "The selected text is pasted content (for example from a clipboard). Identify which Profile fields it can fill (name, phone, email, city, education, experience, skills) and output them as a short field: value list. Do not save anything.",
};

/** 拼给模型的问题：动作指令 + 选中文本由 `selection` 字段单独携带。 */
export function buildSideAskQuestion(action: TouTouSideAskAction, extra?: string | null): string {
  const suffix = extra?.trim() ? `\nAdditional user request: ${extra.trim()}` : "";
  return `${ACTION_INSTRUCTIONS[action]}${suffix}`;
}

export const SIDE_ASK_ACTION_INSTRUCTIONS = ACTION_INSTRUCTIONS;
