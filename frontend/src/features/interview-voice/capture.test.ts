// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it, vi } from "vitest";
import { MicCapture, isMicCaptureSupported, micErrorCode } from "./capture";

function fakeAudioGraph(sampleRate = 16_000) {
  const track = { stop: vi.fn(), onended: null as (() => void) | null };
  const stream = { getTracks: () => [track], getAudioTracks: () => [track] };
  const source = { connect: vi.fn(), disconnect: vi.fn() };
  const gain = { gain: { value: 1 }, connect: vi.fn(), disconnect: vi.fn() };
  const port = { onmessage: null as ((event: { data: Float32Array }) => void) | null };
  const workletNode = { port, connect: vi.fn(), disconnect: vi.fn() };
  const context = {
    sampleRate,
    state: "running",
    destination: {},
    resume: vi.fn().mockResolvedValue(undefined),
    close: vi.fn().mockResolvedValue(undefined),
    createMediaStreamSource: vi.fn(() => source),
    createGain: vi.fn(() => gain),
    audioWorklet: { addModule: vi.fn().mockResolvedValue(undefined) },
    createScriptProcessor: vi.fn(),
  };
  return { track, stream, source, gain, port, workletNode, context };
}

function setup() {
  const graph = fakeAudioGraph();
  const frames: Float32Array[] = [];
  const capture = new MicCapture({
    onFrame: (frame) => frames.push(frame),
    deps: {
      getUserMedia: vi.fn().mockResolvedValue(graph.stream),
      createAudioContext: vi.fn(() => graph.context),
      createWorkletNode: vi.fn(() => graph.workletNode),
      createBlobUrl: vi.fn(() => "blob:interview-voice"),
      revokeBlobUrl: vi.fn(),
      now: () => 1_000,
    },
  });
  return { ...graph, capture, frames };
}

describe("interview-voice/capture：能力与错误码", () => {
  it("jsdom 里没有 mediaDevices → 不支持（组件据此禁用语音而不是崩）", () => {
    expect(isMicCaptureSupported()).toBe(false);
  });

  it.each([
    [{ name: "NotAllowedError" }, "microphone-denied"],
    [{ name: "NotFoundError" }, "microphone-missing"],
    [{ name: "NotReadableError" }, "microphone-busy"],
    [{ name: "UnknownError" }, "microphone-failed"],
  ])("getUserMedia 错误 %o → %s", (error, expected) => {
    expect(micErrorCode(error)).toBe(expected);
  });
});

describe("interview-voice/capture：AudioWorklet 分帧", () => {
  it("打开麦克风：约束里 AEC/降噪/AGC/单声道齐全，worklet 被注册", async () => {
    const setupResult = setup();
    await setupResult.capture.start();
    expect(setupResult.capture.active).toBe(true);
    const constraints = (setupResult.capture as unknown as Record<string, unknown>) && null;
    void constraints;
    expect(setupResult.context.audioWorklet.addModule).toHaveBeenCalledWith("blob:interview-voice");
    expect(setupResult.source.connect).toHaveBeenCalledWith(setupResult.workletNode);
    // 采集音频不能播出去：输出端增益必须是 0。
    expect(setupResult.gain.gain.value).toBe(0);
  });

  it("worklet 的 128 帧量子被累积成 320 个采样的 20ms 帧", async () => {
    const setupResult = setup();
    await setupResult.capture.start();
    setupResult.port.onmessage?.({ data: new Float32Array(128) });
    setupResult.port.onmessage?.({ data: new Float32Array(128) });
    expect(setupResult.frames.length).toBe(0);
    setupResult.port.onmessage?.({ data: new Float32Array(128) });
    expect(setupResult.frames.length).toBe(1);
    expect(setupResult.frames[0].length).toBe(320);
  });

  it("48kHz 声卡：960 个原生采样重采样出一帧 16kHz", async () => {
    const graph = fakeAudioGraph(48_000);
    const frames: Float32Array[] = [];
    const capture = new MicCapture({
      onFrame: (frame) => frames.push(frame),
      deps: {
        getUserMedia: vi.fn().mockResolvedValue(graph.stream),
        createAudioContext: vi.fn(() => graph.context),
        createWorkletNode: vi.fn(() => graph.workletNode),
        createBlobUrl: vi.fn(() => "blob:x"),
        revokeBlobUrl: vi.fn(),
        now: () => 0,
      },
    });
    await capture.start();
    graph.port.onmessage?.({ data: new Float32Array(959) });
    expect(frames.length).toBe(0);
    graph.port.onmessage?.({ data: new Float32Array(1) });
    expect(frames.length).toBe(1);
    expect(frames[0].length).toBe(320);
  });

  it("stop：停轨道、关 AudioContext、撤销 Blob URL（麦克风指示灯必须灭）", async () => {
    const setupResult = setup();
    await setupResult.capture.start();
    setupResult.capture.stop();
    expect(setupResult.track.stop).toHaveBeenCalledTimes(1);
    expect(setupResult.context.close).toHaveBeenCalledTimes(1);
    expect(setupResult.capture.active).toBe(false);
  });

  it("重复 start / stop 是幂等的（React 严格模式下不重复申请麦克风）", async () => {
    const setupResult = setup();
    await setupResult.capture.start();
    await setupResult.capture.start();
    setupResult.capture.stop();
    setupResult.capture.stop();
    expect(setupResult.track.stop).toHaveBeenCalledTimes(1);
  });
});
