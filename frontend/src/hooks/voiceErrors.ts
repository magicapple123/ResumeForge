// SPDX-License-Identifier: Apache-2.0
/**
 * 语音听写的错误码与文案映射：**一处定义，两个 hook 共用**。
 *
 * 从 `useVoiceInput` 里搬出来是为了让「测试麦克风」的 `useMicMeter` 也能报同一批
 * 麦克风错误（权限被拒 / 没有设备 / 采集失败）。若两边各写一份，同一个
 * `NotAllowedError` 会在两个入口显示两种说法。
 *
 * 后端判定的原因（鉴权失败、地址不存在、服务商异常）不走这里：那些要原样透传服务端
 * 那句中文，否则用户看不到"到底哪一步配错了"。
 */

import { t } from "../i18n";

export type VoiceErrorCode =
  | "no_microphone"
  | "permission_denied"
  | "recording_failed"
  | "unsupported"
  | "timeout"
  | "not_configured"
  | "too_large"
  | "empty"
  | "backend_too_old"
  | "service_failed"
  /** 录音短于 `MIN_RECORDING_MS`：几乎必然是误触，不上传。 */
  | "too_short"
  /** 全程峰值低于 `SILENCE_PEAK_THRESHOLD`：设备选错或被静音。 */
  | "no_sound"
  /** 识别结果只有语气词且录音很短：判定为"没听清"，不插入。 */
  | "no_heard";

export interface VoiceError {
  code: VoiceErrorCode;
  message: string;
}

/** 文案占位符。与 i18n 的 `MessageParams` 同形，但在这里独立声明避免类型循环。 */
export type VoiceMessageParams = Record<string, string | number>;

/** 前端自己判定得到的错误码 → 文案。后端原因走 ApiError.message，不在这里翻。 */
function messageFor(code: VoiceErrorCode, params?: VoiceMessageParams): string {
  switch (code) {
    case "no_microphone":
      return t("voiceInput.error.noMicrophone");
    case "permission_denied":
      return t("voiceInput.error.permissionDenied");
    case "recording_failed":
      return t("voiceInput.error.recordingFailed");
    case "unsupported":
      return t("voiceInput.error.unsupported");
    case "timeout":
      return t("voiceInput.error.timeout");
    case "not_configured":
      return t("voiceInput.error.notConfigured");
    case "too_large":
      return t("voiceInput.error.tooLarge");
    case "empty":
      return t("voiceInput.error.empty");
    case "backend_too_old":
      return t("voiceInput.error.backendTooOld");
    case "too_short":
      return t("voiceInput.error.tooShort");
    case "no_sound":
      return t("voiceInput.error.noSound", params);
    case "no_heard":
      return t("voiceInput.error.noHeard");
    default:
      return t("voiceInput.error.serviceFailed");
  }
}

export function errorOf(code: VoiceErrorCode, params?: VoiceMessageParams): VoiceError {
  return { code, message: messageFor(code, params) };
}

/**
 * getUserMedia 的失败原因 → 用户能看懂的分类。不用 instanceof Error：部分环境里
 * DOMException 与 Error 不同链，判断失败会让"权限被拒"退化成兜底的"录音失败"。
 */
export function microphoneErrorFor(error: unknown): VoiceError {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") return errorOf("permission_denied");
  if (
    name === "NotFoundError" ||
    name === "DevicesNotFoundError" ||
    name === "OverconstrainedError"
  ) {
    return errorOf("no_microphone");
  }
  return errorOf("recording_failed");
}
