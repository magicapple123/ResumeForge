// SPDX-License-Identifier: Apache-2.0
/**
 * 26F 语音输出接口：``InterviewVoiceOutput { enqueue / duck / flush / stop }``。
 *
 * 实时通话模式使用浏览器本机 SpeechSynthesis；不需要语音输出的上下文继续使用 **no-op**，
 * 所有插话、停止和清理都通过同一接口完成：
 *
 * - ``enqueue(text)``：按**句**入队（流式 TTS 边出字边合成，入队单位必须是句而不是整段）；
 * - ``duck(depthDb)``：插话时压低或暂停输出，``duck(0)`` 表示恢复；
 * - ``flush()``：打断时清空播放队列；
 * - ``stop()``：彻底停止（结束面试 / 关闭语音时）。
 *
 * ``createDuckingVoiceOutput`` 是基于播放器增益的参考实现；浏览器 SpeechSynthesis 没有标准
 * 的播放增益节点，因此它在插话检测期间暂停当前 utterance。
 */

export interface InterviewVoiceOutput {
  /** 按句入队（P1 的流式 TTS 在播放前一句时并行合成下一句）。 */
  enqueue(text: string): void;
  /** 压低或暂停输出（负 dB）；传 0 恢复。 */
  duck(depthDb: number): void;
  /** 打断时清空播放队列（已合成未播的句子全部丢弃）。 */
  flush(): void;
  /** 彻底停止并释放播放资源。 */
  stop(): void;
}

/** 默认实现：纯文字模式，四个方法都是 no-op。 */
export function createNoopVoiceOutput(): InterviewVoiceOutput {
  return {
    enqueue: () => undefined,
    duck: () => undefined,
    flush: () => undefined,
    stop: () => undefined,
  };
}

export interface DuckingVoiceOutputOptions {
  /** 把线性增益 0–1 应用到播放器（P1 由 AudioGainNode 提供）。 */
  applyGain: (gain: number) => void;
  /** 淡入步长间隔（ms）；默认 10ms × 15 步 = 150ms。 */
  stepMs?: number;
  setTimer?: (callback: () => void, delayMs: number) => unknown;
  clearTimer?: (handle: unknown) => void;
}

export interface DuckingVoiceOutput extends InterviewVoiceOutput {
  /** 当前线性增益（测试与观测用）。 */
  currentGain(): number;
}

const DEFAULT_STEP_MS = 10;
const FADE_STEPS = 15;

/** 参考实现：duck 立即压到目标增益，恢复（depth >= 0）按 150ms 淡入回到 1。 */
export function createDuckingVoiceOutput(options: DuckingVoiceOutputOptions): DuckingVoiceOutput {
  const stepMs = options.stepMs ?? DEFAULT_STEP_MS;
  const setTimer =
    options.setTimer ??
    ((callback: () => void, delayMs: number) => globalThis.setTimeout(callback, delayMs));
  const clearTimer =
    options.clearTimer ?? ((handle: unknown) => globalThis.clearTimeout(handle as number));
  let gain = 1;
  let timers: unknown[] = [];

  const cancelRamp = () => {
    for (const handle of timers) clearTimer(handle);
    timers = [];
  };
  const apply = (value: number) => {
    gain = value;
    options.applyGain(value);
  };

  return {
    enqueue: () => undefined,
    flush: () => undefined,
    stop: () => {
      cancelRamp();
      apply(1);
    },
    currentGain: () => gain,
    duck(depthDb: number) {
      cancelRamp();
      const target = Math.max(0, Math.min(1, 10 ** (Math.max(-60, Math.min(0, depthDb)) / 20)));
      if (target < gain) {
        // 压音量是即时动作：插话必须立刻变小。
        apply(target);
        return;
      }
      // 恢复走 150ms 淡入（15 步），避免"啪"的一下。最后一步精确回到 1。
      const from = gain;
      for (let step = 1; step <= FADE_STEPS; step += 1) {
        timers.push(
          setTimer(() => {
            if (step === FADE_STEPS) {
              timers = [];
              apply(1);
              return;
            }
            apply(from + (1 - from) * (step / FADE_STEPS));
          }, step * stepMs),
        );
      }
    },
  };
}
