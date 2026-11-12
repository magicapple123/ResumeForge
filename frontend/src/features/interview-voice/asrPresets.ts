// SPDX-License-Identifier: Apache-2.0
/**
 * 语音转写的服务商预设（条目 03）。
 *
 * 每条预设只描述四件事：Base URL、**调用协议**、默认模型候选、一句说明。预设不是免校验：
 * 保存与「测试连接」仍会真的打一次上游，能过才算配置正确。
 *
 * ## 为什么每条都带 protocol
 *
 * 语音服务存在两套互不兼容的请求体：
 *
 * - `openai`：`POST {base}/audio/transcriptions`，`multipart/form-data`（OpenAI / Groq / 硅基流动）；
 * - `dashscope`：`POST {base}/chat/completions`，`messages[0].content=[{type:"input_audio",...}]`
 *   （阿里云百炼 Qwen-ASR）。
 *
 * 百炼的 OpenAI **兼容地址**并不实现 `/audio/transcriptions`，所以"地址一样 → 协议一样"这个
 * 假设是错的。协议必须跟着预设走，由用户在下拉里显式选（自定义时）。
 *
 * ## 模型名与日期
 *
 * 模型名是厂商公开的技术标识，不进语言包。OpenAI 已公布 `whisper-1` / `gpt-4o-transcribe`
 * 系列于 **2027-02-26** 关停（`gpt-transcribe` 是官方推荐替代），这里只标注、不做默认；
 * 日期是常量，显示文案走 i18n（`voiceInput.settings.model.retired`）。
 */
import type { MessageKey } from "../../i18n";
import type { AsrProtocol } from "./asrApi";

export interface AsrModelPreset {
  /** 上游模型 id（技术标识，原样提交给服务商）。 */
  id: string;
  /** 官方公布的下线日（`YYYY-MM-DD`）；只有旧模型有。 */
  retireOn?: string;
}

export interface AsrPreset {
  id: string;
  labelKey: MessageKey;
  noteKey: MessageKey;
  baseUrl: string;
  protocol: AsrProtocol;
  models: readonly AsrModelPreset[];
}

/** 预设之外的一条路：地址、协议、模型全手填。 */
export const CUSTOM_ASR_PRESET_ID = "custom";

/** OpenAI 旧转写模型的关停日（官方公告，2027-02-26）。 */
export const ASR_RETIREMENT_DATE = "2027-02-26";

export const ASR_PRESETS: readonly AsrPreset[] = [
  {
    id: "openai",
    labelKey: "voiceInput.settings.provider.openai",
    noteKey: "voiceInput.settings.provider.note.openai",
    baseUrl: "https://api.openai.com/v1",
    protocol: "openai",
    models: [
      // 官方推荐，也是本预设的默认模型。
      { id: "gpt-transcribe" },
      { id: "whisper-1", retireOn: ASR_RETIREMENT_DATE },
      { id: "gpt-4o-transcribe", retireOn: ASR_RETIREMENT_DATE },
      { id: "gpt-4o-mini-transcribe", retireOn: ASR_RETIREMENT_DATE },
    ],
  },
  {
    id: "groq",
    labelKey: "voiceInput.settings.provider.groq",
    noteKey: "voiceInput.settings.provider.note.groq",
    baseUrl: "https://api.groq.com/openai/v1",
    protocol: "openai",
    models: [{ id: "whisper-large-v3-turbo" }, { id: "whisper-large-v3" }],
  },
  {
    id: "siliconflow",
    labelKey: "voiceInput.settings.provider.siliconflow",
    noteKey: "voiceInput.settings.provider.note.siliconflow",
    baseUrl: "https://api.siliconflow.cn/v1",
    protocol: "openai",
    models: [{ id: "FunAudioLLM/SenseVoiceSmall" }, { id: "TeleAI/TeleSpeechASR" }],
  },
  {
    id: "dashscope",
    labelKey: "voiceInput.settings.provider.dashscope",
    noteKey: "voiceInput.settings.provider.note.dashscope",
    // 百炼的 OpenAI 兼容入口：Qwen-ASR 在这条路径上走 chat，不是 whisper。
    baseUrl: "https://dashscope.aliyuncs.com/compatible-mode/v1",
    protocol: "dashscope",
    models: [{ id: "qwen3-asr-flash" }],
  },
];

/** 地址 + 协议同时命中某预设时返回它，否则 null（= 自定义）。 */
export function asrPresetOf(baseUrl: string, protocol: AsrProtocol): AsrPreset | null {
  const normalized = (baseUrl || "").trim().replace(/\/+$/, "");
  return (
    ASR_PRESETS.find((preset) => preset.baseUrl === normalized && preset.protocol === protocol) ??
    null
  );
}

/** 预设的默认模型（第一条，不会被标注为下线）。 */
export function defaultAsrModelOf(preset: AsrPreset): string {
  return preset.models[0]?.id ?? "";
}

/** 该模型是否已被官方标注下线；是则返回下线日。 */
export function retireDateOf(preset: AsrPreset | null, modelId: string): string {
  if (!preset) return "";
  return preset.models.find((model) => model.id === modelId)?.retireOn ?? "";
}

/** 「疑似转写模型」的关键词：目录里混着 LLM / 图像 / 语音合成，默认只显示这一组。 */
const TRANSCRIBE_HINTS = ["whisper", "transcribe", "asr", "audio", "speech", "sensevoice"];

export interface GroupedAsrModels {
  /** 命中转写关键词的模型（默认展示这一组）。 */
  transcribe: string[];
  /** 上游返回的全部模型（去重、保序）。 */
  all: string[];
}

/**
 * 把拉取到的模型名分成「疑似转写模型」与「全部模型」两组。
 *
 * 后端**不做**关键词过滤（目录里的模型名千奇百怪，过滤会误杀自定义服务的转写模型），
 * 分组放在这里：默认只显示第一组，用户想看全部时自己切换。
 */
export function groupAsrModels(names: readonly string[]): GroupedAsrModels {
  const all: string[] = [];
  const seen = new Set<string>();
  for (const name of names) {
    const cleaned = (name || "").trim();
    if (!cleaned || seen.has(cleaned)) continue;
    seen.add(cleaned);
    all.push(cleaned);
  }
  const transcribe = all.filter((name) => {
    const lowered = name.toLowerCase();
    return TRANSCRIBE_HINTS.some((hint) => lowered.includes(hint));
  });
  return { transcribe, all };
}
