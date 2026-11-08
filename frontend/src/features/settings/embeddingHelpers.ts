// SPDX-License-Identifier: Apache-2.0
/**
 * 「语义检索」卡的纯函数：host 归一、配置回填、错误原因 → 引导 key。
 *
 * 分开成独立模块是为了能在不挂载组件的情况下测——这里没有 React、没有请求，
 * 只有「后端只给原因，前端给怎么办」这条分工的映射表。
 */
import type { MessageKey } from "../../i18n";
import type {
  EmbeddingEndpointMode,
  EmbeddingMaskedConfig,
  EmbeddingRemoteConfig,
  EmbeddingRemoteStatus,
} from "../../api/settings";

/** 地址 → host（用于隐私确认与"换 host 重新确认"）。非法地址返回空串。 */
export function embeddingHostOf(address: string): string {
  try {
    return new URL(address.trim()).host;
  } catch {
    return "";
  }
}

/**
 * 真正会把文本发出去的那个地址：模板模式是 request_url，其余是 base_url。
 *
 * 必须与后端 EmbeddingProviderConfig.host() 同口径（settings_embedding.py 的
 * _validate_remote 与 remote/enable 都用 host() 做确认校验），否则模板模式会确认错 host。
 */
export function embeddingEndpointAddress(config: EmbeddingRemoteConfig): string {
  return config.endpoint_mode === "template" ? config.request_url : config.base_url;
}

/** 隐私确认/撤销所用的 host：模板模式取 request_url 的主机。 */
export function embeddingEndpointHost(config: EmbeddingRemoteConfig): string {
  return embeddingHostOf(embeddingEndpointAddress(config));
}

/** 表单默认值：自定义服务，OpenAI 兼容路径，批量 25（任务书 §4.1 的厂商实测值）。 */
export function emptyRemoteConfig(): EmbeddingRemoteConfig {
  return {
    provider: "openai-http",
    base_url: "",
    model: "",
    api_key: "",
    batch_size: 25,
    endpoint_mode: "openai",
    request_url: "",
    headers: [],
    body_template: "",
    response_path: "data[*].embedding",
    allow_private: false,
  };
}

/**
 * 从 GET /status 回填表单。
 *
 * 真实路由在 /status 顶层给了掩码后的完整 config（见 mask_embedding_config）；有就用它，
 * 没有（只有契约字段）时退回 host/model/batch 三个可见字段。api_key 恒置空：空串在后端
 * 等于「沿用已存密钥」，界面不回显真实密钥。
 *
 * endpoint_mode 只认后端给的两个值：模板模式之外一律按 openai（避免把未知字符串塞给
 * 后端 RemoteConfigIn 的 endpoint_mode 字段）。
 */
export function remoteConfigFromStatus(
  remote: EmbeddingRemoteStatus,
  savedConfig?: EmbeddingMaskedConfig | null,
): EmbeddingRemoteConfig {
  const saved = savedConfig && savedConfig.provider === "openai-http" ? savedConfig : null;
  const endpointMode: EmbeddingEndpointMode =
    saved?.endpoint_mode === "template" ? "template" : "openai";
  return {
    provider: "openai-http",
    base_url: saved?.base_url ?? "",
    model: saved?.model || remote.model || "",
    api_key: "",
    batch_size: saved?.batch_size ?? remote.batch_size ?? 25,
    endpoint_mode: endpointMode,
    request_url: saved?.request_url ?? "",
    headers: (saved?.headers ?? []).map((row) => ({ name: row.name, value: row.value })),
    body_template: saved?.body_template ?? "",
    response_path: saved?.response_path || "data[*].embedding",
    allow_private: saved?.allow_private ?? false,
  };
}

/**
 * 远端失败原因 → 一句「怎么办」。
 *
 * 后端 detail 只写原因且不含 key/URL；前端据此归类，不去猜具体厂商。匹配串里出现
 * 中文是为了接住后端可能返回的中文原因（属于 AGENTS.md 允许 i18n-ok 的
 * 「includes 中文匹配后端文案」一类，不是界面文案）。
 */
export function embeddingGuidanceKey(reason: string): MessageKey {
  const text = (reason || "").toLowerCase();
  // i18n-ok: 匹配后端可能返回的中文原因，不是界面文案
  if (/401|403|unauthor|invalid.*key|api key|密钥|鉴权/.test(text)) {
    return "embeddingSearch.guidance.key";
  }
  // i18n-ok: 匹配后端可能返回的中文原因，不是界面文案
  if (/404|not found|no.*embedding|embeddings 接口|嵌入接口/.test(text)) {
    return "embeddingSearch.guidance.endpoint";
  }
  // i18n-ok: 匹配后端可能返回的中文原因，不是界面文案
  if (/dimension|维度|dim\b/.test(text)) {
    return "embeddingSearch.guidance.dimension";
  }
  // i18n-ok: 匹配后端可能返回的中文原因，不是界面文案
  if (/429|rate.?limit|quota|限流|额度/.test(text)) {
    return "embeddingSearch.guidance.quota";
  }
  // i18n-ok: 匹配后端可能返回的中文原因，不是界面文案
  if (/private|loopback|内网|本机地址/.test(text)) {
    return "embeddingSearch.guidance.private";
  }
  // i18n-ok: 匹配后端可能返回的中文原因，不是界面文案
  if (/timeout|network|connect|dns|refused|unreachable|超时|网络/.test(text)) {
    return "embeddingSearch.guidance.network";
  }
  // i18n-ok: 匹配后端可能返回的中文原因，不是界面文案
  if (/sha256|checksum|校验失败/.test(text)) {
    return "embeddingSearch.guidance.sha";
  }
  // i18n-ok: 匹配后端可能返回的中文原因，不是界面文案
  if (/disk|no space|磁盘/.test(text)) {
    return "embeddingSearch.guidance.disk";
  }
  // i18n-ok: 匹配后端可能返回的中文原因，不是界面文案
  if (/runtime|onnxruntime|运行时/.test(text)) {
    return "embeddingSearch.guidance.runtime";
  }
  // i18n-ok: 匹配后端可能返回的中文原因，不是界面文案
  if (/download|下载/.test(text)) {
    return "embeddingSearch.guidance.download";
  }
  return "embeddingSearch.guidance.retry";
}
