// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import { createDuckingVoiceOutput, createNoopVoiceOutput } from "./voiceOutput";

describe("interview-voice/voiceOutput：默认 no-op（26F 接口位）", () => {
  it("四个方法都存在且调用无副作用（纯文字模式行为不变）", () => {
    const output = createNoopVoiceOutput();
    expect(() => {
      output.enqueue("第一句");
      output.duck(-24);
      output.flush();
      output.stop();
    }).not.toThrow();
  });
});

describe("interview-voice/voiceOutput：P1 参考实现（duck + 150ms 淡入）", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("duck(-24) 立即压到目标增益", () => {
    const gains: number[] = [];
    const output = createDuckingVoiceOutput({ applyGain: (gain) => gains.push(gain) });
    output.duck(-24);
    expect(gains[gains.length - 1]).toBeCloseTo(0.0631, 3);
  });

  it("duck(0) 走 150ms 淡入，最后精确回到 1", () => {
    vi.useFakeTimers();
    const gains: number[] = [];
    const output = createDuckingVoiceOutput({ applyGain: (gain) => gains.push(gain) });
    output.duck(-24);
    const ducked = gains[gains.length - 1];
    expect(ducked).toBeCloseTo(0.0631, 3);
    output.duck(0);
    expect(gains[gains.length - 1]).toBeCloseTo(0.0631, 3); // 淡入还没开始
    vi.advanceTimersByTime(150);
    expect(gains.length).toBe(16); // 1 次 duck + 15 步淡入
    expect(gains[gains.length - 1]).toBe(1);
    expect(output.currentGain()).toBe(1);
    // 单调上升（不出现"啪"的一下）。
    for (let index = 2; index < gains.length; index += 1) {
      expect(gains[index]).toBeGreaterThanOrEqual(gains[index - 1]);
    }
  });

  it("stop 取消未完成的淡入并恢复满音量", () => {
    vi.useFakeTimers();
    const gains: number[] = [];
    const output = createDuckingVoiceOutput({ applyGain: (gain) => gains.push(gain) });
    output.duck(-24);
    output.duck(0);
    vi.advanceTimersByTime(20);
    output.stop();
    expect(gains[gains.length - 1]).toBe(1);
    const count = gains.length;
    vi.advanceTimersByTime(200);
    expect(gains.length).toBe(count);
  });
});
