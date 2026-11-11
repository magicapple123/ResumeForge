// SPDX-License-Identifier: Apache-2.0
/**
 * 面试实时语音的音频常数与纯函数：约束、16kHz / 20ms 分帧、PCM→WAV。
 *
 * 全部是无副作用的纯函数或常量，浏览器能力（getUserMedia / AudioWorklet）由
 * `capture.ts` 注入——这样 VAD 与断句的测试不需要真麦克风（#26 P0 明确不依赖真设备）。
 */

/** getUserMedia 约束（26A）：AEC 必须开，否则扬声器里面试官的声音会被 VAD 当成用户在说。 */
export const INTERVIEW_AUDIO_CONSTRAINTS: MediaTrackConstraints = {
  echoCancellation: true,
  noiseSuppression: true,
  autoGainControl: true,
  channelCount: 1,
};

/** VAD 与 ASR 统一的采样率：16kHz 单声道是语音识别的标准输入。 */
export const TARGET_SAMPLE_RATE = 16_000;

/** 一帧 20ms：VAD 的判定粒度（与分帧上传的切段粒度一致）。 */
export const FRAME_MS = 20;
export const FRAME_SAMPLES = (TARGET_SAMPLE_RATE * FRAME_MS) / 1000;

/** AudioWorklet 的固定量子（128 帧）；主线程按量子累积成 20ms 一帧。 */
export const WORKLET_QUANTUM = 128;

/** 16 位 PCM 的满量程。 */
const PCM16_MAX = 32_767;

/**
 * 16kHz / 单声道 / 16bit PCM 的 WAV 头字节数（RIFF + fmt + data 三段头）。
 * /api/transcribe 接受 audio/wav，所以 P0 直接上传 WAV——不需要 MediaRecorder，
 * 分段的起点与终点完全由 VAD 决定。
 */
export const WAV_HEADER_BYTES = 44;

/** 把多段 Float32 拼成一段（分帧缓冲的收尾用）。 */
export function concatFloat32(chunks: readonly Float32Array[]): Float32Array {
  const total = chunks.reduce((sum, item) => sum + item.length, 0);
  const merged = new Float32Array(total);
  let offset = 0;
  for (const chunk of chunks) {
    merged.set(chunk, offset);
    offset += chunk.length;
  }
  return merged;
}

/** 线性插值重采样：AudioContext 的采样率不一定是 16k（Safari / 某些声卡）。 */
export function resampleLinear(
  samples: Float32Array,
  fromRate: number,
  toRate: number = TARGET_SAMPLE_RATE,
): Float32Array {
  if (fromRate === toRate || samples.length === 0) return samples.slice();
  const ratio = fromRate / toRate;
  const length = Math.max(1, Math.round(samples.length / ratio));
  const out = new Float32Array(length);
  for (let index = 0; index < length; index += 1) {
    const position = index * ratio;
    const left = Math.floor(position);
    const right = Math.min(left + 1, samples.length - 1);
    const weight = position - left;
    out[index] = samples[left] * (1 - weight) + samples[right] * weight;
  }
  return out;
}

/** Float32 [-1, 1] → 16 位 PCM（超界按满量程截断，不静默环绕）。 */
export function floatToPcm16(samples: Float32Array): Int16Array {
  const out = new Int16Array(samples.length);
  for (let index = 0; index < samples.length; index += 1) {
    const clamped = Math.max(-1, Math.min(1, samples[index]));
    out[index] = Math.round(clamped * PCM16_MAX);
  }
  return out;
}

/** 16 位 PCM 的近似 RMS（0–1）：电平条与"有没有声音"的兜底判断共用。 */
export function pcm16Level(pcm: Int16Array): number {
  if (pcm.length === 0) return 0;
  let sum = 0;
  for (const value of pcm) sum += (value / PCM16_MAX) ** 2;
  return Math.sqrt(sum / pcm.length);
}

function writeAscii(view: DataView, offset: number, text: string): void {
  for (let index = 0; index < text.length; index += 1) {
    view.setUint8(offset + index, text.charCodeAt(index));
  }
}

/** 把 16 位 PCM 编码成 WAV 字节（44 字节头 + 数据）。 */
export function encodeWav(pcm: Int16Array, sampleRate: number = TARGET_SAMPLE_RATE): Uint8Array {
  const dataBytes = pcm.length * 2;
  const buffer = new ArrayBuffer(WAV_HEADER_BYTES + dataBytes);
  const view = new DataView(buffer);
  writeAscii(view, 0, "RIFF");
  view.setUint32(4, 36 + dataBytes, true);
  writeAscii(view, 8, "WAVE");
  writeAscii(view, 12, "fmt ");
  view.setUint32(16, 16, true); // PCM 子块大小
  view.setUint16(20, 1, true); // PCM 编码
  view.setUint16(22, 1, true); // 单声道
  view.setUint32(24, sampleRate, true);
  view.setUint32(28, sampleRate * 2, true); // 字节率 = rate * blockAlign
  view.setUint16(32, 2, true); // blockAlign：单声道 16bit
  view.setUint16(34, 16, true); // 位深
  writeAscii(view, 36, "data");
  view.setUint32(40, dataBytes, true);
  for (let index = 0; index < pcm.length; index += 1) {
    view.setInt16(WAV_HEADER_BYTES + index * 2, pcm[index], true);
  }
  return new Uint8Array(buffer);
}

/** 与 encodeWav 等价的 Blob 形式（FormData 上传入口用）。 */
export function encodeWavBlob(pcm: Int16Array, sampleRate?: number): Blob {
  // TS 5.7+ 的 Uint8Array 带 ArrayBufferLike 泛型，BlobPart 只收 ArrayBuffer 视图。
  return new Blob([encodeWav(pcm, sampleRate) as unknown as BlobPart], { type: "audio/wav" });
}

/**
 * AudioWorklet 处理器源码：只做"把每个 128 帧量子转发给主线程"，不做任何判定。
 *
 * 判定与分帧留在主线程（20ms 一帧），这样 VAD / 断句逻辑可以用纯函数测试，
 * worklet 里不需要再维护一份状态。用字符串 + Blob URL 注入，避免构建器把
 * worklet 当成独立入口再打一次包。
 */
export const AUDIO_WORKLET_SOURCE = `
class InterviewVoiceFrameProcessor extends AudioWorkletProcessor {
  process(inputs) {
    const channel = inputs[0] && inputs[0][0];
    if (channel && channel.length > 0) {
      this.port.postMessage(channel.slice(0));
    }
    return true;
  }
}
registerProcessor("interview-voice-frames", InterviewVoiceFrameProcessor);
`;

export const AUDIO_WORKLET_NAME = "interview-voice-frames";

/**
 * 把任意采样率的音频块累积/重采样成 20ms 一帧。
 *
 * 每个量子 128 帧（8kHz 时 16ms、48kHz 时 2.7ms）——直接按 320 采样切帧会在
 * 非 16k 环境下切出错位的帧，所以这里先按"目标帧数"换算出原生采样数再重采样。
 */
export class FrameAssembler {
  private readonly ratio: number;
  private readonly nativeFrameSamples: number;
  private pending: Float32Array = new Float32Array(0);

  constructor(private readonly sampleRate: number = TARGET_SAMPLE_RATE) {
    this.ratio = sampleRate / TARGET_SAMPLE_RATE;
    this.nativeFrameSamples = Math.max(1, Math.round(FRAME_SAMPLES * this.ratio));
  }

  /** 推入一块原生采样，返回这次能凑齐的 16kHz 帧。 */
  push(block: Float32Array): Float32Array[] {
    const merged = new Float32Array(this.pending.length + block.length);
    merged.set(this.pending);
    merged.set(block, this.pending.length);
    const frames: Float32Array[] = [];
    let offset = 0;
    while (merged.length - offset >= this.nativeFrameSamples) {
      const frame = merged.subarray(offset, offset + this.nativeFrameSamples);
      frames.push(
        this.ratio === 1
          ? Float32Array.from(frame)
          : resampleLinear(frame, this.sampleRate, TARGET_SAMPLE_RATE),
      );
      offset += this.nativeFrameSamples;
    }
    this.pending = merged.slice(offset);
    return frames;
  }

  /** 丢弃未凑满一帧的尾巴（停止录音时用）。 */
  reset(): void {
    this.pending = new Float32Array(0);
  }
}
