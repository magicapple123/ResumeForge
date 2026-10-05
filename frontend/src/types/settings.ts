/** 大模型设置、数据集与更新检查类型。 */

/** 接口协议：Claude 也能走 OpenAI 兼容层（openai），或原生 Messages 协议（anthropic）。 */
export type LLMApiStyle = "openai" | "anthropic";

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
}

export interface LLMConfigRecord extends LLMConfig {
  id: number;
  name: string;
  created_at: string;
  updated_at: string;
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

/** 联网搜索的来源。 */
export type SearchSource = "bing" | "duckduckgo" | "searxng";

/**
 * 联网搜索设置。
 *
 * 每个字段都要与后端 `SearchConfig` 对齐：这个接口也是**整份替换**语义，少声明一个
 * 字段就会在保存时被默认值填回去（与 `LLMConfig` 同一类坑）。
 */
export interface SearchConfig {
  /** 至少一个来源；后端要求 1~3 项且自动去重。 */
  sources: SearchSource[];
  /** 自建 SearXNG 实例根地址（`http://` 或 `https://` 开头）；不用可留空。 */
  searxng_url: string;
  /** 抓取前 N 条结果的正文，0 = 只取摘要。取值范围 0~3。 */
  fetch_pages: number;
  /** 每次搜索最多返回多少条，1~15。 */
  max_results: number;
}

/** 一份数据集：一整个数据库，可切换。 */
export interface DatasetInfo {
  id: string;
  name: string;
  source: string;
  size_bytes: number;
  created_at: string | null;
  is_active: boolean;
  exists: boolean;
}

/**
 * 导入备份包的结果。
 *
 * `restored_datasets` 只在两种情况出现：导入的是「导出全部数据集」产生的包（包里随行
 * 带了几份数据集），或那份数据集的路径校验没通过（整包拒收，不会有这个字段）。
 */
export interface DatasetImportResult extends DatasetInfo {
  restored_datasets?: DatasetInfo[];
  /** 导出方勾选过「包含 API Key」时为 true：密钥已随包恢复（解不开时仍需重填）。 */
  api_key_included?: boolean;
}

/** 应用打开时是否弹出近期提醒（默认开）。 */
export interface ReminderPopupSetting {
  enabled: boolean;
}

/**
 * 「投投」悬浮球的设置（入口与提示标语，默认均开）。
 *
 * **每个后端字段都必须在这里出现**：这个接口是整份替换语义，少声明一个字段就会在
 * 保存时被默认值填回去（与 `LLMConfig` 同一类坑）。
 */
export interface AssistantOrbSetting {
  enabled: boolean;
  /** 悬浮球是否弹出轮换提示标语；默认开，兼容老数据。 */
  tips_enabled: boolean;
}

export interface NavigationVisibility {
  hidden: string[];
}

/** 更新检查结果与可安装包信息。 */
export interface UpdateCheckResult {
  current_version: string;
  latest_version: string;
  update_available: boolean;
  release_name: string;
  release_url: string;
  published_at: string;
  notes: string;
  message: string;
  checked_at: string | null;
  download_url: string;
  download_size: number | null;
  asset_name: string;
  /** 发布时旁边的 `.sha256` 附件地址；下载完用它核对。 */
  checksum_url: string;
  installable: boolean;
}

export type UpdateInstallState = "success" | "failed" | "interrupted" | "installing";

/**
 * 上一次应用内更新的结果，由后端读更新器写的状态文件得出。
 *
 * **成没成以后端为准**：前端不再自己记"我点过安装了"——那种记法在安装失败时
 * 会对着用户说"已更新"。
 */
export interface UpdateInstallResult {
  state: UpdateInstallState;
  from_version: string;
  target_version: string;
  message: string;
  log: string;
  restart: boolean;
}

export type UpdateDownloadState = "idle" | "downloading" | "ready" | "installing" | "failed";

export interface UpdateStatus {
  state: UpdateDownloadState;
  current_version: string;
  target_version: string;
  progress: number;
  downloaded_bytes: number;
  total_bytes: number | null;
  background: boolean;
  installable: boolean;
  message: string;
}
