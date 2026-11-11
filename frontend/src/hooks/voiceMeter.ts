// SPDX-License-Identifier: Apache-2.0
/**
 * 时域电平表：`LevelMeter.read()` 取当前帧的最大振幅（0..1），并累计本次会话峰值。
 *
 * 单独成文件的理由：两个调用方的**共同点只有电平**。录音链路（`voiceRecorder`）要
 * MediaRecorder + 峰值采样；「测试麦克风」弹层（`useMicMeter`）只要电平，**不该**顺带
 * 引入录音与上传语义（测试不该消耗上游额度）。放在一起时，弹层就得 import 一个带
 * MediaRecorder 的模块。
 *
 * ## AudioContext 的释放纪律
 *
 * Chrome 每页最多约 6 个 AudioContext，超了以后 `new AudioContext()` 会**静默**返回
 * 一个 suspended 实例——现象是"第 7 次录音没有电平、永远判静音"，极难定位。所以
 * `dispose()` 必须与"停轨道"走同一条路径，由调用方保证（`voiceRecorder.cleanup()` 与
 * `useMicMeter.release()` 各一处，都是唯一出口）。
 */

type AudioContextCtor = new () => AudioContext;

/** Safari 只暴露 `webkitAudioContext`；两者都没有时返回 null（拿不到电平）。 */
function audioContextCtor(): AudioContextCtor | null {
  if (typeof AudioContext !== "undefined") return AudioContext;
  const legacy = (globalThis as { webkitAudioContext?: AudioContextCtor }).webkitAudioContext;
  return legacy ?? null;
}

/** 时域电平表。`create()` 返回 `null` 表示这台环境没有可用的 WebAudio。 */
export class LevelMeter {
  static create(stream: MediaStream): LevelMeter | null {
    const ctor = audioContextCtor();
    if (!ctor) return null;
    try {
      const context = new ctor();
      const source = context.createMediaStreamSource(stream);
      const analyser = context.createAnalyser();
      analyser.fftSize = 1024;
      source.connect(analyser);
      // 部分浏览器把新建的 context 放在 suspended，不恢复就永远读到 0。
      const resumed = context.resume?.();
      if (resumed && typeof resumed.catch === "function") {
        resumed.catch(() => undefined);
      }
      return new LevelMeter(context, source, analyser);
    } catch {
      // 没有 WebAudio（或被策略禁用）：退化成"没有电平"，录音本身仍然可用。
      return null;
    }
  }

  private readonly context: AudioContext;
  private readonly source: MediaStreamAudioSourceNode;
  private readonly analyser: AnalyserNode;
  private readonly buffer: Float32Array<ArrayBuffer>;
  private sessionPeak = 0;
  private disposed = false;

  private constructor(
    context: AudioContext,
    source: MediaStreamAudioSourceNode,
    analyser: AnalyserNode,
  ) {
    this.context = context;
    this.source = source;
    this.analyser = analyser;
    this.buffer = new Float32Array(analyser.fftSize > 0 ? analyser.fftSize : 1024);
  }

  /** 当前帧峰值（0..1），同时抬高会话峰值。返回 0 表示这一帧没有声音。 */
  read(): number {
    if (this.disposed) return 0;
    const analyser = this.analyser;
    if (typeof analyser.getFloatTimeDomainData !== "function") return 0;
    analyser.getFloatTimeDomainData(this.buffer);
    let current = 0;
    for (let index = 0; index < this.buffer.length; index += 1) {
      const value = Math.abs(this.buffer[index]);
      if (value > current) current = value;
    }
    if (current > this.sessionPeak) this.sessionPeak = current;
    return current;
  }

  /** 本次会话的历史峰值（0..1）。 */
  get peak(): number {
    return this.sessionPeak;
  }

  dispose(): void {
    if (this.disposed) return;
    this.disposed = true;
    try {
      this.source.disconnect();
    } catch {
      // 已经断开/从未连上：无需处理。
    }
    try {
      this.analyser.disconnect();
    } catch {
      // 同上。
    }
    try {
      const closing = this.context.close();
      if (closing && typeof closing.catch === "function") closing.catch(() => undefined);
    } catch {
      // 某些环境（含测试替身）没有 close()：忽略。
    }
  }
}
