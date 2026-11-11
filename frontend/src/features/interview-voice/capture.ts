// SPDX-License-Identifier: Apache-2.0
/**
 * 26A 的麦克风采集：getUserMedia（AEC/降噪/AGC/单声道）+ AudioWorklet 16kHz 分帧。
 *
 * 设计要点：
 * 1. **能力全部可注入**（``MicCaptureDeps``）：测试用假 AudioContext 跑分帧与清理，
 *    不需要真麦克风；浏览器里用默认实现。
 * 2. **AudioWorklet 优先**，不可用时退回 ScriptProcessorNode：后者已废弃但在老
 *    Chromium/Safari 上仍可用，退回比"整个语音功能不可用"好。
 * 3. **清理是唯一出口**（``stop()``）：停轨道（灭麦克风指示灯）→ 断开节点 → 关
 *    AudioContext → 撤销 Blob URL。Chrome 每页约 6 个 AudioContext，泄漏会让第 7 次
 *    ``new AudioContext()`` 静默返回 suspended（现象：永远判静音）。
 * 4. 采样率不一定是 16k（Safari 常见 48k）：由 ``FrameAssembler`` 重采样成 20ms 帧。
 */

import {
  AUDIO_WORKLET_NAME,
  AUDIO_WORKLET_SOURCE,
  FrameAssembler,
  INTERVIEW_AUDIO_CONSTRAINTS,
  TARGET_SAMPLE_RATE,
} from "./audio";

/** 麦克风不可用的原因（组件据此出本地化文案）。 */
export type MicErrorCode =
  | "unsupported"
  | "microphone-denied"
  | "microphone-missing"
  | "microphone-busy"
  | "microphone-failed";

/** getUserMedia 的异常 → 可展示的原因码。 */
export function micErrorCode(error: unknown): MicErrorCode {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  if (name === "NotAllowedError" || name === "SecurityError") return "microphone-denied";
  if (name === "NotFoundError" || name === "DevicesNotFoundError") return "microphone-missing";
  if (name === "NotReadableError" || name === "TrackStartError") return "microphone-busy";
  return "microphone-failed";
}

/** 当前环境是否可能有麦克风采集能力（不申请权限，只做能力探测）。 */
export function isMicCaptureSupported(): boolean {
  if (typeof navigator === "undefined" || typeof window === "undefined") return false;
  const mediaDevices = navigator.mediaDevices as MediaDevices | undefined;
  if (typeof mediaDevices?.getUserMedia !== "function") return false;
  return typeof window.AudioContext === "function";
}

interface WorkletPort {
  onmessage: ((event: MessageEvent<Float32Array>) => void) | null;
}

interface WorkletNodeLike {
  port: WorkletPort;
  connect: (destination: unknown) => void;
  disconnect: () => void;
}

interface ScriptProcessorLike {
  onaudioprocess:
    | ((event: { inputBuffer: { getChannelData: (channel: number) => Float32Array } }) => void)
    | null;
  connect: (destination: unknown) => void;
  disconnect: () => void;
}

interface GainLike {
  gain: { value: number };
  connect: (destination: unknown) => void;
  disconnect: () => void;
}

interface AudioContextLike {
  sampleRate: number;
  state?: string;
  destination: unknown;
  resume?: () => Promise<void>;
  close?: () => Promise<void>;
  createMediaStreamSource: (stream: unknown) => {
    connect: (node: unknown) => void;
    disconnect: () => void;
  };
  audioWorklet?: { addModule: (url: string) => Promise<void> };
  createGain?: () => GainLike;
  createScriptProcessor?: (
    bufferSize: number,
    inputChannels: number,
    outputChannels: number,
  ) => ScriptProcessorLike;
}

export interface MicCaptureDeps {
  getUserMedia?: (constraints: MediaStreamConstraints) => Promise<MediaStream>;
  createAudioContext?: (options?: AudioContextOptions) => AudioContextLike;
  createWorkletNode?: (context: AudioContextLike, name: string) => WorkletNodeLike;
  createBlobUrl?: (source: string) => string;
  revokeBlobUrl?: (url: string) => void;
  now?: () => number;
}

export interface MicCaptureOptions {
  /** 每个 20ms 帧回调一次（16kHz 单声道 Float32，[-1,1]）。 */
  onFrame: (frame: Float32Array, atMs: number) => void;
  /** 采集层错误（轨道被系统收走等）；调用方据此关闭语音。 */
  onError?: (error: unknown) => void;
  deps?: MicCaptureDeps;
}

function defaultDeps(): Required<Omit<MicCaptureDeps, "now">> & { now: () => number } {
  return {
    getUserMedia: (constraints) => navigator.mediaDevices.getUserMedia(constraints),
    createAudioContext: (options) =>
      new window.AudioContext(options) as unknown as AudioContextLike,
    createWorkletNode: (context, name) =>
      new window.AudioWorkletNode(
        context as unknown as AudioContext,
        name,
      ) as unknown as WorkletNodeLike,
    createBlobUrl: (source) => URL.createObjectURL(new Blob([source], { type: "text/javascript" })),
    revokeBlobUrl: (url) => URL.revokeObjectURL(url),
    now: () => performance.now(),
  };
}

/**
 * 一条常开麦克风采集管线。
 *
 * ``start()`` 只在用户明确开启语音后调用（常开 ≠ 自动申请权限）；``stop()`` 幂等。
 */
export class MicCapture {
  private stream: MediaStream | null = null;
  private context: AudioContextLike | null = null;
  private source: { connect: (node: unknown) => void; disconnect: () => void } | null = null;
  private workletNode: WorkletNodeLike | null = null;
  private scriptNode: ScriptProcessorLike | null = null;
  private gainNode: GainLike | null = null;
  private blobUrl: string | null = null;
  private assembler = new FrameAssembler();
  private readonly deps: ReturnType<typeof defaultDeps>;
  private started = false;

  constructor(private readonly options: MicCaptureOptions) {
    this.deps = { ...defaultDeps(), ...options.deps } as ReturnType<typeof defaultDeps>;
  }

  get active(): boolean {
    return this.started;
  }

  async start(): Promise<void> {
    if (this.started) return;
    const stream = await this.deps.getUserMedia({
      audio: INTERVIEW_AUDIO_CONSTRAINTS,
      video: false,
    });
    this.stream = stream;
    const context = this.deps.createAudioContext({ sampleRate: TARGET_SAMPLE_RATE });
    this.context = context;
    this.assembler = new FrameAssembler(context.sampleRate || TARGET_SAMPLE_RATE);
    try {
      this.source = context.createMediaStreamSource(stream);
      // 输出端接一个 0 增益节点再接 destination：Worklet 需要被连到图里才会持续跑，
      // 但采集音频绝不能再播出去（否则就是啸叫）。
      const gain = context.createGain?.() ?? null;
      this.gainNode = gain;
      if (gain) {
        gain.gain.value = 0;
        gain.connect(context.destination);
      }
      await this.attachFrames(context, gain);
      if (context.state === "suspended") await context.resume?.();
      if (this.stream.getAudioTracks) {
        for (const track of this.stream.getAudioTracks()) {
          track.onended = () => this.options.onError?.(new Error("audio-track-ended"));
        }
      }
      this.started = true;
    } catch (error) {
      this.stop();
      this.options.onError?.(error);
      throw error;
    }
  }

  private async attachFrames(context: AudioContextLike, gain: GainLike | null): Promise<void> {
    const sink = gain ?? context.destination;
    if (context.audioWorklet && this.deps.createWorkletNode) {
      const url = this.deps.createBlobUrl(AUDIO_WORKLET_SOURCE);
      this.blobUrl = url;
      try {
        await context.audioWorklet.addModule(url);
        const node = this.deps.createWorkletNode(context, AUDIO_WORKLET_NAME);
        this.workletNode = node;
        node.port.onmessage = (event) => this.pushBlock(event.data);
        node.connect(sink);
        this.source?.connect(node);
        return;
      } catch (error) {
        // Worklet 加载失败（旧内核 / CSP）：退回 ScriptProcessor，不整体失败。
        this.deps.revokeBlobUrl(url);
        this.blobUrl = null;
        void error;
      }
    }
    if (!context.createScriptProcessor) {
      throw new Error("no-audio-frame-source");
    }
    const node = context.createScriptProcessor(2048, 1, 1);
    this.scriptNode = node;
    node.onaudioprocess = (event) => this.pushBlock(event.inputBuffer.getChannelData(0));
    node.connect(sink);
    this.source?.connect(node);
  }

  /** 任意采样率的块 → 20ms 帧（重采样在 FrameAssembler 内完成）。 */
  private pushBlock(block: Float32Array): void {
    const atMs = this.deps.now();
    for (const frame of this.assembler.push(block)) {
      this.options.onFrame(frame, atMs);
    }
  }

  /** 释放全部资源（幂等）。 */
  stop(): void {
    this.started = false;
    if (this.workletNode) this.workletNode.port.onmessage = null;
    try {
      this.workletNode?.disconnect();
    } catch {
      // 已断开
    }
    try {
      this.scriptNode?.disconnect();
    } catch {
      // 已断开
    }
    try {
      this.source?.disconnect();
    } catch {
      // 已断开
    }
    try {
      this.gainNode?.disconnect();
    } catch {
      // 已断开
    }
    for (const track of this.stream?.getTracks() ?? []) track.stop();
    this.stream = null;
    void this.context?.close?.();
    this.context = null;
    this.workletNode = null;
    this.scriptNode = null;
    this.gainNode = null;
    this.source = null;
    if (this.blobUrl) this.deps.revokeBlobUrl(this.blobUrl);
    this.blobUrl = null;
    this.assembler.reset();
  }
}
