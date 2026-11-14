// SPDX-License-Identifier: Apache-2.0
/**
 * 实时语音通话的可配置参数（Q1-D）。
 *
 * 为什么存 `localStorage` 而不是数据库：这些参数描述的是"这台机器上我怎么听/怎么说"
 * （界面偏好），与当前打开哪份数据集无关——与 `voicePrefs` / `resumeforge.voice.device_id`
 * 同一条判据。**因此不需要数据库迁移**。
 *
 * 版本号放在键名里也放在值里：键名换版本等于干净重置，值里的 `version` 让"老 JSON 缺少
 * 新字段"能被补齐（而不是整份作废、把用户调过的音色丢掉）。
 */
import { useEffect, useState } from "react";

export type BargeInSensitivity = "slow" | "normal" | "fast";

export interface InterviewVoiceSettings {
  version: 1;
  /** 面试官是否朗读（关掉后只出文字）。 */
  speakInterviewer: boolean;
  /** 播报音色 id（必须是后端 `VOICES` 里的一个；未知值回落默认）。 */
  voice: string;
  /** 播报语速 0.7–1.5。 */
  rate: number;
  /** 播报音量 0–1。 */
  volume: number;
  /** 说完多久算说完（ms，400–1500）。 */
  endpointSilenceMs: number;
  /** 语气词（嗯/然后）之后延长多久（ms，1000–2500）。 */
  fillerHoldMs: number;
  /** 识别完是否自动发送；关掉后落成待确认气泡。 */
  autoSend: boolean;
  /** 插话灵敏度：越灵敏越容易被环境噪声误触发。 */
  bargeIn: BargeInSensitivity;
  /** 单段录音上限（秒，60–300）。 */
  maxRecordSeconds: number;
}

export const VOICE_SETTINGS_KEY = "resumeforge.interviewVoice.settings.v1";

export const DEFAULT_VOICE_SETTINGS: InterviewVoiceSettings = {
  version: 1,
  speakInterviewer: true,
  voice: "Cherry",
  rate: 1,
  volume: 1,
  endpointSilenceMs: 700,
  fillerHoldMs: 1400,
  autoSend: true,
  bargeIn: "normal",
  maxRecordSeconds: 180,
};

/** 插话灵敏度 → 最小连续语音时长（与 `bargeIn.BARGE_IN_MIN_SPEECH_MS` 同一口径）。 */
export const BARGE_IN_MIN_SPEECH_MS: Record<BargeInSensitivity, number> = {
  slow: 500,
  normal: 300,
  fast: 200,
};

/** 各字段的合法区间：界面滑块与读回校验共用，避免两处各写一份。 */
export const VOICE_SETTING_RANGES = {
  rate: [0.7, 1.5],
  volume: [0, 1],
  endpointSilenceMs: [400, 1500],
  fillerHoldMs: [1000, 2500],
  maxRecordSeconds: [60, 300],
} as const;

function clamp(value: number, low: number, high: number, fallback: number): number {
  if (!Number.isFinite(value)) return fallback;
  return Math.min(high, Math.max(low, value));
}

/** 把任意来源的值收成合法设置：缺字段补默认、超区间夹住、枚举不认识就回落。 */
export function normalizeVoiceSettings(raw: unknown): InterviewVoiceSettings {
  const source = (raw ?? {}) as Partial<InterviewVoiceSettings>;
  const base = DEFAULT_VOICE_SETTINGS;
  const bargeIn =
    source.bargeIn === "slow" || source.bargeIn === "normal" || source.bargeIn === "fast"
      ? source.bargeIn
      : base.bargeIn;
  return {
    version: 1,
    speakInterviewer:
      typeof source.speakInterviewer === "boolean"
        ? source.speakInterviewer
        : base.speakInterviewer,
    voice: typeof source.voice === "string" && source.voice ? source.voice : base.voice,
    rate: clamp(Number(source.rate), 0.7, 1.5, base.rate),
    volume: clamp(Number(source.volume), 0, 1, base.volume),
    endpointSilenceMs: clamp(Number(source.endpointSilenceMs), 400, 1500, base.endpointSilenceMs),
    fillerHoldMs: clamp(Number(source.fillerHoldMs), 1000, 2500, base.fillerHoldMs),
    autoSend: typeof source.autoSend === "boolean" ? source.autoSend : base.autoSend,
    bargeIn,
    maxRecordSeconds: clamp(Number(source.maxRecordSeconds), 60, 300, base.maxRecordSeconds),
  };
}

/** 读一次；解析失败（被手改坏 / 旧版本结构）回落默认值，不让整页崩在 JSON.parse 上。 */
export function loadVoiceSettings(): InterviewVoiceSettings {
  if (typeof window === "undefined") return DEFAULT_VOICE_SETTINGS;
  try {
    const text = window.localStorage.getItem(VOICE_SETTINGS_KEY);
    if (!text) return DEFAULT_VOICE_SETTINGS;
    return normalizeVoiceSettings(JSON.parse(text));
  } catch {
    return DEFAULT_VOICE_SETTINGS;
  }
}

const EVENT = "resumeforge:interview-voice-settings";

/** 保存并广播：通话里的 ⚙ 与设置页的卡片改同一份值，两边要立刻同步。 */
export function saveVoiceSettings(next: InterviewVoiceSettings): InterviewVoiceSettings {
  const normalized = normalizeVoiceSettings(next);
  try {
    window.localStorage.setItem(VOICE_SETTINGS_KEY, JSON.stringify(normalized));
  } catch {
    // 隐私模式 / 配额满：内存里仍然生效，只是重启不保留。不该因此打断面试。
  }
  window.dispatchEvent(new CustomEvent(EVENT, { detail: normalized }));
  return normalized;
}

export function patchVoiceSettings(patch: Partial<InterviewVoiceSettings>): InterviewVoiceSettings {
  return saveVoiceSettings({ ...loadVoiceSettings(), ...patch });
}

export function resetVoiceSettings(): InterviewVoiceSettings {
  return saveVoiceSettings(DEFAULT_VOICE_SETTINGS);
}

/** 订阅式读取：同一页里两处入口改同一个键，任一处保存后另一处立即重渲染。 */
export function useVoiceSettings(): [InterviewVoiceSettings, typeof patchVoiceSettings] {
  const [settings, setSettings] = useState<InterviewVoiceSettings>(loadVoiceSettings);
  useEffect(() => {
    const onChange = (event: Event) => {
      const detail = (event as CustomEvent<InterviewVoiceSettings>).detail;
      setSettings(detail ? normalizeVoiceSettings(detail) : loadVoiceSettings());
    };
    const onStorage = (event: StorageEvent) => {
      if (event.key === VOICE_SETTINGS_KEY) setSettings(loadVoiceSettings());
    };
    window.addEventListener(EVENT, onChange);
    window.addEventListener("storage", onStorage);
    return () => {
      window.removeEventListener(EVENT, onChange);
      window.removeEventListener("storage", onStorage);
    };
  }, []);
  return [settings, patchVoiceSettings];
}
