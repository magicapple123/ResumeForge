// SPDX-License-Identifier: Apache-2.0
/**
 * 技能上限（与后端 schemas/skill.py 同一组数字）。
 *
 * 界面只拿它们做**提示**与输入截断：真正的校验在服务端（422）。数字写在这里是为了
 * 让"提示词 4,000 字 / 最多 10 个知识文件 / 合计 60,000 字"三处文案从同一份常量来，
 * 不靠人肉同步；后端另有一个守卫测试从工具描述里正则复核同一组数字。
 */
export const MAX_SKILL_PROMPT_CHARS = 4_000;
export const MAX_SKILL_FILE_CHARS = 20_000;
export const MAX_SKILL_FILES = 10;
export const MAX_SKILL_TOTAL_FILE_CHARS = 60_000;
/** 超过这个长度时提示"多个技能同时启用时会被截断"（本对话均分预算）。 */
export const SKILL_PROMPT_WARN_CHARS = 1_200;
/** 一个对话的技能提示词注入总预算（与后端 MAX_SKILL_PROMPT_CHARS 一致）。 */
export const SKILL_PROMPT_BUDGET_CHARS = 12_000;

/** 千分位格式化；固定 en-US 只做分隔符，避免受运行环境 locale 影响。 */
export function formatCount(value: number): string {
  return value.toLocaleString("en-US");
}
