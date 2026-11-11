// SPDX-License-Identifier: Apache-2.0
/**
 * 26C 插话的运行时：把 ``bargeIn.ts`` 的纯状态机接到 duck / cancel / 观测上。
 *
 * 自 ``voiceSession.ts`` 拆出（那支加完 26H 观测后贴着 500 行预算）：插话分支与作答
 * 分支是两条独立链路，状态不共享，拆开后两边都只剩自己那条线。
 *
 * 它只做三件事：
 * 1. 用 VAD 判定"用户是否在说"，累计连续语音时长；
 * 2. 把状态机输出的动作落到输出层（duck / 恢复 / flush）与上层回调（onBargeIn）；
 * 3. 记 26H 的插话观测（是否真打断、打断检测延迟、回滚字数）。
 */

import { DUCK_DEPTH_DB, bargeInStep, createBargeInState, type BargeInState } from "./bargeIn";
import type { InterviewVoiceOutput } from "./voiceOutput";
import type { VoiceTelemetryEvent, VoiceTelemetryFields } from "./telemetry";
import { DEFAULT_VAD_CONFIG, looksLikeSpeech, type FrameMetrics } from "./vad";

/** 插话检测比作答 VAD 更灵敏（0.5 档）：抢话往往比正常回答音量小。 */
export const BARGE_IN_VAD_THRESHOLD = 0.5;

export interface BargeInRunnerDeps {
  output: InterviewVoiceOutput;
  /** 硬停：调用方负责先发 cancel 再 abort 当前生成。 */
  onBargeIn: () => void;
  /** 26D：告诉服务端这一轮被打断（返回里带 rolled_back_chars）。 */
  cancelTurn?: () => Promise<{ rolled_back_chars?: number } | unknown>;
  telemetry: (event: VoiceTelemetryEvent, fields?: VoiceTelemetryFields) => void;
  /** 状态变了（UI 要更新 ducked/插话提示）。 */
  onChange?: () => void;
}

export class BargeInRunner {
  private state: BargeInState = createBargeInState();
  private speechStartedAt: number | null = null;
  private ducked = false;

  constructor(private readonly deps: BargeInRunnerDeps) {}

  get isDucked(): boolean {
    return this.ducked;
  }

  /** 面试官开始播报时调用：清掉上一轮残留状态。 */
  reset(): void {
    this.state = createBargeInState();
    this.speechStartedAt = null;
    this.ducked = false;
  }

  /** 每 20ms 一帧（只在面试官播报/生成期间调用）。 */
  handleFrame(metrics: FrameMetrics, atMs: number, assistantActive: boolean): void {
    if (!assistantActive) return;
    const speaking =
      metrics.rms >= 0.004 &&
      looksLikeSpeech(metrics, { ...DEFAULT_VAD_CONFIG, threshold: BARGE_IN_VAD_THRESHOLD });
    if (speaking && this.speechStartedAt === null) this.speechStartedAt = atMs;
    if (!speaking && this.speechStartedAt === null) return;
    const durationMs = this.speechStartedAt === null ? 0 : atMs - this.speechStartedAt;
    const step = bargeInStep(this.state, {
      atMs,
      speaking,
      speechDurationMs: durationMs,
      assistantActive,
    });
    this.state = step.state;
    if (step.action.kind === "duck") {
      this.deps.output.duck(DUCK_DEPTH_DB);
      this.ducked = true;
      this.deps.telemetry("interview-voice.barge-in", { interrupted: false });
      this.deps.onChange?.();
      return;
    }
    if (step.action.kind === "resume") {
      this.deps.output.duck(0);
      this.ducked = false;
      // 短反馈词（嗯/对/好）：面试官继续说完，不打断生成。
      this.deps.telemetry("interview-voice.barge-in", {
        interrupted: false,
        interruptLatencyMs: -1,
      });
      this.deps.onChange?.();
      return;
    }
    if (step.action.kind === "cancel") {
      const latency = this.speechStartedAt === null ? -1 : Math.max(0, atMs - this.speechStartedAt);
      this.deps.telemetry("interview-voice.barge-in", {
        interrupted: true,
        interruptLatencyMs: latency,
      });
      this.deps.output.flush();
      this.deps.output.duck(0);
      this.ducked = false;
      // 先让服务端知道"这一轮被打断"（落库回滚），再 abort 当前流；顺序反了会先断连接，
      // 服务端只能走"客户端断开"分支，回滚的那段就写不进去。cancel 有超时兜底（hook 里）。
      void this.cancelServerTurn().finally(() => this.deps.onBargeIn());
      this.reset();
      if (speaking) this.speechStartedAt = atMs;
      this.deps.onChange?.();
      return;
    }
    if (!speaking) this.speechStartedAt = null;
  }

  private async cancelServerTurn(): Promise<void> {
    try {
      const result = await this.deps.cancelTurn?.();
      const rolledBack =
        result && typeof result === "object" && "rolled_back_chars" in result
          ? Number((result as { rolled_back_chars?: number }).rolled_back_chars ?? 0)
          : 0;
      this.deps.telemetry("interview-voice.rollback", { rolledBackChars: rolledBack });
    } catch {
      // 取消失败不阻断本地 abort：服务端断开连接时也会把这一轮标成 interrupted。
    }
  }
}
