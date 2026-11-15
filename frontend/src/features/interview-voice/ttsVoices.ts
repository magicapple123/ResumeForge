// SPDX-License-Identifier: Apache-2.0
/**
 * 面试官语音的**服务商档位**（T10，纯函数）。
 *
 * 两档并列：`dashscope`（百炼 `qwen3-tts-flash`，4 个中文音色，默认档）与
 * `deepseek`（`deepseek-tts`，只有 stella / tide）。档位与音色都存 `localStorage`
 * （`voiceSettings`），所以这里必须回答两个问题：
 *
 * 1. **这一档现在有哪些音色**——优先用后端 `providers[]`（服务端是唯一真相），
 *    拿不到时退回内建的静态表（离线也能渲染下拉，不会变成"只有一个灰项"）。
 * 2. **已存的音色还能不能用**——不能时回落到该档默认音色，并把"换过声"这件事
 *    交回调用方（`fellBack`）。**绝不静默变声**：用户会以为设置坏了。
 *
 * 音色 id 是协议值（要原样提交给上游），永远不进语言包；显示名来自后端（含中文音色名），
 * 静态表里只放回退用的英文标签。
 */
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";

export type TtsProvider = "dashscope" | "deepseek";

export const DEFAULT_TTS_PROVIDER: TtsProvider = "dashscope";

export interface TtsVoiceOption {
  id: string;
  label: string;
}

/** `GET /api/interview/voice/tts/status` 的一档（后端 `_TtsProviderStatus`）。 */
export interface TtsProviderStatus {
  id: string;
  model: string;
  default_voice: string;
  available: boolean;
  voices: TtsVoiceOption[];
}

/** status 响应（顶层四项是旧口径 = 默认档，`providers` 是新口径）。 */
export interface TtsStatusPayload {
  available?: boolean;
  model?: string;
  default_voice?: string;
  voices?: TtsVoiceOption[];
  default_provider?: string;
  providers?: TtsProviderStatus[];
}

/**
 * 内建回退表：与后端 `VOICES` / `interview_tts_deepseek.VOICES` 逐项对应（**只有 id**）。
 *
 * 只有 id 没有显示名：音色名是服务端下发的（含中文音色名），这里再抄一份就会漂移；
 * 离线时下拉显示 id 本身——那是协议值，比显示一个可能已经改过的中文名更诚实。
 */
const FALLBACK_VOICE_IDS: Record<TtsProvider, readonly string[]> = {
  dashscope: ["Cherry", "Serena", "Ethan", "Chelsie"],
  deepseek: ["stella", "tide"],
};

function fallbackVoices(provider: TtsProvider): {
  defaultVoice: string;
  voices: TtsVoiceOption[];
} {
  const ids = FALLBACK_VOICE_IDS[provider];
  return { defaultVoice: ids[0], voices: ids.map((id) => ({ id, label: id })) };
}

/** 档位显示名的语言包 key 映射（类型层不放中文，见 AGENTS「界面已双语化」第 5 条）。 */
export const TTS_PROVIDER_LABEL_KEYS: Record<TtsProvider, MessageKey> = {
  dashscope: "ttsProvider.dashscope",
  deepseek: "ttsProvider.deepseek",
};

/** 把任意来源的档位收成合法值：不认识（含旧版本没写这个字段）回落默认档。 */
export function normalizeTtsProvider(raw: unknown): TtsProvider {
  return raw === "deepseek" ? "deepseek" : DEFAULT_TTS_PROVIDER;
}

/** 下拉里的档位顺序（第一项是默认档）。 */
export const TTS_PROVIDER_ORDER: readonly TtsProvider[] = ["dashscope", "deepseek"];

/** 某一档的音色清单与默认音色（后端优先，离线回退内建表）。 */
export function providerVoicesOf(
  status: TtsStatusPayload | null | undefined,
  provider: TtsProvider,
): { defaultVoice: string; voices: TtsVoiceOption[] } {
  const remote = (status?.providers ?? []).find((item) => item.id === provider);
  if (remote && remote.voices.length > 0) {
    return { defaultVoice: remote.default_voice, voices: remote.voices };
  }
  return fallbackVoices(provider);
}

/** 这一档是否具备合成条件（未知 = 没拿到 status，按"可用"处理，别把入口锁死）。 */
export function providerAvailable(
  status: TtsStatusPayload | null | undefined,
  provider: TtsProvider,
): boolean {
  const remote = (status?.providers ?? []).find((item) => item.id === provider);
  return remote ? remote.available : true;
}

export interface ResolvedTtsVoice {
  /** 真正要提交给后端的音色（一定属于 `provider` 这一档）。 */
  voice: string;
  /** 是否因为"存的音色属于另一档"而回落。界面必须据此给一句提示。 */
  fellBack: boolean;
  /** 回落前的值（提示文案里的 `{previous}`）。 */
  previous: string;
}

/**
 * 已存音色 → 实际要用的音色。
 *
 * 三条判据：
 * - 属于这一档 → 原样用（**旧值永不失效**：选回百炼档时 Cherry 等四个音色照旧）；
 * - 空值 → 用默认音色，但**不算回落**（用户还没选过，不该提示"你的音色被改了"）；
 * - 属于另一档 / 已下线 → 落到本档默认音色，`fellBack=true`。
 */
export function resolveTtsVoice(
  status: TtsStatusPayload | null | undefined,
  provider: TtsProvider,
  voice: string,
): ResolvedTtsVoice {
  const { defaultVoice, voices } = providerVoicesOf(status, provider);
  const chosen = (voice ?? "").trim();
  if (!chosen) return { voice: defaultVoice, fellBack: false, previous: "" };
  if (voices.some((item) => item.id === chosen)) {
    return { voice: chosen, fellBack: false, previous: "" };
  }
  return { voice: defaultVoice, fellBack: true, previous: chosen };
}

/** 回落提示的整句（`{previous}` / `{voice}` 两个占位符，调用方只需传值）。 */
export function fallbackNotice(resolved: ResolvedTtsVoice): string {
  if (!resolved.fellBack) return "";
  return t("ttsProvider.fallback", { previous: resolved.previous, voice: resolved.voice });
}
