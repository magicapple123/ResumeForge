// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「保存 / 测试连接」失败时的统一措辞。
 *
 * 失败反馈必须回答两件事：**是哪一把 Key**、**是哪个字段**。
 * - 名称由调用方给：行、卡片本来就知道自己是谁，不需要从错误里猜；
 * - 字段优先取 FastAPI 422 的 `detail[].loc`（结构化、可靠）；没有结构化字段时
 *   保留后端原句——后端 400 的句子本身就带「怎么改」，改写反而会丢信息。
 *
 * 这里**不从错误文案里猜字段**：中文句子会随文案改，猜法一漂就会指错地方。
 */

import { ApiError } from "../../api/client";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";

/** 协议字段名 → 界面字段名。只收设置页真的会提交的字段；未登记的回落原值。 */
const FIELD_LABEL_KEYS: Record<string, MessageKey> = {
  api_key: "settingsErrors.field.apiKey",
  deepseek_api_key: "settingsErrors.field.deepseekApiKey",
  tavily_api_key: "settingsErrors.field.tavilyApiKey",
  jina_api_key: "settingsErrors.field.jinaApiKey",
  custom_api_key: "settingsErrors.field.customApiKey",
  base_url: "settingsErrors.field.baseUrl",
  model: "settingsErrors.field.model",
  api_style: "settingsErrors.field.apiStyle",
  protocol: "settingsErrors.field.protocol",
  name: "settingsErrors.field.name",
  sources: "settingsErrors.field.sources",
  depth: "settingsErrors.field.depth",
  max_results: "settingsErrors.field.maxResults",
  searxng_url: "settingsErrors.field.searxngUrl",
  custom_template: "settingsErrors.field.customTemplate",
  custom_name: "settingsErrors.field.customName",
  custom_base_url: "settingsErrors.field.customBaseUrl",
  custom_search_path: "settingsErrors.field.customSearchPath",
  custom_fetch_path: "settingsErrors.field.customFetchPath",
  custom_results_field: "settingsErrors.field.customResultsField",
  proxy_url: "settingsErrors.field.proxyUrl",
  proxy_password: "settingsErrors.field.proxyPassword",
  proxy_username: "settingsErrors.field.proxyUsername",
};

/** 单个字段的显示名；未登记时用协议值本身（不翻译，也不吞掉信息）。 */
export function fieldLabel(field: string): string {
  const key = FIELD_LABEL_KEYS[field];
  return key ? t(key) : field;
}

/**
 * FastAPI 校验错误的字段名：`loc` 里最后一个字符串（跳过 `body` 与数组下标）。
 *
 * 只认 `ApiError.payload` 里的结构化 `detail[]`；别的错误形状一律返回空数组，
 * 交给 {@link namedFailure} 走「名称 + 原句」。
 */
export function failedFields(err: unknown): string[] {
  if (!(err instanceof ApiError)) return [];
  const body = err.payload as { detail?: unknown } | undefined;
  const detail = body?.detail;
  if (!Array.isArray(detail)) return [];
  const seen = new Set<string>();
  for (const item of detail) {
    if (item === null || typeof item !== "object") continue;
    const loc = (item as { loc?: unknown }).loc;
    if (!Array.isArray(loc)) continue;
    for (let index = loc.length - 1; index >= 0; index -= 1) {
      const part = loc[index];
      if (typeof part === "string" && part !== "body") {
        seen.add(part);
        break;
      }
    }
  }
  return [...seen];
}

/** 「名称」+ 字段 + 原因；没有结构化字段时只给名称 + 原因。 */
export function namedFailure(name: string, err: unknown, fallback: string): string {
  const reason = err instanceof Error && err.message ? err.message : fallback;
  const fields = failedFields(err);
  if (fields.length === 0) return t("settingsErrors.namedFailure", { name, reason });
  return t("settingsErrors.fieldFailure", {
    name,
    fields: fields.map(fieldLabel).join(t("settingsErrors.fieldSeparator")),
    reason,
  });
}
