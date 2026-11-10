// SPDX-License-Identifier: Apache-2.0
/** 语音转写（ASR）配置与状态接口。端点挂在后端 api/transcribe.py（前缀 /api）。 */

import { request } from "../../api/client";

/**
 * 调用协议。两套请求体互不兼容（见 `asrPresets.ts` 与后端 `services/asr_client.py`）：
 * `openai` = whisper 式 multipart；`dashscope` = Qwen-ASR 的 chat + input_audio。
 */
export type AsrProtocol = "openai" | "dashscope";

/** 语音服务配置；api_key 只可能是掩码（********）或空串，绝不是原文。 */
export interface AsrSettings {
  base_url: string;
  api_key: string;
  model: string;
  /** 后端为旧数据补默认值 `openai`，所以这里按必填读。 */
  protocol: AsrProtocol;
  configured: boolean;
}

/** 保存时提交的表单值：api_key 传掩码/空串表示沿用旧 Key，传 __clear__ 表示清空。 */
export interface AsrSettingsPayload {
  base_url: string;
  api_key: string;
  model: string;
  protocol: AsrProtocol;
}

/** 拉取模型列表的请求体：不需要模型名，只要有地址、Key 与协议。 */
export interface AsrModelsPayload {
  base_url: string;
  api_key: string;
  protocol: AsrProtocol;
}

/** 拉取结果：后端不做关键词过滤，失败时 `models` 为空数组（界面退回手填）。 */
export interface AsrModelsResult {
  models: string[];
}

export interface AsrTestResult {
  ok: boolean;
  latency_ms?: number | null;
  message: string;
}

/** 麦克风组件启动前的探测结果。 */
export interface TranscribeStatus {
  configured: boolean;
  provider_host: string;
  model: string;
  protocol?: AsrProtocol;
  max_seconds: number;
  max_bytes: number;
}

/** 前端「清除 Key」的哨兵值；与后端 CLEAR_API_KEY 保持一致。 */
export const CLEAR_ASR_KEY = "__clear__";

export function getAsrSettings(): Promise<AsrSettings> {
  return request("/settings/asr");
}

export function saveAsrSettings(payload: AsrSettingsPayload): Promise<AsrSettings> {
  return request("/settings/asr", { method: "PUT", body: JSON.stringify(payload) });
}

/** 用表单当前值测试一次上游（后端发一段静音）；不要求先保存。 */
export function testAsrSettings(payload: AsrSettingsPayload): Promise<AsrTestResult> {
  // 后端要给上游 60 秒预算，客户端同样给足（recognition = 90s），否则会出现
  // "客户端先超时、服务端还在等上游"的假失败。
  return request("/settings/asr/test", {
    method: "POST",
    body: JSON.stringify(payload),
    budget: "recognition",
  });
}

/**
 * 拉取上游模型目录（`GET {base}/models`）。
 *
 * 失败一律由后端翻成空数组，前端只需要"拿不到就提示、手填照常可用"。
 */
export function fetchAsrModels(payload: AsrModelsPayload): Promise<AsrModelsResult> {
  return request("/settings/asr/models", {
    method: "POST",
    body: JSON.stringify(payload),
    budget: "recognition",
  });
}

// ===== 命名配置（global_settings.json 的 asr_profiles 段） =====
//
// 与旧的单配置接口并存：旧接口仍被「测试连接」草稿与老调用点使用，不删。

/** 一条命名配置的对外形态：**不含 Key**，has_key 只说明有没有已保存的 Key。 */
export interface AsrProfile {
  id: string;
  name: string;
  preset_id: string;
  base_url: string;
  model: string;
  protocol: AsrProtocol;
  has_key: boolean;
  configured: boolean;
  updated_at: string;
}

/** 列表与所有增删改接口的统一响应：前端拿整份状态替换本地副本。 */
export interface AsrProfilesState {
  active_profile_id: string;
  profiles: AsrProfile[];
}

/** 新建/更新一条配置的请求体；id 为空表示新建。 */
export interface AsrProfilePayload {
  id?: string;
  name: string;
  preset_id: string;
  base_url: string;
  model: string;
  protocol: AsrProtocol;
  /** 三种口径：新值 / 空串或掩码 = 保留这一条的旧 Key / __clear__ = 清空。 */
  api_key: string;
}

/** 弹窗内「测试连接」的草稿覆盖：字段缺省表示用该条已存配置。 */
export interface AsrProfileTestPayload {
  base_url?: string;
  model?: string;
  protocol?: AsrProtocol;
  api_key?: string;
}

/** 新建弹窗还没有 id 时传给测试接口的占位（与后端 NEW_PROFILE_SENTINEL 一致）。 */
export const NEW_ASR_PROFILE_ID = "new";

/** 最多保存多少份配置（与后端 MAX_ASR_PROFILES 对齐，只用于禁用按钮）。 */
export const MAX_ASR_PROFILES = 10;

export function getAsrProfiles(): Promise<AsrProfilesState> {
  return request("/settings/asr/profiles");
}

export function saveAsrProfile(payload: AsrProfilePayload): Promise<AsrProfilesState> {
  return request("/settings/asr/profiles", { method: "POST", body: JSON.stringify(payload) });
}

export function deleteAsrProfile(profileId: string): Promise<AsrProfilesState> {
  return request("/settings/asr/profiles/" + encodeURIComponent(profileId), { method: "DELETE" });
}

export function activateAsrProfile(profileId: string): Promise<AsrProfilesState> {
  return request("/settings/asr/profiles/" + encodeURIComponent(profileId) + "/activate", {
    method: "POST",
  });
}

export function clearAsrProfileKey(profileId: string): Promise<AsrProfilesState> {
  return request("/settings/asr/profiles/" + encodeURIComponent(profileId) + "/clear-key", {
    method: "POST",
  });
}

/** 用「该条已存 Key + 草稿覆盖」探测一次上游；不落盘。 */
export function testAsrProfile(
  profileId: string,
  payload: AsrProfileTestPayload,
): Promise<AsrTestResult> {
  return request("/settings/asr/profiles/" + encodeURIComponent(profileId) + "/test", {
    method: "POST",
    body: JSON.stringify(payload),
    budget: "recognition",
  });
}
export function getTranscribeStatus(): Promise<TranscribeStatus> {
  return request("/transcribe/status");
}

/** 从 Base URL 取主机名（隐私提示用）。地址还不合法时返回空串。 */
export function providerHostOf(baseUrl: string): string {
  try {
    return new URL(baseUrl.trim()).host;
  } catch {
    return "";
  }
}
