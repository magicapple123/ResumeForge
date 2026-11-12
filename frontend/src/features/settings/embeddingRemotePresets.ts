// SPDX-License-Identifier: Apache-2.0
/**
 * 远端服务预设（任务书 §4.6）：**只提供默认值，不新增代码路径**。
 *
 * 每个预设只描述：base_url、候选模型、是否是本机回环（需要 allow_private），以及卡片上
 * 要显示的一句说明。预设不是"免校验"：点启用仍会走一次真实探测（HTTP 200 + 维度自检），
 * 探测通过才显示已就绪；候选模型拉取失败可以手填。
 *
 * ## host 为什么是算出来的，不是写死的
 *
 * 厂商卡片要显示 host（条目 03）。把它写成数据字段会与 `baseUrl` 形成第二份真相——
 * 改地址忘了改 host 时，卡片上显示的地址与实际请求的地址会不一致，而这种错没人会怀疑。
 * 所以 host 统一由 `presetHostOf` 从 `baseUrl` 解析（非法地址返回空串，卡片少显示一行）。
 *
 * 模型名与 host 都是厂商公开的**技术标识**，不进语言包；只有显示名与说明走 i18n。
 */
import type { MessageKey } from "../../i18n";

export interface EmbeddingRemotePreset {
  id: string;
  labelKey: MessageKey;
  baseUrl: string;
  models: readonly string[];
  /** 本机回环服务（Ollama / LM Studio）：选中即打开「允许本机地址」。 */
  allowPrivate: boolean;
  /** 卡片上的一句说明（≤16 字）。缺省时卡片只显示 host。 */
  noteKey?: MessageKey;
}

/** 预设之外的一条路：完全自定义，字段全手填。 */
export const CUSTOM_PRESET_ID = "custom";

/** 自定义卡片的说明文案（它没有 baseUrl，所以不进预设数组）。 */
export const CUSTOM_PRESET_NOTE_KEY: MessageKey = "embeddingSearch.remote.preset.note.custom";

export const EMBEDDING_REMOTE_PRESETS: readonly EmbeddingRemotePreset[] = [
  {
    // 2026-11-08 实测唯一验证过的端点（任务书 §4.1）：维度 1024、批量上限 25。
    id: "dashscope",
    labelKey: "embeddingSearch.remote.preset.dashscope",
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    models: ["qwen3.7-text-embedding-flash"],
    allowPrivate: false,
    noteKey: "embeddingSearch.remote.preset.note.dashscope",
  },
  {
    id: "openai",
    labelKey: "embeddingSearch.remote.preset.openai",
    baseUrl: "https://api.openai.com/v1",
    models: ["text-embedding-3-small", "text-embedding-3-large"],
    allowPrivate: false,
    noteKey: "embeddingSearch.remote.preset.note.openai",
  },
  {
    id: "zhipu",
    labelKey: "embeddingSearch.remote.preset.zhipu",
    baseUrl: "https://open.bigmodel.cn/api/paas/v4",
    models: ["embedding-3", "embedding-2"],
    allowPrivate: false,
    noteKey: "embeddingSearch.remote.preset.note.zhipu",
  },
  {
    id: "siliconflow",
    labelKey: "embeddingSearch.remote.preset.siliconflow",
    baseUrl: "https://api.siliconflow.cn/v1",
    models: ["BAAI/bge-m3", "Qwen/Qwen3-Embedding-0.6B"],
    allowPrivate: false,
    noteKey: "embeddingSearch.remote.preset.note.siliconflow",
  },
  {
    id: "ollama",
    labelKey: "embeddingSearch.remote.preset.ollama",
    baseUrl: "http://localhost:11434/v1",
    models: ["nomic-embed-text", "bge-m3"],
    allowPrivate: true,
    noteKey: "embeddingSearch.remote.preset.note.ollama",
  },
];

/** base_url 命中某预设（忽略末尾斜杠）时返回该预设，否则 null（= 自定义）。 */
export function presetOf(baseUrl: string): EmbeddingRemotePreset | null {
  const normalized = baseUrl.trim().replace(/\/+$/, "");
  return EMBEDDING_REMOTE_PRESETS.find((preset) => preset.baseUrl === normalized) ?? null;
}

/**
 * 从 Base URL 取 host（卡片上显示用）。解析失败返回空串——卡片据此少渲染一行，
 * 而不是显示 "undefined" 或抛错。
 */
export function presetHostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).host;
  } catch {
    return "";
  }
}
