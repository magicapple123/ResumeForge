// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  AUDIO_WORKLET_SOURCE,
  FRAME_SAMPLES,
  FrameAssembler,
  INTERVIEW_AUDIO_CONSTRAINTS,
  TARGET_SAMPLE_RATE,
  WAV_HEADER_BYTES,
  concatFloat32,
  encodeWav,
  floatToPcm16,
  pcm16Level,
  resampleLinear,
} from "./audio";

function readAscii(bytes: Uint8Array, offset: number, length: number): string {
  return String.fromCharCode(...bytes.slice(offset, offset + length));
}

function readUint32(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint32(offset, true);
}

function readUint16(bytes: Uint8Array, offset: number): number {
  return new DataView(bytes.buffer, bytes.byteOffset).getUint16(offset, true);
}

describe("interview-voice/audio：约束与分帧常数", () => {
  it("getUserMedia 约束开齐 AEC / 降噪 / AGC / 单声道", () => {
    expect(INTERVIEW_AUDIO_CONSTRAINTS).toMatchObject({
      echoCancellation: true,
      noiseSuppression: true,
      autoGainControl: true,
      channelCount: 1,
    });
  });

  it("20ms 一帧 = 16kHz 下 320 个采样", () => {
    expect(TARGET_SAMPLE_RATE).toBe(16_000);
    expect(FRAME_SAMPLES).toBe(320);
  });

  it("worklet 源码注册了固定处理器名（与 capture.ts 共用同一常量语义）", () => {
    expect(AUDIO_WORKLET_SOURCE).toContain('registerProcessor("interview-voice-frames"');
    expect(AUDIO_WORKLET_SOURCE).toContain("port.postMessage");
  });
});

describe("interview-voice/audio：纯函数", () => {
  it("多段 Float32 拼接保持顺序", () => {
    const merged = concatFloat32([Float32Array.from([1, 2]), Float32Array.from([3])]);
    expect(Array.from(merged)).toEqual([1, 2, 3]);
  });

  it("48kHz → 16kHz 线性重采样：长度与直流值都不变", () => {
    const source = new Float32Array(960).fill(0.5);
    const resampled = resampleLinear(source, 48_000);
    expect(resampled.length).toBe(320);
    expect(resampled[0]).toBeCloseTo(0.5, 5);
    expect(resampled[319]).toBeCloseTo(0.5, 5);
  });

  it("Float32 → 16bit PCM 超界按满量程截断", () => {
    const pcm = floatToPcm16(Float32Array.from([1.5, -1.5, 0.5, 0]));
    expect(Array.from(pcm)).toEqual([32_767, -32_767, 16_384, 0]);
  });

  it("PCM 电平是 0–1 的 RMS（静音为 0）", () => {
    expect(pcm16Level(new Int16Array(0))).toBe(0);
    expect(pcm16Level(new Int16Array([0, 0, 0]))).toBe(0);
    expect(pcm16Level(new Int16Array([32_767, 32_767]))).toBeCloseTo(1, 3);
  });
});

describe("interview-voice/audio：WAV 编码", () => {
  it("44 字节头 + data 段，字段与采样数对得上", () => {
    const pcm = new Int16Array([100, -100, 0]);
    const bytes = encodeWav(pcm);
    expect(bytes.length).toBe(WAV_HEADER_BYTES + pcm.length * 2);
    expect(readAscii(bytes, 0, 4)).toBe("RIFF");
    expect(readAscii(bytes, 8, 4)).toBe("WAVE");
    expect(readAscii(bytes, 12, 4)).toBe("fmt ");
    expect(readUint16(bytes, 20)).toBe(1); // PCM
    expect(readUint16(bytes, 22)).toBe(1); // 单声道
    expect(readUint32(bytes, 24)).toBe(16_000); // 采样率
    expect(readUint16(bytes, 34)).toBe(16); // 位深
    expect(readAscii(bytes, 36, 4)).toBe("data");
    expect(readUint32(bytes, 40)).toBe(pcm.length * 2);
    expect(readUint32(bytes, 4)).toBe(36 + pcm.length * 2);
  });
});

describe("interview-voice/audio：FrameAssembler", () => {
  it("16kHz 下每 320 个采样出一帧，尾巴留到下一次", () => {
    const assembler = new FrameAssembler(16_000);
    expect(assembler.push(new Float32Array(320)).length).toBe(1);
    expect(assembler.push(new Float32Array(200)).length).toBe(0);
    const frames = assembler.push(new Float32Array(440));
    expect(frames.length).toBe(2);
    expect(frames[0].length).toBe(320);
    expect(frames[1].length).toBe(320);
  });

  it("48kHz 下 960 个原生采样 = 一帧 16kHz", () => {
    const assembler = new FrameAssembler(48_000);
    expect(assembler.push(new Float32Array(959)).length).toBe(0);
    const frames = assembler.push(new Float32Array(1));
    expect(frames.length).toBe(1);
    expect(frames[0].length).toBe(FRAME_SAMPLES);
  });

  it("reset 丢弃未凑满的尾巴", () => {
    const assembler = new FrameAssembler(16_000);
    assembler.push(new Float32Array(100));
    assembler.reset();
    expect(assembler.push(new Float32Array(320)).length).toBe(1);
  });
});
