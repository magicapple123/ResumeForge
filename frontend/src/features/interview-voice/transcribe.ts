// SPDX-License-Identifier: Apache-2.0
/**
 * P0 的分段上传 ASR：VAD 切出的 16kHz 单声道 16bit WAV → 现有 ``POST /api/transcribe`。
 *
 * 刻意**不新写 ASR 通道**（#26 明确：P0 复用现有接口），也不依赖 MediaRecorder：
 * 分段的起点/终点完全由 VAD 决定，WAV 由 ``audio.ts`` 的纯函数编码，测试里可以把
 * ``request` 换成假实现。
 */

import { request } from "../../api/client";
import { FRAME_MS, encodeWavBlob } from "./audio";

export interface TranscribeSegmentOptions {
  signal?: AbortSignal;
  language?: string;
}

interface TranscribeResponse {
  text: string;
}

/** 上传一段 PCM（16kHz 单声道 16bit），返回去空白后的转写文本。 */
export async function transcribeSegment(
  pcm: Int16Array,
  options: TranscribeSegmentOptions = {},
): Promise<string> {
  if (pcm.length === 0) return "";
  const durationMs = Math.round((pcm.length / 16_000) * 1000);
  const blob = encodeWavBlob(pcm);
  const form = new FormData();
  form.append("file", blob, "voice-16k.wav");
  form.append("duration_ms", String(Math.max(durationMs, FRAME_MS)));
  form.append("language", options.language ?? "zh");
  const result = await request<TranscribeResponse>("/transcribe", {
    method: "POST",
    body: form,
    budget: "recognition",
    signal: options.signal,
  });
  return (result.text ?? "").trim();
}

export interface VoiceTurnCancelResult {
  cancelled: number;
  generated_chars: number;
  played_chars: number;
  rolled_back_chars: number;
}

/**
 * 26C/26D 的"软取消"：告诉服务端这一轮被打断，生成器在下一个 delta 边界停下并回滚。
 *
 * P0 不传 ``playedChars``（纯文字模式：服务端已 flush 的即为用户看到的内容）；
 * P1 接 TTS 后由播放器上报精确字符位置，接口不变。
 */
export async function cancelInterviewVoiceTurn(
  playedChars?: number,
): Promise<VoiceTurnCancelResult> {
  return request<VoiceTurnCancelResult>("/interview/voice/turns/cancel", {
    method: "POST",
    body: JSON.stringify(playedChars === undefined ? {} : { played_chars: playedChars }),
  });
}
