// SPDX-License-Identifier: Apache-2.0
/**
 * 26A–26H 的编排层：把 VAD 帧、断句规则、ASR 上传、插话状态机接成一条链路。
 *
 * **不依赖 React / 浏览器**：麦克风由 ``useInterviewVoice`` 注入，转写与 cancel 由
 * deps 注入，时间由 ``now()`` 注入。这样"常开 + 断句 + 插话"的行为可以在纯测试里
 * 用假时钟跑完（#26 P0 明确不依赖真麦克风），React 组件只剩生命周期与渲染。
 *
 * 一轮的流程：
 * ```
 * 开口（VAD started）→ 收集音频帧（带 200ms pre-roll）
 * 静音 >= 700ms      → 上传这一段（/api/transcribe）
 * 转写返回           → 语义分类（endpoint.ts）
 *   · 完整 → 立即发（onTranscript）
 *   · 语气词/没说完 → extended wait（1.4s，最多 5s 思考档）
 *   · 等 ASR/等用户继续期间再次开口 → 同一轮继续收集（多段拼接）
 * ```
 * 面试官正在播报时（assistantActive）走插话分支：VAD 语音 >= 300ms → duck(-24dB) →
 * 200ms 仍在说 → 硬停（onBargeIn）；200ms 内停了 → 恢复音量（150ms 淡入由输出层负责）。
 */

import { type InterviewVoiceOutput, createNoopVoiceOutput } from "./voiceOutput";
import { concatFloat32, floatToPcm16 } from "./audio";
import {
  type EndpointMode,
  type EndpointTiming,
  decideEndpoint,
  shouldUploadSegment,
} from "./endpoint";
import {
  DEFAULT_VAD_CONFIG,
  createVadGate,
  frameMetrics,
  looksLikeSpeech,
  type VadConfig,
  type FrameMetrics,
} from "./vad";
import { BargeInRunner } from "./bargeInRunner";
import {
  type VoiceTelemetryEvent,
  type VoiceTelemetryFields,
  VoiceTurnClock,
  recordVoiceTelemetry,
} from "./telemetry";
import { transcribeSegment } from "./transcribe";

/** 说完之后再收集 300ms 尾巴，避免把最后一个字的尾音切掉。 */
const TURN_TAIL_MS = 300;
/** 开口前的预卷：把 VAD 迟滞（60ms）之前的音频补回来。 */
const PRE_ROLL_FRAMES = 10;
const WAVEFORM_BARS = 24;
const EMIT_INTERVAL_MS = 100;
const LEVEL_FULL_SCALE_RMS = 0.12;

export type VoiceSessionPhase =
  "idle" | "collecting" | "waiting-asr" | "extended" | "thinking" | "barge-in";

export interface VoiceSessionSnapshot {
  phase: VoiceSessionPhase;
  voiceActive: boolean;
  level: number;
  waveform: number[];
  thinking: boolean;
  ducked: boolean;
}

export type VoiceSessionErrorCode = "transcribe-failed" | "empty";

export interface VoiceSessionDeps {
  now?: () => number;
  transcribe?: (pcm: Int16Array) => Promise<string>;
  /** 取消服务端这一轮（26D）；返回里的 rolled_back_chars 用于观测。 */
  cancelTurn?: () => Promise<{ rolled_back_chars?: number } | unknown>;
  output?: InterviewVoiceOutput;
  onTranscript: (text: string) => void;
  onBargeIn: () => void;
  onError?: (code: VoiceSessionErrorCode) => void;
  onUpdate?: (snapshot: VoiceSessionSnapshot) => void;
  telemetry?: (event: VoiceTelemetryEvent, fields?: VoiceTelemetryFields) => void;
  vadConfig?: VadConfig;
  /** 断句时长覆盖（Q1-D）：不传 = `endpoint.ts` 的默认常量。 */
  endpointTiming?: EndpointTiming;
  /** 插话灵敏度覆盖（Q1-D）：不传 = 300ms。 */
  bargeInMinSpeechMs?: number;
}

function clamp01(value: number): number {
  return Math.max(0, Math.min(1, value));
}

export class InterviewVoiceSession {
  private readonly now: () => number;
  private readonly output: InterviewVoiceOutput;
  private readonly telemetry: (event: VoiceTelemetryEvent, fields?: VoiceTelemetryFields) => void;
  private readonly clock: VoiceTurnClock;
  private readonly vad;
  private mode: EndpointMode = "always-on";
  private assistantActive = false;
  private phase: VoiceSessionPhase = "idle";
  private collecting = false;
  private awaitingAsr = false;
  private turnTranscript = "";
  private segmentFrames: Float32Array[] = [];
  private preRoll: Float32Array[] = [];
  private lastSpeechAt: number | null = null;
  private waitDeadlineAt: number | null = null;
  private waitKind: "extended" | "thinking" | null = null;
  private released = false;
  private uploadToken = 0;
  private readonly bargeRunner: BargeInRunner;
  private waveform: number[] = [];
  private level = 0;
  private voiceActive = false;
  private thinking = false;
  private lastEmitAt = 0;
  private lastSnapshotKey = "";
  private disposed = false;
  private readonly vadConfig: VadConfig | undefined;

  constructor(private readonly deps: VoiceSessionDeps) {
    this.now = deps.now ?? (() => performance.now());
    this.output = deps.output ?? createNoopVoiceOutput();
    this.telemetry = deps.telemetry ?? recordVoiceTelemetry;
    this.clock = new VoiceTurnClock(this.now);
    this.vadConfig = deps.vadConfig;
    this.vad = createVadGate(deps.vadConfig);
    this.bargeRunner = new BargeInRunner({
      output: this.output,
      minSpeechMs: deps.bargeInMinSpeechMs,
      onBargeIn: deps.onBargeIn,
      cancelTurn: deps.cancelTurn,
      telemetry: this.telemetry,
      onChange: () => this.emit(true),
    });
  }

  getMode(): EndpointMode {
    return this.mode;
  }

  setMode(mode: EndpointMode): void {
    this.mode = mode;
    this.emit(true);
  }

  /** 面试官开始/停止播报：开始 → 进入插话分支；停止 → 恢复作答分支。 */
  setAssistantActive(active: boolean): void {
    if (this.assistantActive === active) return;
    this.assistantActive = active;
    // 播报开始时丢弃没说完的作答片段：那是被面试官盖住的话，不能当完整回答发出去。
    this.resetTurn();
    this.bargeRunner.reset();
    this.phase = active ? "barge-in" : "idle";
    this.emit(true);
  }

  /** 按住说话松开：跳过所有计时立即上传并发送。 */
  releasePushToTalk(): void {
    this.released = true;
    if (this.assistantActive) return;
    if (this.collecting && !this.awaitingAsr && this.segmentFrames.length > 0) {
      void this.uploadSegment();
      return;
    }
    // 没有可上传的音频（VAD 没测到开口）：至少把已经有的转写发出去。
    if (this.turnTranscript.trim()) this.sendTurn("release");
  }

  /** 每 20ms 一帧（16kHz 单声道 Float32）。 */
  handleFrame(samples: Float32Array, atMs?: number): void {
    if (this.disposed) return;
    const at = atMs ?? this.now();
    const metrics = frameMetrics(samples);
    this.level = clamp01(metrics.rms / LEVEL_FULL_SCALE_RMS);
    this.pushWaveform(this.level);
    if (this.assistantActive) {
      this.bargeRunner.handleFrame(metrics, at, this.assistantActive);
    } else {
      this.handleAnswerFrame(metrics, samples, at);
    }
    this.emit(false, at);
  }

  /** 停止对话（关闭语音 / 离开页面）：清空所有状态，不发送任何未决内容。 */
  stop(): void {
    this.resetTurn();
    this.bargeRunner.reset();
    this.output.flush();
    this.phase = "idle";
    this.emit(true);
  }

  dispose(): void {
    this.disposed = true;
    this.resetTurn();
    this.bargeRunner.reset();
    this.output.stop();
  }

  snapshot(): VoiceSessionSnapshot {
    return {
      phase: this.phase,
      voiceActive: this.voiceActive,
      level: this.level,
      waveform: [...this.waveform],
      thinking: this.thinking,
      ducked: this.bargeRunner.isDucked,
    };
  }

  // ===== 作答分支 =====

  private handleAnswerFrame(metrics: FrameMetrics, samples: Float32Array, at: number): void {
    const update = this.vad.push(metrics, at);
    this.voiceActive = update.speech;
    if (update.started) this.beginTurn(at);
    // "最后一次有人声"按**原始帧**算，不按 VAD 门限状态：门限的 hangover（200ms）期间
    // 仍然报 speech=true，若用它计时，700ms 的断句窗口会被整体推迟 200ms。
    if (looksLikeSpeech(metrics, this.vadConfig ?? DEFAULT_VAD_CONFIG)) this.lastSpeechAt = at;
    if (update.ended) {
      // lastSpeechAt 保持"最后一帧有人声"的时刻：VAD hangover 结束时已经静了 200ms，
      // 若在这里改成当前时刻，700ms 的断句窗口会被推迟 200ms。
      this.clock.mark("speech-end");
      this.telemetry("interview-voice.vad-end", {
        speechMs: this.clock.elapsedMs("vad-start", "speech-end"),
      });
      this.phase = "collecting";
    }
    if (this.collecting) {
      const withinTail = this.lastSpeechAt !== null && at - this.lastSpeechAt <= TURN_TAIL_MS;
      if (update.speech || withinTail) this.segmentFrames.push(Float32Array.from(samples));
    } else {
      this.pushPreRoll(samples);
    }
    this.tick(at);
  }

  private beginTurn(at: number): void {
    // 仍在同一轮（extended / thinking / 等 ASR 期间用户又开口）→ 继续收集，
    // 保留已转写的前半段；只有全新的一轮才清空。
    const continuing = this.collecting;
    this.collecting = true;
    this.segmentFrames = [...this.preRoll];
    this.preRoll = [];
    if (!continuing) {
      this.turnTranscript = "";
      this.released = false;
      this.clock.reset();
      this.clock.mark("vad-start");
      this.telemetry("interview-voice.vad-start");
    }
    if (!this.awaitingAsr) {
      this.waitDeadlineAt = null;
      this.waitKind = null;
      this.awaitingAsr = false;
    }
    this.lastSpeechAt = at;
    this.thinking = false;
    this.phase = "collecting";
  }

  private tick(at: number): void {
    if (this.awaitingAsr) return;
    if (this.waitKind !== null && this.waitDeadlineAt !== null) {
      if (at >= this.waitDeadlineAt) {
        const reason = this.waitKind === "thinking" ? "thinking-timeout" : "extended-deadline";
        this.sendTurn(reason);
      }
      return;
    }
    if (!this.collecting || this.voiceActive) return;
    if (this.lastSpeechAt === null) return;
    const silenceMs = at - this.lastSpeechAt;
    if (
      shouldUploadSegment({
        mode: this.mode,
        hasAudio: this.segmentFrames.length > 0,
        uploadRequested: this.awaitingAsr,
        silenceMs,
        released: this.released,
        timing: this.deps.endpointTiming,
      })
    ) {
      void this.uploadSegment();
    }
  }

  private async uploadSegment(): Promise<void> {
    if (this.awaitingAsr) return;
    this.awaitingAsr = true;
    const token = this.uploadToken + 1;
    this.uploadToken = token;
    this.phase = "waiting-asr";
    const frames = this.segmentFrames;
    this.segmentFrames = [];
    const pcm = floatToPcm16(frames.length > 0 ? concatFloat32(frames) : new Float32Array(0));
    const startedAt = this.now();
    try {
      const text = await (this.deps.transcribe ?? transcribeSegment)(pcm);
      if (this.disposed || token !== this.uploadToken) return;
      this.clock.mark("asr-done");
      this.telemetry("interview-voice.upload", {
        uploadMs: Math.round(this.now() - startedAt),
      });
      this.awaitingAsr = false;
      const piece = (text ?? "").trim();
      if (!piece) {
        // 这一小段没识别出内容（咳嗽/噪声）：丢掉它；上传期间用户没有继续说话就整轮复位。
        if (this.segmentFrames.length === 0) this.resetTurn();
        this.emit(true);
        return;
      }
      this.turnTranscript = this.turnTranscript ? `${this.turnTranscript} ${piece}` : piece;
      this.evaluateEndpoint();
    } catch {
      if (this.disposed || token !== this.uploadToken) return;
      this.awaitingAsr = false;
      this.deps.onError?.("transcribe-failed");
      this.resetTurn();
      this.emit(true);
    }
  }

  /** 转写返回后按 26B 的规则决定：立即发 / 延长 / 思考。 */
  private evaluateEndpoint(): void {
    const at = this.now();
    const lastSpeechAt = this.lastSpeechAt ?? at;
    const silenceMs = Math.max(0, at - lastSpeechAt);
    const decision = decideEndpoint({
      timing: this.deps.endpointTiming,
      text: this.turnTranscript,
      silenceMs,
      atMs: at,
      lastSpeechAt,
      released: this.released,
    });
    // ASR 期间用户又开口了：这一轮还没说完，继续收集（下一次转写再判）。
    if (this.voiceActive) {
      this.waitKind = null;
      this.waitDeadlineAt = null;
      this.phase = "collecting";
      this.clock.mark("endpoint");
      return;
    }
    this.clock.mark("endpoint");
    const endpointMs = this.clock.elapsedMs("speech-end", "endpoint") ?? -1;
    if (decision.kind === "send") {
      this.telemetry("interview-voice.endpoint", {
        decision: decision.cause,
        silenceMs,
        endpointMs,
      });
      this.sendTurn(decision.cause);
      return;
    }
    this.waitKind = decision.kind === "thinking" ? "thinking" : "extended";
    this.waitDeadlineAt = decision.deadlineAt;
    this.thinking = decision.kind === "thinking";
    this.phase = decision.kind === "thinking" ? "thinking" : "extended";
    this.telemetry("interview-voice.endpoint", {
      decision: decision.kind === "thinking" ? "thinking" : decision.cause,
      silenceMs,
      endpointMs,
    });
    this.emit(true);
  }

  private sendTurn(reason: string): void {
    const text = this.turnTranscript.trim();
    const lastSpeechAt = this.lastSpeechAt ?? this.now();
    this.telemetry("interview-voice.endpoint", {
      decision: reason,
      silenceMs: Math.max(0, this.now() - lastSpeechAt),
    });
    this.resetTurn();
    if (text) this.deps.onTranscript(text);
    this.emit(true);
  }

  private resetTurn(): void {
    this.uploadToken += 1;
    this.collecting = false;
    this.awaitingAsr = false;
    this.turnTranscript = "";
    this.segmentFrames = [];
    this.preRoll = [];
    this.lastSpeechAt = null;
    this.waitDeadlineAt = null;
    this.waitKind = null;
    this.released = false;
    this.thinking = false;
    this.voiceActive = false;
    this.vad.reset();
    if (!this.assistantActive) this.phase = "idle";
  }

  // ===== 波形 / 通知 =====

  private pushPreRoll(samples: Float32Array): void {
    this.preRoll.push(Float32Array.from(samples));
    if (this.preRoll.length > PRE_ROLL_FRAMES) this.preRoll.shift();
  }

  private pushWaveform(level: number): void {
    this.waveform.push(level);
    if (this.waveform.length > WAVEFORM_BARS) this.waveform.shift();
  }

  private emit(force: boolean, at?: number): void {
    const snapshot = this.snapshot();
    const key = `${snapshot.phase}|${snapshot.voiceActive}|${snapshot.thinking}|${snapshot.ducked}`;
    const nowAt = at ?? this.now();
    if (!force && key === this.lastSnapshotKey && nowAt - this.lastEmitAt < EMIT_INTERVAL_MS) {
      return;
    }
    this.lastSnapshotKey = key;
    this.lastEmitAt = nowAt;
    this.deps.onUpdate?.(snapshot);
  }
}
