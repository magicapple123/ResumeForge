// SPDX-License-Identifier: Apache-2.0
/** 配置记录弹窗的表单值类型与纯函数（从 useLLMRecordTools 拆出，压 500 行预算）。
 *
 * 这里只放**不依赖 React**的记录表单逻辑：表单值形状、新增默认值、表单值合并成
 * 完整 LLMConfig。hook 本体（状态、请求、弹窗开合）仍留在 useLLMRecordTools.ts。
 */
import type { LLMConfig, LLMConfigRecord } from "../../types";
import type { LLMApiStyle } from "../../types/settings";
import { CUSTOM_PRESET, UNLIMITED_MAX_TOKENS, configFromRecord } from "./SettingsConfig";
import { clampContextWindow } from "./llm/contextWindowPresets";

/** 新增/编辑共用弹窗的表单值。api_key 留空 = 保持原密钥（原样回传脱敏引用）。
 *
 * 高级/思考字段与旧页面表单同一套：「留空 = 不发送」（null），弹窗里只是换了容器，
 * 交互与校验语义原样保留。extra_body 刻意**不在**表单里——它一直是长尾参数出口，
 * 编辑时从原记录展开原样带过（见 mergedConfigFromForm）。
 */
export interface RecordFormValues {
  /** 仅新增态可填；编辑态用记录自身的 name（同名 upsert 的键）。 */
  name: string;
  /** 前端专用：快速预设选择项，选中后由 applyRecordPreset 填充接口字段。 */
  preset: string;
  provider: string;
  api_style: LLMApiStyle;
  base_url: string;
  model: string;
  api_key: string;
  temperature: number;
  timeout_seconds: number;
  max_tokens: number;
  /**
   * 上下文窗口（tokens）。`null` = 留空，**不预填**（填错比不填更糟）。
   *
   * 留空在保存时折成 0，语义是"跟随型号参考值"（后端 `resolve_model_window`：
   * 手填 > 参考表 > 保守 128K），不是"不限制"。
   */
  context_window_tokens: number | null;
  top_p: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  seed: number | null;
  top_k: number | null;
  repetition_penalty: number | null;
  stop: string[];
  thinking_budget: number | null;
  thinking_enabled: boolean;
  thinking_effort: string;
  thinking_style: LLMConfig["thinking_style"];
}

/** 新增时的表单默认值：与后端 LLMConfig 默认一致（高级参数 null = 不发送）。 */
export function createDefaults(): RecordFormValues {
  return {
    name: "",
    preset: CUSTOM_PRESET,
    provider: "custom",
    api_style: "openai",
    base_url: "",
    model: "",
    api_key: "",
    temperature: 0.1,
    timeout_seconds: 120,
    max_tokens: UNLIMITED_MAX_TOKENS,
    // 不预填：留空 = 跟随型号参考值，用户没确认过的数字不该出现在表单里。
    context_window_tokens: null,
    top_p: null,
    frequency_penalty: null,
    presence_penalty: null,
    seed: null,
    top_k: null,
    repetition_penalty: null,
    stop: [],
    thinking_budget: null,
    thinking_enabled: false,
    thinking_effort: "",
    thinking_style: "auto",
  };
}

/** 新增时落在记录里的完整 LLMConfig：高级/思考字段全部取「不发送」默认。 */
function createDefaultConfig(): LLMConfig {
  return {
    provider: "custom",
    base_url: "",
    api_key: "",
    model: "",
    temperature: 0.1,
    timeout_seconds: 120,
    max_tokens: UNLIMITED_MAX_TOKENS,
    // 0 = 未知：新建记录在用户没填之前跟随型号参考值（后端解析），不是"不限制"。
    context_window_tokens: 0,
    api_style: "openai",
    top_p: null,
    frequency_penalty: null,
    presence_penalty: null,
    seed: null,
    top_k: null,
    repetition_penalty: null,
    stop: [],
    thinking_budget: null,
    thinking_enabled: false,
    thinking_effort: "",
    thinking_style: "auto",
    extra_body: {},
  };
}

/**
 * 表单值合并成完整 LLMConfig。编辑时从原记录展开（保证 extra_body 等弹窗里没有的字段
 * 原样保留——记录接口同样是整份替换语义），api_key 留空则沿用原记录的脱敏引用。
 */
export function mergedConfigFromForm(
  values: RecordFormValues,
  record: LLMConfigRecord | null,
): LLMConfig {
  const base = record ? configFromRecord(record) : createDefaultConfig();
  const typedKey = values.api_key.trim();
  return {
    ...base,
    provider: values.provider || base.provider,
    api_style: values.api_style,
    base_url: values.base_url.trim(),
    model: values.model.trim(),
    temperature: values.temperature,
    timeout_seconds: values.timeout_seconds,
    max_tokens: values.max_tokens,
    // 显式读：这一项**必须**跟着表单走。不读的后果是新建填了丢弃、编辑任何记录再保存
    // 把窗口清成 0（`LLMConfig` 整份替换语义）。留空（null）折成 0 = 跟随型号参考值，
    // 正数夹到 `0..2_000_000`（后端 `le` 上限，超了会被 422 拒）。
    context_window_tokens: clampContextWindow(values.context_window_tokens),
    api_key: record && typedKey === "" ? record.api_key : typedKey,
    // 高级/思考字段按「表单里有没有真的返回」逐个覆盖：折叠态下高级区的 Form.Item
    // 不挂载，validateFields 不会返回这些键——不能拿「不发送」默认值覆盖原记录。
    ...pickRegistered(values),
  };
}

/** 高级/思考字段的表单归一化（InputNumber 留空 = undefined → 不发送）。 */
function normalizedAdvanced(values: RecordFormValues): Record<string, unknown> {
  return {
    top_p: values.top_p ?? null,
    frequency_penalty: values.frequency_penalty ?? null,
    presence_penalty: values.presence_penalty ?? null,
    seed: values.seed ?? null,
    top_k: values.top_k ?? null,
    repetition_penalty: values.repetition_penalty ?? null,
    stop: values.stop ?? [],
    thinking_budget: values.thinking_budget ?? null,
    thinking_enabled: values.thinking_enabled ?? false,
    thinking_effort: values.thinking_effort ?? "",
    thinking_style: values.thinking_style || "auto",
  };
}

/** validateFields 只返回已注册（已挂载）的字段；只挑返回了的键参与覆盖。 */
function pickRegistered(values: RecordFormValues): Record<string, unknown> {
  const normalized = normalizedAdvanced(values);
  return Object.fromEntries(
    Object.entries(normalized).filter(([key]) => key in (values as object)),
  );
}
