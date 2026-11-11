// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  DEFAULT_VAD_CONFIG,
  VAD_THRESHOLD_MAX,
  VAD_THRESHOLD_MIN,
  clampThreshold,
  createVadGate,
  frameMetrics,
  looksLikeSpeech,
} from "./vad";

const FRAME = 320;

function sineFrame(amplitude: number, frequency = 440): Float32Array {
  const frame = new Float32Array(FRAME);
  for (let index = 0; index < FRAME; index += 1) {
    frame[index] = amplitude * Math.sin((2 * Math.PI * frequency * index) / 16_000);
  }
  return frame;
}

/** 高频方波：过零率 0.5、能量低——用来验证"过零率高不等于在说话"。 */
function noiseFrame(amplitude: number): Float32Array {
  const frame = new Float32Array(FRAME);
  for (let index = 0; index < FRAME; index += 1) {
    frame[index] = index % 2 === 0 ? amplitude : -amplitude;
  }
  return frame;
}

describe("interview-voice/vad：阈值口径", () => {
  it("阈值被夹在 0.5–0.7", () => {
    expect(clampThreshold(0.1)).toBe(VAD_THRESHOLD_MIN);
    expect(clampThreshold(0.9)).toBe(VAD_THRESHOLD_MAX);
    expect(clampThreshold(0.6)).toBe(0.6);
  });
});

describe("interview-voice/vad：帧特征", () => {
  it("静音帧得分 0", () => {
    const metrics = frameMetrics(new Float32Array(FRAME));
    expect(metrics.rms).toBe(0);
    expect(metrics.score).toBe(0);
    expect(looksLikeSpeech(metrics)).toBe(false);
  });

  it("正常说话音量（sine 0.3）被判为语音", () => {
    const metrics = frameMetrics(sineFrame(0.3));
    expect(metrics.rms).toBeGreaterThan(0.1);
    expect(metrics.score).toBeGreaterThan(DEFAULT_VAD_CONFIG.threshold);
    expect(looksLikeSpeech(metrics)).toBe(true);
  });

  it("极低底噪（低于能量地板）判静音，即使波形非零", () => {
    expect(looksLikeSpeech(frameMetrics(noiseFrame(0.002)))).toBe(false);
  });

  it("高过零率低能量的方波噪声不会误判成说话", () => {
    const metrics = frameMetrics(noiseFrame(0.02));
    expect(metrics.zeroCrossingRate).toBeGreaterThan(0.4);
    expect(metrics.score).toBeLessThan(DEFAULT_VAD_CONFIG.threshold);
    expect(looksLikeSpeech(metrics)).toBe(false);
  });

  it("阈值可以调到更灵敏的 0.5 档", () => {
    const metrics = frameMetrics(sineFrame(0.1));
    expect(metrics.score).toBeGreaterThan(0.5);
    expect(metrics.score).toBeLessThan(0.7);
    expect(looksLikeSpeech(metrics, { ...DEFAULT_VAD_CONFIG, threshold: 0.7 })).toBe(false);
    expect(looksLikeSpeech(metrics, { ...DEFAULT_VAD_CONFIG, threshold: 0.5 })).toBe(true);
  });
});

describe("interview-voice/vad：开口 / 说完边沿", () => {
  it("连续有声 60ms 才算开口（单帧噪声不触发）", () => {
    const gate = createVadGate({ ...DEFAULT_VAD_CONFIG, minSpeechMs: 60, hangoverMs: 200 });
    const speech = frameMetrics(sineFrame(0.3));
    expect(gate.push(speech, 0).started).toBe(false);
    expect(gate.push(speech, 20).started).toBe(false);
    expect(gate.push(speech, 40).started).toBe(false);
    const started = gate.push(speech, 60);
    expect(started.started).toBe(true);
    expect(started.speech).toBe(true);
    expect(gate.speech).toBe(true);
  });

  it("连续无声 200ms 才算说完（句内短停顿不断句）", () => {
    const gate = createVadGate({ ...DEFAULT_VAD_CONFIG, minSpeechMs: 60, hangoverMs: 200 });
    const speech = frameMetrics(sineFrame(0.3));
    const silence = frameMetrics(new Float32Array(FRAME));
    for (const at of [0, 20, 40, 60]) gate.push(speech, at);
    expect(gate.push(silence, 80).ended).toBe(false);
    expect(gate.push(silence, 260).ended).toBe(false);
    const ended = gate.push(silence, 280);
    expect(ended.ended).toBe(true);
    expect(ended.speech).toBe(false);
  });

  it("reset 后重新从静音开始", () => {
    const gate = createVadGate();
    const speech = frameMetrics(sineFrame(0.3));
    for (const at of [0, 20, 40, 60, 80]) gate.push(speech, at);
    expect(gate.speech).toBe(true);
    gate.reset();
    expect(gate.speech).toBe(false);
  });
});
