// SPDX-License-Identifier: Apache-2.0
/**
 * 录音层：`getUserMedia` + `MediaRecorder` + 电平采样，**只做"拿到一段音频与其峰值"**。
 * 状态机、上传、错误文案都在 `useVoiceInput` 里，这一层不 import React。
 *
 * 拆出来的原因是预算：`useVoiceInput.ts` 原本 450/500 行，而需求 #8 要往里面加
 * starting 态、并发守卫、三道闸门、设备回退。把所有 DOM 细节搬到这里之后，hook 只剩
 * 状态机，两个文件都有余量。
 *
 * ## 三条必须守住的清理纪律
 *
 * 1. `AudioContext` 与 `AnalyserNode` 必须在 `stopTracks()` **同一条路径**上释放
 *    （电平表本体在 `voiceMeter.ts`）。Chrome 每个页面最多约 6 个 AudioContext，超了
 *    以后 `new AudioContext()` 会**静默**返回一个 suspended 的实例——现象是"第 7 次
 *    录音开始没有电平、永远判静音"，极难定位。所以 `cleanup()` 是唯一出口，
 *    `settle()`/`dispose()` 都只走它。
 * 2. `MediaRecorder.stop()` 的最后一帧 `dataavailable` 在 `onstop` **之前**到达，
 *    所以 chunks 只在 `ondataavailable` 里累积，`settle()` 之后才结算快照。
 * 3. 卸载时不能等 Promise：`dispose()` 是同步的，先把轨道停掉（麦克风指示灯灭），
 *    再把已经在等 `stop()` 的调用方结算成 `discarded`，避免"卸载后还发一次上传"。
 */

import { PEAK_SAMPLE_INTERVAL_MS } from "./voiceGates";
import { LevelMeter } from "./voiceMeter";

/** 依次尝试的编码：Chrome/Edge 用 webm+opus，Safari 只支持 mp4。 */
const MIME_CANDIDATES = ["audio/webm;codecs=opus", "audio/webm", "audio/mp4"];

/** 一次录音的产物。`peak === null` 表示这台环境拿不到电平（不是"静音"）。 */
export interface RecordedClip {
  chunks: Blob[];
  mimeType: string;
  durationMs: number;
  peak: number | null;
  /** 被 cancel/卸载丢弃：调用方不得上传。 */
  discarded: boolean;
}

export interface VoiceRecorderOptions {
  /** 上次选中的设备 id；`null` = 系统默认。 */
  deviceId?: string | null;
  /** MediaRecorder 自身报错（不是 getUserMedia 失败）。 */
  onError?: () => void;
}

export interface OpenRecording {
  recorder: VoiceRecorder;
  /** 指定设备已不存在，已回退系统默认；调用方应清掉存储并提示一次。 */
  deviceLost: boolean;
}

/** 环境缺少录音能力（被 `isSupported()` 挡在前面，这里只是兜底）。 */
class UnsupportedMediaError extends Error {}

export function pickMimeType(ctor: typeof MediaRecorder): string {
  if (typeof ctor.isTypeSupported !== "function") return "";
  return MIME_CANDIDATES.find((type) => ctor.isTypeSupported(type)) ?? "";
}

export function fileNameFor(mimeType: string): string {
  if (mimeType.includes("mp4")) return "voice.mp4";
  if (mimeType.includes("ogg")) return "voice.ogg";
  if (mimeType.includes("wav")) return "voice.wav";
  return "voice.webm";
}

/** 设备被拔掉/换了端口时浏览器给的名字；两种都要回退，不能只认一个。 */
function isDeviceUnavailable(error: unknown): boolean {
  const name =
    error && typeof error === "object" && "name" in error
      ? String((error as { name?: unknown }).name ?? "")
      : "";
  return name === "OverconstrainedError" || name === "NotFoundError";
}

/**
 * 一段正在进行的录音。`open()` 返回时**已经在录**（`recorder.start()` 成功之后才构造
 * 实例），所以 hook 拿到它就可以直接转 `recording`——这正是 #8 要的"按钮状态与真实
 * 录音状态一致"。
 */
export class VoiceRecorder {
  /** 媒体能力探测：`useVoiceInput` 用它决定是不是直接报 `unsupported`。 */
  static isSupported(): boolean {
    if (typeof MediaRecorder === "undefined") return false;
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    return typeof media?.getUserMedia === "function";
  }

  static async open({
    deviceId = null,
    onError,
  }: VoiceRecorderOptions = {}): Promise<OpenRecording> {
    const media = typeof navigator === "undefined" ? undefined : navigator.mediaDevices;
    const ctor = typeof MediaRecorder === "undefined" ? null : MediaRecorder;
    if (!ctor || !media?.getUserMedia) throw new UnsupportedMediaError();
    let stream: MediaStream | null = null;
    let deviceLost = false;
    if (deviceId) {
      try {
        stream = await media.getUserMedia({ audio: { deviceId: { exact: deviceId } } });
      } catch (error) {
        // 设备不在了：回退默认设备，让录音继续——录到声音比"记住选择"重要。
        if (!isDeviceUnavailable(error)) throw error;
        deviceLost = true;
      }
    }
    if (!stream) stream = await media.getUserMedia({ audio: true });
    return { recorder: VoiceRecorder.begin(ctor, stream, onError), deviceLost };
  }

  private static begin(
    ctor: typeof MediaRecorder,
    stream: MediaStream,
    onError?: () => void,
  ): VoiceRecorder {
    const picked = pickMimeType(ctor);
    let recorder: MediaRecorder;
    try {
      recorder = picked ? new ctor(stream, { mimeType: picked }) : new ctor(stream);
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    try {
      recorder.start();
    } catch (error) {
      stream.getTracks().forEach((track) => track.stop());
      throw error;
    }
    return new VoiceRecorder(recorder, stream, picked || recorder.mimeType, onError);
  }

  private readonly mediaRecorder: MediaRecorder;
  private readonly stream: MediaStream;
  private readonly onError: (() => void) | undefined;
  private readonly startedAt: number;
  private readonly chunks: Blob[] = [];
  private meter: LevelMeter | null;
  private samplerId: number | null = null;
  private resolveStop: ((clip: RecordedClip) => void) | null = null;
  private stopPromise: Promise<RecordedClip> | null = null;
  private durationAtStop = 0;
  private discarded = false;
  private cleanedUp = false;
  /** 实际使用的编码，用于 FormData 的文件名与后缀。 */
  readonly mimeType: string;

  private constructor(
    mediaRecorder: MediaRecorder,
    stream: MediaStream,
    mimeType: string,
    onError?: () => void,
  ) {
    this.mediaRecorder = mediaRecorder;
    this.stream = stream;
    this.mimeType = mimeType || "audio/webm";
    this.onError = onError;
    this.startedAt = Date.now();
    mediaRecorder.ondataavailable = (event: BlobEvent) => {
      if (event.data && event.data.size > 0) this.chunks.push(event.data);
    };
    mediaRecorder.onstop = () => this.settle();
    mediaRecorder.onerror = () => this.onError?.();
    this.meter = LevelMeter.create(stream);
    // 立刻取一次：短录音（<100ms）也必须有峰值，否则会被误判成"没检测到声音"。
    this.meter?.read();
    this.samplerId = window.setInterval(() => {
      this.meter?.read();
    }, PEAK_SAMPLE_INTERVAL_MS);
  }

  /** 已录时长（毫秒）。 */
  durationMs(): number {
    return Math.max(0, Date.now() - this.startedAt);
  }

  /** 全程峰值；`null` = 这台环境没有 WebAudio，判不了静音。 */
  peak(): number | null {
    return this.meter ? this.meter.peak : null;
  }

  /**
   * 停止并结算。重复调用返回同一个 Promise（`stop()` 幂等）。
   *
   * `discarded` 传 true 表示"停下但不要这段音频"（cancel / 卸载）。
   */
  stop(discarded = false): Promise<RecordedClip> {
    if (discarded) this.discarded = true;
    if (this.stopPromise) return this.stopPromise;
    this.durationAtStop = this.durationMs();
    // 停止前补采一帧：最后 100ms 的声音不该被采样间隔漏掉。
    this.meter?.read();
    this.stopPromise = new Promise<RecordedClip>((resolve) => {
      this.resolveStop = resolve;
    });
    try {
      this.mediaRecorder.stop();
    } catch {
      // 已经是 inactive（例如卸载时已经停过一次）：直接结算，别让调用方永远等下去。
      this.settle();
    }
    return this.stopPromise;
  }

  /** 丢弃这段录音（不等结果）。 */
  discard(): void {
    void this.stop(true);
  }

  /** 同步彻底清理：卸载路径专用，不等 Promise。 */
  dispose(): void {
    this.discarded = true;
    try {
      if (this.mediaRecorder.state !== "inactive") this.mediaRecorder.stop();
    } catch {
      // 已经停止/从未开始：下面的 cleanup 才是关键。
    }
    this.settle();
  }

  private settle(): void {
    const resolve = this.resolveStop;
    this.resolveStop = null;
    const clip: RecordedClip = {
      chunks: [...this.chunks],
      mimeType: this.mimeType,
      durationMs: this.durationAtStop > 0 ? this.durationAtStop : this.durationMs(),
      peak: this.peak(),
      discarded: this.discarded,
    };
    this.cleanup();
    resolve?.(clip);
  }

  private cleanup(): void {
    if (this.cleanedUp) return;
    this.cleanedUp = true;
    if (this.samplerId !== null) {
      window.clearInterval(this.samplerId);
      this.samplerId = null;
    }
    this.meter?.dispose();
    this.meter = null;
    this.stream.getTracks().forEach((track) => track.stop());
  }
}
