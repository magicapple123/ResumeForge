// SPDX-License-Identifier: Apache-2.0
/**
 * jsdom 没有 WebAudio：给 `LevelMeter` 一个**可控**的替身。
 *
 * 为什么需要"可控"：`useVoiceInput` 的静音闸门（`no_sound`）与正常路径（能上传）只差
 * 一个峰值。如果替身固定返回 0，所有正常用例都会变成"没检测到声音"；固定返回 1 又没法
 * 测静音。所以振幅是可变状态，用例在需要时用 `setAmplitude(0)` 制造一段静音。
 *
 * 只在测试里用：通过 `vi.stubGlobal` 装上，`vi.unstubAllGlobals()` 会自动摘掉。
 * `closedCount` 用来钉住"每次录音都要关掉 AudioContext"（Chrome 每页上限约 6 个，
 * 泄漏第 7 次会静默失败）。
 */

import { vi } from "vitest";

export interface FakeAudioContextHandle {
  /** 设置每个采样点的振幅（0..1）。0 = 全程静音。 */
  setAmplitude: (amplitude: number) => void;
  /** 已经被 `close()` 的次数。 */
  closedCount: () => number;
  /** 被创建的 AudioContext 个数（用来检查有没有泄漏）。 */
  createdCount: () => number;
}

/** 装上替身并返回控制柄。默认振幅 0.5（明显高于静音阈值 0.01）。 */
export function installFakeAudioContext(initialAmplitude = 0.5): FakeAudioContextHandle {
  const state = { amplitude: initialAmplitude, closed: 0, created: 0 };

  class FakeAnalyser {
    fftSize = 1024;
    disconnected = 0;

    getFloatTimeDomainData(buffer: Float32Array): void {
      buffer.fill(state.amplitude);
    }

    disconnect(): void {
      this.disconnected += 1;
    }
  }

  class FakeSource {
    connect(): void {
      // 无实际连接语义。
    }

    disconnect(): void {
      // 同上。
    }
  }

  class FakeAudioContext {
    constructor() {
      state.created += 1;
    }

    createMediaStreamSource(): FakeSource {
      return new FakeSource();
    }

    createAnalyser(): FakeAnalyser {
      return new FakeAnalyser();
    }

    resume(): Promise<void> {
      return Promise.resolve();
    }

    close(): Promise<void> {
      state.closed += 1;
      return Promise.resolve();
    }
  }

  vi.stubGlobal("AudioContext", FakeAudioContext);

  return {
    setAmplitude: (amplitude: number) => {
      state.amplitude = amplitude;
    },
    closedCount: () => state.closed,
    createdCount: () => state.created,
  };
}
