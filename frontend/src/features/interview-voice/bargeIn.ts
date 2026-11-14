// SPDX-License-Identifier: Apache-2.0
/**
 * 26C 插话（"先压音量再决定"）的纯状态机。
 *
 * ```
 * 检测到语音 >= 300ms → duck（-24dB，不是停）
 * 再过 200ms 仍在说   → 硬停 + cancel
 * 200ms 内就停了      → 短反馈词（嗯/对/好…），恢复音量（150ms 淡入）
 * ```
 *
 * 300ms 最小语音时长是防误触的关键：咳嗽、键盘声、旁人说话都过不了这一关。
 * 这里**不依赖 ASR**——如果等转写回来再决定，反馈词早就把面试官掐断了；P0 用
 * "短促语音在确认窗口内结束"作为反馈词的代理判定，ASR 文本只用于观测误打断率。
 */

/** 连续语音达到多久才算"在插话"（低于它的都是噪声）。 */
export const BARGE_IN_MIN_SPEECH_MS = 300;
/** duck 之后仍持续的确认窗口：200ms 内没停就硬停。 */
export const BARGE_IN_CONFIRM_MS = 200;
/** 插话时压到的音量（dB）。 */
export const DUCK_DEPTH_DB = -24;
/** 恢复音量的淡入时长：避免"啪"的一下。 */
export const RESUME_FADE_IN_MS = 150;

/** 短反馈词（只用于观测"误打断率"，不参与实时判定——那要等 ASR）。 */
/**
 * 短反馈词（只用于观测"误打断率"）。同样用 \u 转义：它们是语音匹配记号，
 * 永远不该被翻译，也不该占"待迁移文案"的基线额度。
 */
export const FEEDBACK_WORDS = [
  "\u55ef",
  "\u5bf9",
  "\u597d",
  "\u884c",
  "\u54e6",
  "\u554a",
  "\u662f\u7684",
  "\u597d\u7684",
  "\u55ef\u55ef",
  "\u5bf9\u5bf9",
] as const;

/** 去掉标点与空白后的短反馈词判定。 */
export function isFeedbackWord(text: string): boolean {
  const value = (text ?? "").replace(/[\s\uFF0C\u3002\uFF01\uFF1F\u3001,.!?\u2026]/gu, "");
  if (!value) return false;
  return FEEDBACK_WORDS.some((word) => value === word) || /^(.)\1{1,3}$/u.test(value);
}

/** dB → 线性增益（-24dB ≈ 0.063）。 */
export function dbToGain(depthDb: number): number {
  return 10 ** (depthDb / 20);
}

/** 音量恢复的增益阶梯（150ms 淡入用；最后一步必须精确回到 1）。 */
export function fadeInGains(steps = 15): number[] {
  const count = Math.max(2, Math.floor(steps));
  return Array.from({ length: count }, (_, index) => (index + 1) / count);
}

export type BargeInPhase = "idle" | "ducked" | "cancelled";

export interface BargeInState {
  phase: BargeInPhase;
  /** 这次插话从什么时候开始（VAD 判定开口的时刻）。 */
  speechStartedAt: number | null;
  /** duck 发生的时刻。 */
  duckedAt: number | null;
}

export function createBargeInState(): BargeInState {
  return { phase: "idle", speechStartedAt: null, duckedAt: null };
}

export interface BargeInInput {
  atMs: number;
  /** VAD 当前是否判定用户在说话。 */
  speaking: boolean;
  /** 这次连续语音已持续多久。 */
  speechDurationMs: number;
  /** 面试官是否还在生成/播报（没有播报就没有插话可言）。 */
  assistantActive: boolean;
  /** 最小连续语音时长覆盖（Q1-D「插话灵敏度」；不传 = 300ms）。 */
  minSpeechMs?: number;
}

export type BargeInAction =
  | { kind: "none" }
  | { kind: "duck"; depthDb: number }
  | { kind: "resume"; fadeInMs: number }
  | { kind: "cancel" };

/**
 * 插话状态机：每一步输入"是否在说 / 说了多久 / 面试官是否在播报"，输出该做什么。
 *
 * ducked 阶段里语音停了（无论是"嗯"还是误触）都恢复音量；真正插话（持续到确认窗口
 * 结束）才硬停。恢复/硬停之后状态回到 idle / cancelled，下一轮重新判断。
 */
export function bargeInStep(
  state: BargeInState,
  input: BargeInInput,
): { state: BargeInState; action: BargeInAction } {
  if (!input.assistantActive) {
    if (state.phase === "ducked") {
      return {
        state: createBargeInState(),
        action: { kind: "resume", fadeInMs: RESUME_FADE_IN_MS },
      };
    }
    return { state: createBargeInState(), action: { kind: "none" } };
  }
  if (state.phase === "cancelled") {
    return { state, action: { kind: "none" } };
  }
  if (state.phase === "ducked") {
    if (!input.speaking) {
      // 在确认窗口内停了：短反馈词（"嗯/对/好"），恢复音量继续说完。
      return {
        state: createBargeInState(),
        action: { kind: "resume", fadeInMs: RESUME_FADE_IN_MS },
      };
    }
    if (state.duckedAt !== null && input.atMs - state.duckedAt >= BARGE_IN_CONFIRM_MS) {
      return {
        state: { ...state, phase: "cancelled" },
        action: { kind: "cancel" },
      };
    }
    return { state, action: { kind: "none" } };
  }
  if (!input.speaking) {
    return { state: { ...state, speechStartedAt: null }, action: { kind: "none" } };
  }
  if (input.speechDurationMs < (input.minSpeechMs ?? BARGE_IN_MIN_SPEECH_MS)) {
    return { state, action: { kind: "none" } };
  }
  return {
    state: {
      phase: "ducked",
      speechStartedAt: state.speechStartedAt ?? input.atMs,
      duckedAt: input.atMs,
    },
    action: { kind: "duck", depthDb: DUCK_DEPTH_DB },
  };
}
