// SPDX-License-Identifier: Apache-2.0
/**
 * 26A 的 VAD：能量 + 过零率的零依赖判定（后续可换 Silero ONNX，接口不变）。
 *
 * 阈值口径：0.5–0.7 是**归一化语音得分**的门槛，不是原始 RMS。得分 = 85% 能量 +
 * 15% 过零率——只靠能量时空调声/键盘声会误触发，只靠过零率时清辅音会被漏掉。
 * 阈值放在这里而不是写死：安静房间调到 0.5 更灵敏，嘈杂环境调到 0.7 更保守。
 */

/** 阈值允许区间（产品口径 0.5–0.7）。 */
export const VAD_THRESHOLD_MIN = 0.5;
export const VAD_THRESHOLD_MAX = 0.7;

/** 能量满量程的参考 RMS：普通说话距离下大约 0.06–0.15。 */
const ENERGY_REFERENCE_RMS = 0.12;
/** 过零率参考值：清音/齿音大约 0.05–0.2，白噪声更高。 */
const ZCR_REFERENCE = 0.35;

export interface VadConfig {
  /** 归一化得分阈值；超出 [0.5, 0.7] 会被夹住（产品口径）。 */
  threshold: number;
  /** 低于这个 RMS 的帧直接判静音（能量地板，压掉底噪）。 */
  energyFloor: number;
  /** 连续有声多久才算"开口"（防单帧噪声触发）。 */
  minSpeechMs: number;
  /** 连续无声多久才算"说完"（VAD hangover，断句另有自己的计时）。 */
  hangoverMs: number;
}

export const DEFAULT_VAD_CONFIG: VadConfig = {
  threshold: 0.55,
  energyFloor: 0.004,
  minSpeechMs: 60,
  hangoverMs: 200,
};

export function clampThreshold(value: number): number {
  return Math.max(VAD_THRESHOLD_MIN, Math.min(VAD_THRESHOLD_MAX, value));
}

export interface FrameMetrics {
  /** 归一化 RMS（0–1）。 */
  rms: number;
  /** 过零率（0–1）。 */
  zeroCrossingRate: number;
  /** 归一化语音得分（0–1），与 threshold 比较。 */
  score: number;
}

/** 一帧的音频特征。纯函数，VAD 的所有阈值判断都从这里出发。 */
export function frameMetrics(samples: Float32Array): FrameMetrics {
  if (samples.length === 0) return { rms: 0, zeroCrossingRate: 0, score: 0 };
  let sumSquares = 0;
  let crossings = 0;
  for (let index = 0; index < samples.length; index += 1) {
    const value = samples[index];
    sumSquares += value * value;
    if (index > 0 && samples[index - 1] >= 0 !== value >= 0) crossings += 1;
  }
  const rms = Math.sqrt(sumSquares / samples.length);
  const zeroCrossingRate = crossings / samples.length;
  const energyScore = Math.min(1, rms / ENERGY_REFERENCE_RMS);
  const zcrScore = Math.min(1, zeroCrossingRate / ZCR_REFERENCE);
  // 白噪声的过零率极高但能量低：只有能量过地板时才让过零率参与加分。
  const zcrWeight = rms >= 0.004 ? 0.15 : 0;
  const score = energyScore * (1 - zcrWeight) + zcrScore * zcrWeight;
  return { rms, zeroCrossingRate, score };
}

/** 这一帧是否像"有人在说话"。 */
export function looksLikeSpeech(
  metrics: FrameMetrics,
  config: VadConfig = DEFAULT_VAD_CONFIG,
): boolean {
  if (metrics.rms < config.energyFloor) return false;
  return metrics.score >= clampThreshold(config.threshold);
}

export interface VadGateUpdate {
  /** 当前是否处于"说话中"。 */
  speech: boolean;
  /** 这一帧让状态从静音变成说话（开口）。 */
  started: boolean;
  /** 这一帧让状态从说话变成静音（说完）。 */
  ended: boolean;
}

export interface VadGate {
  push(metrics: FrameMetrics, atMs: number): VadGateUpdate;
  reset(): void;
  readonly speech: boolean;
}

/**
 * VAD 门限状态机：把逐帧判定变成"开口 / 说完"两个边沿事件。
 *
 * 两个方向都带迟滞：开口要连续有声 ``minSpeechMs``，说完要连续无声
 * ``hangoverMs``——咳嗽/键盘声过不了第一道，句子里的短停顿过不了第二道。
 */
export function createVadGate(config: VadConfig = DEFAULT_VAD_CONFIG): VadGate {
  const settings = { ...config, threshold: clampThreshold(config.threshold) };
  let speech = false;
  let voicedSince: number | null = null;
  let silentSince: number | null = null;

  return {
    get speech() {
      return speech;
    },
    reset() {
      speech = false;
      voicedSince = null;
      silentSince = null;
    },
    push(metrics, atMs) {
      const voiced = looksLikeSpeech(metrics, settings);
      if (!speech) {
        if (voiced) {
          if (voicedSince === null) voicedSince = atMs;
          if (atMs - voicedSince >= settings.minSpeechMs) {
            speech = true;
            silentSince = null;
            return { speech: true, started: true, ended: false };
          }
        } else {
          voicedSince = null;
        }
        return { speech: false, started: false, ended: false };
      }
      if (voiced) {
        silentSince = null;
        return { speech: true, started: false, ended: false };
      }
      if (silentSince === null) silentSince = atMs;
      if (atMs - silentSince >= settings.hangoverMs) {
        speech = false;
        voicedSince = null;
        return { speech: false, started: false, ended: true };
      }
      return { speech: true, started: false, ended: false };
    },
  };
}
