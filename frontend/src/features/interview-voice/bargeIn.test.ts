// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import {
  BARGE_IN_CONFIRM_MS,
  BARGE_IN_MIN_SPEECH_MS,
  DUCK_DEPTH_DB,
  RESUME_FADE_IN_MS,
  bargeInStep,
  createBargeInState,
  dbToGain,
  fadeInGains,
  isFeedbackWord,
} from "./bargeIn";

const base = { assistantActive: true, atMs: 1_000 };

describe("interview-voice/bargeIn：短反馈词与增益", () => {
  it.each(["嗯", "嗯。", "对", "好", "对对", "嗯嗯", "好的"])("%s 是短反馈词", (text) => {
    expect(isFeedbackWord(text)).toBe(true);
  });

  it.each(["你好", "让我想一下", "对，但是我觉得", ""])("%s 不是短反馈词", (text) => {
    expect(isFeedbackWord(text)).toBe(false);
  });

  it("-24dB ≈ 0.063 线性增益；0dB = 1", () => {
    expect(dbToGain(DUCK_DEPTH_DB)).toBeCloseTo(0.0631, 3);
    expect(dbToGain(0)).toBe(1);
  });

  it("恢复音量是 150ms 淡入阶梯：单调上升到 1", () => {
    const gains = fadeInGains();
    expect(gains.length).toBe(15);
    expect(gains[0]).toBeCloseTo(1 / 15, 5);
    expect(gains[gains.length - 1]).toBe(1);
    for (let index = 1; index < gains.length; index += 1) {
      expect(gains[index]).toBeGreaterThan(gains[index - 1]);
    }
  });
});

describe("interview-voice/bargeIn：状态机（需求表逐行）", () => {
  it("语音 < 300ms：不 duck（防咳嗽/键盘声误触）", () => {
    const step = bargeInStep(createBargeInState(), {
      ...base,
      speaking: true,
      speechDurationMs: BARGE_IN_MIN_SPEECH_MS - 1,
    });
    expect(step.action).toEqual({ kind: "none" });
    expect(step.state.phase).toBe("idle");
  });

  it("语音 >= 300ms：立刻 duck 到 -24dB（不是停）", () => {
    const step = bargeInStep(createBargeInState(), {
      ...base,
      speaking: true,
      speechDurationMs: BARGE_IN_MIN_SPEECH_MS,
    });
    expect(step.action).toEqual({ kind: "duck", depthDb: DUCK_DEPTH_DB });
    expect(step.state.phase).toBe("ducked");
    expect(step.state.duckedAt).toBe(base.atMs);
  });

  it("duck 后 200ms 内仍在说：硬停 + cancel", () => {
    const ducked = bargeInStep(createBargeInState(), {
      ...base,
      speaking: true,
      speechDurationMs: 300,
    }).state;
    const before = bargeInStep(ducked, {
      atMs: base.atMs + BARGE_IN_CONFIRM_MS - 1,
      speaking: true,
      speechDurationMs: 499,
      assistantActive: true,
    });
    expect(before.action).toEqual({ kind: "none" });
    const cancelled = bargeInStep(ducked, {
      atMs: base.atMs + BARGE_IN_CONFIRM_MS,
      speaking: true,
      speechDurationMs: 500,
      assistantActive: true,
    });
    expect(cancelled.action).toEqual({ kind: "cancel" });
    expect(cancelled.state.phase).toBe("cancelled");
  });

  it("200ms 内停了（短促词）：恢复音量并给 150ms 淡入", () => {
    const ducked = bargeInStep(createBargeInState(), {
      ...base,
      speaking: true,
      speechDurationMs: 300,
    }).state;
    const resumed = bargeInStep(ducked, {
      atMs: base.atMs + 120,
      speaking: false,
      speechDurationMs: 420,
      assistantActive: true,
    });
    expect(resumed.action).toEqual({ kind: "resume", fadeInMs: RESUME_FADE_IN_MS });
    expect(resumed.state.phase).toBe("idle");
  });

  it("面试官已经说完（assistantActive=false）：duck 状态恢复音量", () => {
    const ducked = bargeInStep(createBargeInState(), {
      ...base,
      speaking: true,
      speechDurationMs: 300,
    }).state;
    const recovered = bargeInStep(ducked, {
      ...base,
      speaking: true,
      speechDurationMs: 600,
      assistantActive: false,
    });
    expect(recovered.action).toEqual({ kind: "resume", fadeInMs: RESUME_FADE_IN_MS });
  });

  it("没有播报时完全不介入（不 duck、不 cancel）", () => {
    const step = bargeInStep(createBargeInState(), {
      ...base,
      speaking: true,
      speechDurationMs: 900,
      assistantActive: false,
    });
    expect(step.action).toEqual({ kind: "none" });
    expect(step.state.phase).toBe("idle");
  });

  it("cancel 之后保持 cancelled，不重复触发", () => {
    const cancelled = { phase: "cancelled" as const, speechStartedAt: 0, duckedAt: 0 };
    const step = bargeInStep(cancelled, {
      atMs: 9_000,
      speaking: true,
      speechDurationMs: 5_000,
      assistantActive: true,
    });
    expect(step.action).toEqual({ kind: "none" });
  });
});
