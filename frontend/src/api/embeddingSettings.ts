// SPDX-License-Identifier: Apache-2.0
/**
 * 设置页「语义检索」卡的请求层（RAG v3，契约 §3）。
 *
 * ## 为什么单独成模块
 *
 * `api/settings.ts` 已经 360+ 行，本组接口再加进去会顶到 500 行零豁免预算；按
 * `fonts.ts` 的既有做法拆出来，`settings.ts` 只做转发，调用点仍可
 * `import { ... } from "../api/settings"`。
 *
 * ## 形状由后端定，前端不推断
 *
 * - 状态机唯一真相源：GET /api/settings/embedding/status；
 * - 远端配置请求体（RemoteConfigIn）**显式带 provider 与 endpoint_mode**，不要靠
 *   "模板字段非空"推断走哪条路；
 * - `headers` 必须是 `[{name, value}]` 对象数组（后端读 item["name"]/item["value"]，
 *   单键对象或 map 会被静默丢弃）；值里允许 `{api_key}` 占位，渲染后的 header 不得进日志；
 * - `api_key` 传空串或 "********" = 沿用已存密钥（不把旧密钥回显到前端）。
 */
import { request } from "./client";

/** 合并状态（GET /status 的 state）：失败态不得显示为已启用。 */
export type EmbeddingState =
  | "not_configured"
  | "not_downloaded"
  | "downloading"
  | "ready"
  | "failed"
  | "unsupported"
  | "disabled";

/** provider 是协议值（local-onnx | openai-http | fake），界面只用于判定展示。 */
export type EmbeddingProviderId = "local-onnx" | "openai-http" | "fake" | "";
export type EmbeddingLocalState =
  "not_downloaded" | "downloading" | "verifying" | "extracting" | "ready" | "failed";
export type EmbeddingEndpointMode = "openai" | "template";

export interface EmbeddingLocalStatus {
  supported: boolean;
  platform: string;
  variant: string;
  /** 下载体积（字节）；界面显示为「约 161 MB」。 */
  download_bytes: number;
  state: EmbeddingLocalState;
  /** 进度。后端可能给 0..1 也可能给 0..100，由调用方归一。 */
  progress: number;
  error: string;
  model: string;
  runtime_version: string;
}

/** 一行自定义请求头；值里允许 api_key 占位。 */
export interface EmbeddingHeaderRow {
  name: string;
  value: string;
}

/** 远端配置草稿：测试连接 / 拉取模型 / 启用共用这一份（对应后端 RemoteConfigIn）。 */
export interface EmbeddingRemoteConfig {
  /** 固定 openai-http：本卡只暴露 OpenAI 兼容与模板两条路。 */
  provider: "openai-http";
  base_url: string;
  model: string;
  /** 空串 = 沿用已存密钥；不回显真实密钥。 */
  api_key: string;
  batch_size: number;
  endpoint_mode: EmbeddingEndpointMode;
  request_url: string;
  headers: EmbeddingHeaderRow[];
  body_template: string;
  response_path: string;
  allow_private: boolean;
}

export interface EmbeddingRemoteStatus {
  configured: boolean;
  enabled: boolean;
  host: string;
  model: string;
  dim: number;
  endpoint_mode: EmbeddingEndpointMode;
  batch_size: number;
  confirmed_hosts: string[];
  pending_host: string;
  error: string;
}

/**
 * GET /status 顶层多给的一份**掩码后**完整配置（真实路由见
 * backend/app/api/settings_embedding.py: mask_embedding_config）。只用于回填表单；
 * api_key 恒为 "********" 或空串，界面不展示它。
 */
export interface EmbeddingMaskedConfig {
  provider?: string;
  enabled?: boolean;
  model?: string;
  dim?: number;
  pooling?: string;
  variant?: string;
  base_url?: string;
  api_key?: string;
  batch_size?: number;
  endpoint_mode?: EmbeddingEndpointMode;
  request_url?: string;
  headers?: EmbeddingHeaderRow[];
  body_template?: string;
  response_path?: string;
  allow_private?: boolean;
  confirmed_hosts?: string[];
  host?: string;
  last_error?: string;
  updated_at?: string;
}

export interface EmbeddingStatus {
  state: EmbeddingState;
  provider: EmbeddingProviderId;
  last_error: string;
  local: EmbeddingLocalStatus;
  remote: EmbeddingRemoteStatus;
  runtime: { available: boolean; version: string };
  /** 掩码后的完整配置（真实路由提供）：只用于回填表单，见 EmbeddingMaskedConfig。 */
  config?: EmbeddingMaskedConfig | null;
}

/** 「测试连接」的探测结果；失败不是 HTTP 错误（后端 200 + ok:false）。 */
export interface EmbeddingProbeResult {
  ok: boolean;
  /** 成功时自动探测到的维度；界面只展示，不给用户填。 */
  dim: number;
  elapsed_ms: number;
  model: string;
  error: string;
}

export interface EmbeddingModelsResult {
  models: string[];
}

/** 下载体积的百分数：后端可能给 0..1 也可能给 0..100，统一成 0..100。 */
export function embeddingProgressPercent(progress: number): number {
  if (!Number.isFinite(progress) || progress <= 0) return 0;
  const percent = progress <= 1 ? progress * 100 : progress;
  return Math.min(100, Math.round(percent));
}

export function getEmbeddingStatus(signal?: AbortSignal): Promise<EmbeddingStatus> {
  return request("/settings/embedding/status", { signal });
}

/** 开始本地下载（202）：只下载 + 解包 + 校验，进度靠轮询 GET /status。 */
export function startEmbeddingLocalDownload(): Promise<unknown> {
  return request("/settings/embedding/local/download", { method: "POST" });
}

export function cancelEmbeddingLocalDownload(): Promise<unknown> {
  return request("/settings/embedding/local/download/cancel", { method: "POST" });
}

/** 删除 DATA_DIR 下的权重与运行时目录（不含配置）；之后回到未下载。 */
export function removeEmbeddingLocalAssets(): Promise<unknown> {
  return request("/settings/embedding/local/remove", { method: "POST" });
}

/** 校验文件 + 导入运行时 + 自检编码，通过后才写 enabled 配置。 */
export function enableEmbeddingLocal(): Promise<unknown> {
  return request("/settings/embedding/local/enable", { method: "POST", budget: "task" });
}

/**
 * 记录「已确认把资料文本发到该 host」；按 host 记，换 host 要重新确认。
 *
 * 后端 RemoteConfigIn.ConfirmIn 的字段名虽叫 base_url，但只从中取 host；模板模式下调用方
 * 要传 request_url（真正出网的完整地址），否则会确认到错的 host。
 */
export function confirmEmbeddingHost(address: string): Promise<unknown> {
  return request("/settings/embedding/remote/confirm", {
    method: "POST",
    body: JSON.stringify({ base_url: address }),
  });
}

export function revokeEmbeddingHost(host: string): Promise<unknown> {
  return request("/settings/embedding/remote/confirm/revoke", {
    method: "POST",
    body: JSON.stringify({ host }),
  });
}

/** 发一条短文本探测：返回维度与耗时；失败也是 200 + ok:false。 */
export function testEmbeddingRemote(config: EmbeddingRemoteConfig): Promise<EmbeddingProbeResult> {
  return request("/settings/embedding/remote/test", {
    method: "POST",
    body: JSON.stringify(config),
    budget: "task",
  });
}

export function fetchEmbeddingModels(
  config: EmbeddingRemoteConfig,
): Promise<EmbeddingModelsResult> {
  return request("/settings/embedding/remote/models", {
    method: "POST",
    body: JSON.stringify(config),
    budget: "task",
  });
}

/** 写 enabled=True + 探测到的 dim；host 未确认/探测失败时返回 4xx + detail。 */
export function enableEmbeddingRemote(config: EmbeddingRemoteConfig): Promise<unknown> {
  return request("/settings/embedding/remote/enable", {
    method: "POST",
    body: JSON.stringify(config),
    budget: "task",
  });
}

/** 关闭（保留配置）：之后回关键词链，候选与从未启用逐字节相同。 */
export function disableEmbedding(): Promise<unknown> {
  return request("/settings/embedding/disable", { method: "POST" });
}

/** 清除密钥与配置（含索引）；之后回到未启用。 */
export function clearEmbedding(): Promise<unknown> {
  return request("/settings/embedding/clear", { method: "POST" });
}
