// SPDX-License-Identifier: Apache-2.0

/**
 * 接口协议：Claude 也能走 OpenAI 兼容层（openai），或原生 Messages 协议（anthropic）；
 * responses = OpenAI Responses（实验性，只有用户主动选择才走，默认仍是 openai）。
 */
export type LLMApiStyle = "openai" | "anthropic" | "responses";

/** 额外请求体字段允许的值：任意 JSON 值（对象与数组都算 object）。 */
export type LLMExtraBodyValue = string | number | boolean | object;

/**
 * 大模型配置。
 *
 * **每个后端字段都必须在这里出现**：设置接口是整份替换语义，前端没声明的字段会在
 * 保存时被 Pydantic 的默认值填回去——此前 `api_style` 等六个字段没声明，用户在设置页
 * 点一次保存就会把原生 Anthropic 配置打回 `openai`，且没有任何提示。
 */
export interface LLMConfig {
  provider: string;
  base_url: string;
  api_key: string;
  model: string;
  temperature: number;
  timeout_seconds: number;
  max_tokens: number;
  /**
   * 上下文窗口（tokens）；0 = 未知/未设置。
   *
   * 助手「上下文用量」的百分比分母（需求 #6）。不做联网探测（`/models` 不返回窗口
   * 长度），所以它是用户手填值；可选是因为更早的后端响应里没有这个字段。
   */
  context_window_tokens?: number;
  api_style: LLMApiStyle;
  /** 高级调整（可选）：null 表示不发送该参数，沿用服务商默认值。 */
  top_p: number | null;
  frequency_penalty: number | null;
  presence_penalty: number | null;
  seed: number | null;
  top_k: number | null;
  repetition_penalty: number | null;
  /** 停止词：命中即让模型停下，最多 4 条。 */
  stop: string[];
  /** Anthropic 扩展思考预算（tokens）；0 = 明确关闭，null = 不发送。 */
  thinking_budget: number | null;
  /**
   * 思考模式开关。**只作用于除「求职助手」以外的 AI 调用**——助手在它的输入框下方
   * 有自己的「思考强度」，两者刻意分开。
   *
   * 默认关闭 = 请求体里不加任何思考参数（各家对不认识参数的处理不同：有的忽略，
   * 有的直接 400）。
   */
  thinking_enabled: boolean;
  /** 思考强度档位；各家划分不同，取值由「检测思考支持」接口给出，空串 = 不指定档位。 */
  thinking_effort: string;
  /** 思考参数的形态：auto = 按协议与服务商推断；其余取值用于中转站/自建网关。 */
  thinking_style: string;
  /**
   * 长尾参数的出口：直接并进请求体。没有界面控件，但必须原样往返，否则会被清空。
   *
   * 值类型写 `LLMExtraBodyValue` 而不是 `unknown`：antd 的 Form 要求表单值的每一项都能
   * 赋给 `{}`，`unknown` 不满足，会让整个表单类型报错。
   */
  extra_body: Record<string, LLMExtraBodyValue>;
  /**
   * 生效来源（C）：`global` = 全局记录（所有数据集共用）；`dataset` = 还在用数据集
   * 里的旧配置（升级后尚未迁移的回退态，保存一次即升级为 global）。
   */
  scope?: "global" | "dataset";
  /** 生效记录 id（scope=global 时有值）；「使用中」据此高亮，不再逐字段比对。 */
  record_id?: string | null;
  /** 生效记录名称，用于卡片上的"使用中：xxx"。 */
  record_name?: string;
}

export interface LLMConfigRecord extends LLMConfig {
  /** 全局记录 id（后端是 `p_` 前缀的字符串）。 */
  id: string;
  name: string;
  /**
   * 名字仍是内置默认名（用户没改过）。为 true 时界面按语言包显示，
   * 否则原样显示 `name`——那是用户自己输入的数据。
   */
  name_is_default?: boolean;
  /** 该记录保存过的模型清单（供下拉选择）。 */
  models: string[];
  /** 是否为「使用中」的记录。 */
  is_active: boolean;
  created_at: string;
  updated_at: string;
  /**
   * 这条记录**解析后**的上下文窗口（后端 `resolve_model_window`：手填 > 参考表 > 保守值）。
   *
   * 由后端算好随记录下发：型号匹配规则只有后端一份，前端不复制正则去猜；卡片上
   * 「窗口 1M（参考表）」里的「参考表」就是 `window_source`。
   */
  window_tokens?: number;
  /** manual = 用户手填；reference = 命中参考表；fallback = 未知型号的保守值。 */
  window_source?: "manual" | "reference" | "fallback";
}

export interface LLMTestResult {
  ok: boolean;
  latency_ms: number | null;
  message: string;
}

export interface LLMApiKeyRevealResult {
  api_key: string;
}

/** 「获取可用模型」结果。失败时 message 说明原因，models 为空。 */
export interface LLMModelsResult {
  models: string[];
  message: string;
}

/**
 * 「检测思考支持」结果。
 *
 * `note` 是内置能力表给的解释（读表就有）；`message` 是实测结论（`probed` 为真才有）。
 * 上游没有"查询思考能力"的接口，所以"支不支持"只能靠表推断 + 实发一次请求实测。
 */
export interface LLMThinkingResult {
  style: string;
  efforts: string[];
  supported: boolean;
  note: string;
  probed: boolean;
  accepted: boolean | null;
  reasoning_seen: boolean;
  message: string;
}

/** 联网搜索的来源。协议值，提交给后端，不翻译。 */
export type SearchSource = "bing" | "duckduckgo" | "searxng" | "deepseek" | "tavily" | "jina";

/** 搜索深度三档（P4-08）：摘要 0 页 / 标准 2 页×2 段 / 深入 5 页×3 段。 */
export type SearchDepth = "snippet" | "standard" | "deep";

/**
 * 联网搜索设置。
 *
 * 每个字段都要与后端 `SearchConfig` 对齐：这个接口也是**整份替换**语义，少声明一个
 * 字段就会在保存时被默认值填回去（与 `LLMConfig` 同一类坑）。
 */
export interface SearchConfig {
  /** 至少一个来源；后端要求 1~6 项且自动去重。 */
  sources: SearchSource[];
  /** 自建 SearXNG 实例根地址（`http://` 或 `https://` 开头）；不用可留空。 */
  searxng_url: string;
  /**
   * 搜索深度（**唯一真值**）：snippet 只看摘要、standard 抓 2 页各 2 段、deep 抓 5 页各 3 段。
   */
  depth: SearchDepth;
  /**
   * **已弃用**，只为兼容旧后端：写入端只认 depth。读到时按档位折算（0/2/3）。
   */
  fetch_pages?: number;
  /** 每次搜索最多返回多少条，1~15。 */
  max_results: number;
  /**
   * DeepSeek Search / Fetch 的密钥。
   *
   * 服务端**只回显掩码**（`********`）或空串，真实密钥加密后单独存储。整份配置会原样
   * PUT 回去，所以读到掩码时保持原值提交即可（后端识别掩码 = 不修改）；清空 = 移除密钥。
   */
  deepseek_api_key: string;
  /** Tavily 的密钥（同上：只回显掩码或空串）。 */
  tavily_api_key: string;
  /** Jina 的密钥（同上）。 */
  jina_api_key: string;
}
