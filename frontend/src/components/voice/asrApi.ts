// SPDX-License-Identifier: Apache-2.0
/** 语音转写（ASR）配置与状态接口。端点挂在后端 api/transcribe.py（前缀 /api）。 */

import { request } from "../../api/client";

/** 语音服务配置；api_key 只可能是掩码（********）或空串，绝不是原文。 */
export interface AsrSettings {
  base_url: string;
  api_key: string;
  model: string;
  configured: boolean;
}

/** 保存时提交的表单值：api_key 传掩码/空串表示沿用旧 Key，传 __clear__ 表示清空。 */
export interface AsrSettingsPayload {
  base_url: string;
  api_key: string;
  model: string;
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
  max_seconds: number;
  max_bytes: number;
}

/** 前端「清除已保存的 Key」的哨兵值；与后端 CLEAR_API_KEY 保持一致。 */
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
