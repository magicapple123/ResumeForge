// SPDX-License-Identifier: Apache-2.0
/**
 * 招呼语模板的变量渲染（#14D）：纯函数，缺键回落空串。
 *
 * 后端用 `format_map` + 安全字典渲染（缺键不抛 `KeyError`），前端预览必须与它同语义
 * ——否则"选中时看到的样子"和"真投出去的样子"会不一样：这里用同一个正则替换，
 * 未知变量原样保留（用户写的 `{微信}` 不会被悄悄吃掉），已知但没值的变量替换为空串。
 *
 * 只支持三个变量：`company` / `job_title` / `name`。新增变量要同时改后端安全字典。
 */
import type { ApplyQueueItem } from "../../../types";

/** 模板里认得的变量名（协议值，与后端 `format_map` 的安全字典同源）。 */
export const GREETING_TEMPLATE_VARIABLES = ["company", "job_title", "name"] as const;

export type GreetingTemplateVariable = (typeof GREETING_TEMPLATE_VARIABLES)[number];

export type GreetingTemplateValues = Record<GreetingTemplateVariable, string>;

/**
 * 从一条队列条目取出渲染变量。
 *
 * `name` 取不到候选人姓名（队列条目里没有这个字段），一律给空串——宁可少一句
 * "我是"，也不要在招呼语里塞进一个猜出来的名字。
 */
export function greetingValuesOf(item: ApplyQueueItem | null): GreetingTemplateValues {
  return {
    company: item?.company ?? "",
    job_title: item?.job_title ?? "",
    name: "",
  };
}

/** 渲染模板：`{company}` 这类变量按 `values` 替换，未知变量与没有值的变量按空串处理。 */
export function renderGreetingTemplate(
  body: string,
  values: Partial<GreetingTemplateValues> = {},
): string {
  return body.replace(/\{(\w+)\}/g, (placeholder: string, name: string) => {
    if (!(GREETING_TEMPLATE_VARIABLES as readonly string[]).includes(name)) return placeholder;
    return values[name as GreetingTemplateVariable] ?? "";
  });
}
