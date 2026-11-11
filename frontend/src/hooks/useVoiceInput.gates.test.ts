// SPDX-License-Identifier: Apache-2.0
/**
 * 需求 #8 的回归用例：**起始态、并发守卫、三道闸门、语气词兜底**。
 *
 * 为什么单独成文件而不是塞进 `useVoiceInput.test.ts`：那个文件已经 390 行，而
 * `test_file_size_budget.py` 把测试文件也算进 500 行预算（拆文件是唯一不降标准的做法）。
 * 这里复用同一套思路——`MediaRecorder` / `getUserMedia` / `AudioContext` 都是替身，
 * 但 hook 内部对时间、峰值、Blob、FormData 的处理是真实代码路径。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const apiMocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, request: apiMocks.request };
});

import { installFakeAudioContext, type FakeAudioContextHandle } from "../test/fakeAudioContext";
import { t } from "../i18n";
import { useVoiceInput } from "./useVoiceInput";
import { formatPeakPercent, isFillerOnly } from "./voiceGates";

const TRACK_STOP = vi.fn();

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn((type: string) => type !== "audio/mp4");

  state: "inactive" | "recording" = "inactive";
  mimeType: string;
  ondataavailable: ((event: { data: Blob }) => void) | null = null;
  onstop: (() => void) | null = null;
  onerror: (() => void) | null = null;

  constructor(_stream: MediaStream, options?: { mimeType?: string }) {
    this.mimeType = options?.mimeType ?? "audio/webm";
    FakeMediaRecorder.instances.push(this);
  }

  start(): void {
    this.state = "recording";
  }

  stop(): void {
    this.state = "inactive";
    this.onstop?.();
  }

  emitData(size = 12): void {
    this.ondataavailable?.({ data: new Blob([new Uint8Array(size)], { type: this.mimeType }) });
  }
}

const getUserMedia = vi.fn();
let audio: FakeAudioContextHandle;

function fakeStream() {
  return { getTracks: () => [{ stop: TRACK_STOP }] } as unknown as MediaStream;
}

/** 让 `begin()` 里的 await 链跑完（getUserMedia 是微任务，不涉及计时器）。 */
async function flushStart() {
  await act(async () => {
    for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
  });
}

/** 停止并跑完 `stop() → 闸门 →（可能）上传` 的微任务链。 */
async function flushStop() {
  await act(async () => {
    for (let tick = 0; tick < 6; tick += 1) await Promise.resolve();
  });
}

function statusOk(text = "转写出来的文字") {
  apiMocks.request.mockImplementation((path: string) => {
    if (path === "/transcribe/status") {
      return Promise.resolve({ configured: true, provider_host: "asr.example.com" });
    }
    return Promise.resolve({ text, provider_host: "asr.example.com" });
  });
}

function transcribeCalls() {
  return apiMocks.request.mock.calls.filter(([path]) => path === "/transcribe");
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  TRACK_STOP.mockClear();
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue(fakeStream());
  apiMocks.request.mockReset();
  window.localStorage.clear();
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
  audio = installFakeAudioContext();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 起录 + 推进时长 + 产生一段数据，返回那个 recorder。 */
async function recordFor(result: { current: ReturnType<typeof useVoiceInput> }, ms: number) {
  act(() => {
    result.current.start();
  });
  await flushStart();
  const recorder = FakeMediaRecorder.instances[0];
  act(() => {
    recorder.emitData(32);
    vi.advanceTimersByTime(ms);
  });
  return recorder;
}

describe("起始态与并发守卫（#8.0）", () => {
  it("连点两次 start() 只申请一次麦克风、只创建一个 recorder", async () => {
    statusOk();
    const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    await act(async () => {
      // 同一 tick 里的两次点击：`statusRef` 要等渲染，只有 startingRef 挡得住。
      result.current.start();
      result.current.start();
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    });

    expect(getUserMedia).toHaveBeenCalledTimes(1);
    expect(FakeMediaRecorder.instances).toHaveLength(1);
    expect(result.current.status).toBe("recording");
  });

  it("申请麦克风期间是 starting——按钮据此 disabled，用户不会去点第二下", async () => {
    statusOk();
    let release: (stream: MediaStream) => void = () => undefined;
    getUserMedia.mockReturnValue(
      new Promise<MediaStream>((resolve) => {
        release = resolve;
      }),
    );
    const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    act(() => {
      result.current.start();
    });
    expect(result.current.status).toBe("starting");

    await act(async () => {
      release(fakeStream());
      for (let tick = 0; tick < 5; tick += 1) await Promise.resolve();
    });
    expect(result.current.status).toBe("recording");
  });

  it("起录 200ms 内点结束被忽略：仍在录音，recorder 也没被打断", async () => {
    statusOk();
    const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    vi.useFakeTimers();
    const recorder = await recordFor(result, 200);
    act(() => {
      result.current.stop();
    });
    await flushStop();

    expect(result.current.status).toBe("recording");
    expect(recorder.state).toBe("recording");
    expect(transcribeCalls()).toHaveLength(0);
    expect(result.current.error).toBeNull();
  });

  it("卸载时关掉 AudioContext（Chrome 每页上限约 6 个，泄漏会让下次静音）", async () => {
    statusOk();
    const { result, unmount } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    act(() => {
      result.current.start();
    });
    await flushStart();
    expect(audio.createdCount()).toBe(1);

    unmount();
    expect(audio.closedCount()).toBe(1);
    expect(TRACK_STOP).toHaveBeenCalled();
  });
});

describe("三道闸门（#8.1）", () => {
  it("全程静音：不上传，报 no_sound 且带实测峰值", async () => {
    statusOk();
    audio.setAmplitude(0);
    const onTranscribed = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscribed }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    vi.useFakeTimers();
    await recordFor(result, 900);
    act(() => {
      result.current.stop();
    });
    await flushStop();

    expect(transcribeCalls()).toHaveLength(0);
    expect(result.current.error?.code).toBe("no_sound");
    // 文案里必须有实测峰值：用户据此判断是设备问题还是自己没说话。
    expect(result.current.error?.message).toContain("<0.1%");
    expect(onTranscribed).not.toHaveBeenCalled();
    expect(result.current.status).toBe("idle");
  });

  it("450ms 就结束：too_short，不上传", async () => {
    statusOk();
    const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    // 450ms 而不是 300ms：< 400ms 的 stop 先被"连点保护"吞掉（见上一条用例），
    // 所以 `too_short` 的**可观测**区间是 [400ms, 500ms)。两道闸门各管一段。
    vi.useFakeTimers();
    await recordFor(result, 450);
    act(() => {
      result.current.stop();
    });
    await flushStop();

    expect(transcribeCalls()).toHaveLength(0);
    expect(result.current.error?.code).toBe("too_short");
    expect(result.current.status).toBe("idle");
  });

  it("正常时长 + 有电平：照常上传（闸门没有把正常路径也挡掉）", async () => {
    statusOk();
    const onTranscribed = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscribed }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    vi.useFakeTimers();
    await recordFor(result, 1200);
    act(() => {
      result.current.stop();
    });
    await flushStop();

    expect(transcribeCalls()).toHaveLength(1);
    expect(onTranscribed).toHaveBeenCalledWith("转写出来的文字");
  });
});

describe("语气词兜底（#8.4）", () => {
  it("只识别出「嗯。」且录音 800ms：不插入，报 no_heard", async () => {
    statusOk("嗯。");
    const onTranscribed = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscribed }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    vi.useFakeTimers();
    await recordFor(result, 800);
    act(() => {
      result.current.stop();
    });
    await flushStop();

    // 音频是传了（链路正常），只是结果不插入。
    expect(transcribeCalls()).toHaveLength(1);
    expect(onTranscribed).not.toHaveBeenCalled();
    expect(result.current.error?.code).toBe("no_heard");
  });

  it("只识别出「嗯。」但录音 2000ms：插入原文（不误伤真实的单字回答）", async () => {
    statusOk("嗯。");
    const onTranscribed = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ onTranscribed }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    vi.useFakeTimers();
    await recordFor(result, 2000);
    act(() => {
      result.current.stop();
    });
    await flushStop();

    expect(onTranscribed).toHaveBeenCalledWith("嗯。");
    expect(result.current.error).toBeNull();
  });
});

describe("设备回退（#8.2）", () => {
  it("选中的设备不在了：回退系统默认 + 清存储 + 提示一次，录音照常开始", async () => {
    statusOk();
    window.localStorage.setItem("resumeforge.voice.device_id", "gone-device");
    const constraintError = new DOMException("no such device", "OverconstrainedError");
    getUserMedia.mockRejectedValueOnce(constraintError).mockResolvedValue(fakeStream());

    const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    act(() => {
      result.current.start();
    });
    await flushStart();

    // 第一次带 exact deviceId 失败 → 第二次走系统默认。
    expect(getUserMedia).toHaveBeenCalledTimes(2);
    expect(getUserMedia.mock.calls[0]?.[0]).toEqual({
      audio: { deviceId: { exact: "gone-device" } },
    });
    expect(getUserMedia.mock.calls[1]?.[0]).toEqual({ audio: true });
    expect(result.current.status).toBe("recording");
    expect(result.current.notice).toBe(t("voiceInput.settings.device.lost"));
    // 存储被清掉：下次直接从系统默认开始，不会每次都撞一次 OverconstrainedError。
    expect(window.localStorage.getItem("resumeforge.voice.device_id")).toBeNull();
  });
});

describe("voiceGates 纯函数", () => {
  it("isFillerOnly 只认语气词（去标点、英文大小写不敏感）", () => {
    expect(isFillerOnly("嗯。")).toBe(true);
    expect(isFillerOnly("嗯嗯")).toBe(true);
    expect(isFillerOnly("嗯 啊")).toBe(true);
    expect(isFillerOnly("Uh, um.")).toBe(true);
    expect(isFillerOnly("hmm")).toBe(true);
    // 真实内容不能被吞
    expect(isFillerOnly("嗯，好的")).toBe(false);
    expect(isFillerOnly("你好")).toBe(false);
    expect(isFillerOnly("")).toBe(false);
  });

  it("formatPeakPercent 把峰值换成可读百分比", () => {
    expect(formatPeakPercent(0.004)).toBe("0.4%");
    expect(formatPeakPercent(0.5)).toBe("50.0%");
    expect(formatPeakPercent(0)).toBe("<0.1%");
  });
});
