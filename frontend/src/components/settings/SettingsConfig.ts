/** 设置页的预设、脱敏和表单值转换逻辑。 */

import { LLM_PRESETS } from "../../config";
import type { LLMConfig, LLMConfigRecord } from "../../types";

export const CUSTOM_PRESET = "custom";
export const CUSTOM_PRESET_LABEL = "自定义模型（OpenAI 兼容）";
/**
 * 不套用任何预设：选中后清空 Base URL 与模型名，由用户从空白开始填。
 *
 * 与 ``CUSTOM_PRESET`` 的区别只在"选中时做什么"：自定义模型保留当前内容（避免误点丢失
 * 已填的接口信息），纯手动配置则主动清空，用来从中转/网关等非标准地址重新填一套。
 * 两者都只影响表单，保存与否仍由用户决定。
 */
export const MANUAL_PRESET = "manual";
export const MANUAL_PRESET_LABEL = "纯手动配置（不套用任何预设）";
export const API_KEY_MASK = "********";

/** max_tokens 取该值表示“不限制”：请求体里不发送该字段，由服务商决定上限。 */
export const UNLIMITED_MAX_TOKENS = 0;
/**
 * 取消“不限制”时回填的**有限**值。
 *
 * 后端 LLMConfig 的默认值已是「不限制」(0)，但这里不能跟着改成 0——0 正是“不限制”的
 * 哨兵值，取消勾选时回填 0 会让复选框永远停在“不限制”，等于没法退出。回填值必须是一个
 * 可用的有限上限，4096 是沿用已久的合理起点。
 */
export const DEFAULT_MAX_TOKENS = 4096;
export const MIN_MAX_TOKENS = 256;
export const MAX_MAX_TOKENS = 65536;

export const PRESET_OPTIONS = [
  ...LLM_PRESETS.map((preset) => ({ value: preset.provider, label: preset.label })),
  { value: CUSTOM_PRESET, label: CUSTOM_PRESET_LABEL },
  { value: MANUAL_PRESET, label: MANUAL_PRESET_LABEL },
];

/** session_only 是前端专用开关（密钥走会话通道、不落库），不属于 LLMConfig。 */

export function normalizePresetBaseUrl(value: string): string {
  const trimmed = value.trim().replace(/\/+$/, "");
  try {
    const url = new URL(trimmed);
    if (url.username || url.password || url.search || url.hash) return trimmed;
    const defaultPort =
      (url.protocol === "https:" && url.port === "443") ||
      (url.protocol === "http:" && url.port === "80");
    const port = url.port && !defaultPort ? `:${url.port}` : "";
    const path = url.pathname.replace(/\/+$/, "");
    return `${url.protocol.toLowerCase()}//${url.hostname.toLowerCase()}${port}${path}`;
  } catch {
    return trimmed;
  }
}

export function matchingPreset(config: Pick<LLMConfig, "provider" | "base_url">) {
  const normalizedUrl = normalizePresetBaseUrl(config.base_url);
  const exact = LLM_PRESETS.find(
    (preset) =>
      preset.provider === config.provider &&
      normalizePresetBaseUrl(preset.base_url) === normalizedUrl,
  );
  if (exact || config.provider !== CUSTOM_PRESET) return exact;
  // 早期自定义配置没有保存正确的展示标识；官方地址足以无歧义地恢复预设名称。
  return LLM_PRESETS.find((preset) => normalizePresetBaseUrl(preset.base_url) === normalizedUrl);
}

export function configFromRecord(record: LLMConfigRecord): LLMConfig {
  return {
    provider: record.provider,
    base_url: record.base_url,
    api_key: record.api_key,
    model: record.model,
    temperature: record.temperature,
    timeout_seconds: record.timeout_seconds,
    max_tokens: record.max_tokens,
    api_style: record.api_style ?? "openai",
    top_p: record.top_p ?? null,
    frequency_penalty: record.frequency_penalty ?? null,
    presence_penalty: record.presence_penalty ?? null,
    seed: record.seed ?? null,
    top_k: record.top_k ?? null,
    repetition_penalty: record.repetition_penalty ?? null,
    stop: record.stop ?? [],
    thinking_budget: record.thinking_budget ?? null,
    thinking_enabled: record.thinking_enabled ?? false,
    thinking_effort: record.thinking_effort ?? "",
    thinking_style: record.thinking_style ?? "auto",
    extra_body: record.extra_body ?? {},
  };
}

/** 当前配置卡片折叠态的摘要（脱敏：只带"是否配置了密钥"，不带密钥本体）。 */
export interface LLMConfigSummary {
  presetLabel: string;
  baseUrl: string;
  model: string;
  hasKey: boolean;
  /** 生效来源（C）：dataset = 还在用数据集旧配置，保存一次即升级为全局。 */
  scope: "global" | "dataset";
}

export function summaryFromConfig(config: LLMConfig): LLMConfigSummary {
  return {
    presetLabel: matchingPreset(config)?.label ?? CUSTOM_PRESET_LABEL,
    baseUrl: config.base_url,
    model: config.model,
    hasKey: config.api_key.trim() !== "",
    scope: config.scope ?? "dataset",
  };
}

export function sameConfig(left: LLMConfig, right: LLMConfig): boolean {
  return (
    left.provider === right.provider &&
    left.base_url === right.base_url &&
    left.api_key === right.api_key &&
    left.model === right.model &&
    left.temperature === right.temperature &&
    left.timeout_seconds === right.timeout_seconds &&
    left.max_tokens === right.max_tokens &&
    (left.top_p ?? null) === (right.top_p ?? null) &&
    (left.frequency_penalty ?? null) === (right.frequency_penalty ?? null) &&
    (left.presence_penalty ?? null) === (right.presence_penalty ?? null) &&
    (left.seed ?? null) === (right.seed ?? null) &&
    (left.api_style ?? "openai") === (right.api_style ?? "openai") &&
    (left.top_k ?? null) === (right.top_k ?? null) &&
    (left.repetition_penalty ?? null) === (right.repetition_penalty ?? null) &&
    (left.thinking_budget ?? null) === (right.thinking_budget ?? null) &&
    (left.thinking_enabled ?? false) === (right.thinking_enabled ?? false) &&
    (left.thinking_effort ?? "") === (right.thinking_effort ?? "") &&
    (left.thinking_style ?? "auto") === (right.thinking_style ?? "auto") &&
    (left.stop ?? []).join("\u0000") === (right.stop ?? []).join("\u0000") &&
    JSON.stringify(left.extra_body ?? {}) === JSON.stringify(right.extra_body ?? {})
  );
}
