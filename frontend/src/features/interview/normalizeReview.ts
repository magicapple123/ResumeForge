// SPDX-License-Identifier: Apache-2.0
/**
 * 面试复盘数据的**防御性归一化**（纯函数，无副作用）。
 *
 * 历史记录的 `analysis` / `suggestions` 是模型生成后直接落库的 JSON，早年还出现过纯文本
 * 记录，服务端不做二次校验。界面直接读 `analysis.key_points.length` 就会在
 * `{"framework": "..."}` 这种**只写了一半**的记录上崩掉——
 * `TypeError: Cannot read properties of undefined (reading 'length')`，
 * 用户点「查看详情」看到的是一整页白屏。
 *
 * 所以渲染前一律过这两个函数：形状不认识就退回"没有可展示的分析"，绝不把 `undefined`
 * 漏给渲染层。类型上它们返回**完整**的结构（所有字段都有值），调用方不需要再写 `?.`。
 */
import type { InterviewAnalysis, ResumeSuggestion } from "../../types";

/** 只保留非空字符串，其它一律丢掉（模型常把要点写成对象或 null）。 */
function toStringList(value: unknown): string[] {
  if (!Array.isArray(value)) return [];
  return value
    .filter((item): item is string => typeof item === "string")
    .map((item) => item.trim())
    .filter((item) => item.length > 0);
}

/** 字符串字段的兜底：不是字符串就当空串（不去读 `String(obj)`，那会渲染出 [object Object]）。 */
function toText(value: unknown): string {
  return typeof value === "string" ? value : "";
}

/**
 * 把任意来源的 `analysis` 归一化成可安全渲染的答题思路。
 *
 * 返回 `null` 表示**没有可展示的分析**——三种情况都算：
 * 1. 不是对象（`null` / 数字 / 数组）；
 * 2. 是**字符串**：旧版纯文本记录，交给调用方走 legacy 分支展示原文；
 * 3. 是对象但四个字段全空（只有框架空串、三个数组都空）。
 */
export function normalizeReviewAnalysis(value: unknown): InterviewAnalysis | null {
  if (typeof value === "string") return null;
  if (value === null || typeof value !== "object" || Array.isArray(value)) return null;
  const raw = value as Record<string, unknown>;
  const analysis: InterviewAnalysis = {
    question: toText(raw.question),
    framework: toText(raw.framework),
    key_points: toStringList(raw.key_points),
    follow_up: toStringList(raw.follow_up),
    pitfalls: toStringList(raw.pitfalls),
  };
  const empty =
    analysis.framework.trim().length === 0 &&
    analysis.key_points.length === 0 &&
    analysis.follow_up.length === 0 &&
    analysis.pitfalls.length === 0;
  return empty ? null : analysis;
}

/**
 * 把任意来源的 `suggestions` 归一化成可安全渲染的建议列表。
 *
 * 不是数组就当空列表；每一项都保证 `evidence` 是字符串数组、其余四个字段是字符串——
 * `SuggestionsCard` 里 `item.evidence.length` 与 `item.suggestion` 因此都不会崩。
 * `priority` 只接受三个已知档位，未知值降级为 `"low"`（标签颜色按档位取，不能是任意串）。
 */
export function normalizeSuggestions(value: unknown): ResumeSuggestion[] {
  if (!Array.isArray(value)) return [];
  const result: ResumeSuggestion[] = [];
  for (const item of value) {
    if (item === null || typeof item !== "object" || Array.isArray(item)) continue;
    const raw = item as Record<string, unknown>;
    const priority =
      raw.priority === "high" || raw.priority === "medium" || raw.priority === "low"
        ? raw.priority
        : "low";
    result.push({
      priority,
      section: toText(raw.section),
      issue: toText(raw.issue),
      suggestion: toText(raw.suggestion),
      evidence: toStringList(raw.evidence),
    });
  }
  return result;
}
