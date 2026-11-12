// SPDX-License-Identifier: Apache-2.0
/**
 * 把一段转写结果接在已有文字后面（计划 §6 T13 的"追加语义"）。
 *
 * 规则只有三条：
 * 1. 已有文字为空 → 直接用转写结果；
 * 2. 已有文字以空白结尾 → 原样拼接（用户自己留了空格/换行）；
 * 3. 已有文字末字不是标点 → 统一补换行。中文补空格会显脏（"你好 今天…"），
 *    换行在答题框里看起来是正常的另起一行，且不会把两句话黏成一句。
 * 已有文字以标点结尾时直接接上，不再多打一个换行。
 *
 * 纯函数，不碰 React：追加语义要在单测里覆盖"已有文字 + 追加"，这是最容易被
 * 手写 value + text 弄错的地方（覆盖 vs 追加、黏连、重复空格）。
 */

/**
 * 句读类标点（中英文都算）：末字是它们时视为"这句话已经结束"。
 *
 * 中文标点用 unicode 区间写：CJK 符号区（\u3000-\u303f）覆盖、。！？；，：等，
 * 全角形式区（\uff00-\uffef）覆盖（）等。**不写字面标点**是因为 i18n 棘轮会把
 * 含 CJK 的代码行算成"未迁移的界面文案"，而这只是标点集合、永远不该翻译。
 */
const SENTENCE_END = /(?:[.!?;,:)\]}"'\u2026\u2014]|[\u3000-\u303f\uff00-\uffef])$/u;

/**
 * 分隔符：多行 TextArea 用换行；单行 Input（面试追问）用空格。
 *
 * 单行 input 的 DOM value 会把换行直接吃掉，"补换行"看起来就是两句话黏在一起，
 * 所以那里必须退化成空格——这是唯一能看见的分隔符，不改变"不覆盖原文"的语义。
 */
export type TranscriptSeparator = "newline" | "space";

export function appendTranscript(
  existing: string,
  transcript: string,
  options: { separator?: TranscriptSeparator } = {},
): string {
  const piece = (transcript ?? "").trim();
  if (!piece) return existing ?? "";
  const current = existing ?? "";
  if (!current) return piece;
  const separator = options.separator === "space" ? " " : "\n";
  if (/\s$/u.test(current)) return current + piece;
  if (SENTENCE_END.test(current)) return current + piece;
  return current + separator + piece;
}
