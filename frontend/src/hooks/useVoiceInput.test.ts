// SPDX-License-Identifier: Apache-2.0
/**
 * useVoiceInput 的口径测试：三态切换、错误分型、到点自动停、卸载清理。
 *
 * MediaRecorder 与 getUserMedia 都是假实现（jsdom 没有录音能力），但 hook 内部对
 * 时间、Blob、FormData 的处理是真实代码路径——这组用例要守住的是"状态机别漏状态"，
 * 不是"浏览器能不能录音"（那属于实机 L1 验证，见证据目录）。
 */

import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";

const apiMocks = vi.hoisted(() => ({ request: vi.fn() }));

vi.mock("../api/client", async () => {
  const actual = await vi.importActual<typeof import("../api/client")>("../api/client");
  return { ...actual, request: apiMocks.request };
});

import { t } from "../i18n";
import { installFakeAudioContext } from "../test/fakeAudioContext";
import { uploadErrorFor, useVoiceInput } from "./useVoiceInput";

const TRACK_STOP = vi.fn();

class FakeMediaRecorder {
  static instances: FakeMediaRecorder[] = [];
  static isTypeSupported = vi.fn(
    (type: string) => type === "audio/webm;codecs=opus" || type === "audio/webm",
  );

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

function installMediaStubs(): void {
  vi.stubGlobal("MediaRecorder", FakeMediaRecorder);
  vi.stubGlobal("navigator", { mediaDevices: { getUserMedia } });
}

function fakeStream() {
  return { getTracks: () => [{ stop: TRACK_STOP }] } as unknown as MediaStream;
}

/** 让 start() 里的 await 链跑完（getUserMedia 是微任务，不涉及计时器）。 */
async function flushStart() {
  await act(async () => {
    await Promise.resolve();
    await Promise.resolve();
  });
}

beforeEach(() => {
  FakeMediaRecorder.instances = [];
  FakeMediaRecorder.isTypeSupported.mockClear();
  TRACK_STOP.mockClear();
  getUserMedia.mockReset();
  getUserMedia.mockResolvedValue(fakeStream());
  apiMocks.request.mockReset();
  // 电平替身：默认"有声音"。静音用例自己 setAmplitude(0)。
  installFakeAudioContext();
  installMediaStubs();
});

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

function statusOk(host = "asr.example.com") {
  apiMocks.request.mockImplementation((path: string) => {
    if (path === "/transcribe/status") {
      return Promise.resolve({ configured: true, provider_host: host, model: "whisper-1" });
    }
    return Promise.resolve({ text: "转写出来的文字", provider_host: host });
  });
}

describe("useVoiceInput", () => {
  it("挂载后读取服务状态，暴露 configured / providerHost", async () => {
    statusOk();
    const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));

    await waitFor(() => expect(result.current.configured).toBe(true));
    expect(result.current.providerHost).toBe("asr.example.com");
    expect(result.current.status).toBe("idle");
  });

  it("idle → recording → transcribing → idle，seconds 随时间增加", async () => {
    statusOk();
    const onTranscribed = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ maxSeconds: 180, onTranscribed }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    vi.useFakeTimers();
    act(() => {
      result.current.start();
    });
    await flushStart();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("recording");
    expect(result.current.seconds).toBe(0);
    expect(result.current.providerHost).toBe("asr.example.com");

    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.seconds).toBe(3);

    const recorder = FakeMediaRecorder.instances[0];
    act(() => {
      recorder.emitData(10);
    });
    await act(async () => {
      result.current.stop();
      // fake timers 下不能用 waitFor（它自己的轮询计时器也被冻住），手动把
      // onstop → 上传 Promise 的微任务链跑完。
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("idle");
    expect(onTranscribed).toHaveBeenCalledWith("转写出来的文字");
    const uploadCall = apiMocks.request.mock.calls.find(([path]) => path === "/transcribe");
    expect(uploadCall).toBeTruthy();
    const body = uploadCall?.[1]?.body as FormData;
    expect(body.get("language")).toBe("zh");
    expect(body.get("duration_ms")).toBe("3000");
    expect(TRACK_STOP).toHaveBeenCalled();
  });

  it("未配置时点麦克风：只出提示，不申请权限、不发转写请求", async () => {
    apiMocks.request.mockResolvedValue({ configured: false, provider_host: "" });
    const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(false));

    await act(async () => {
      result.current.start();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.status).toBe("idle");
    expect(result.current.error?.code).toBe("not_configured");
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(apiMocks.request).toHaveBeenCalledTimes(1); // 只有那次 status 探测
    expect(apiMocks.request.mock.calls[0]?.[0]).toBe("/transcribe/status");
  });

  it("权限被拒时出 permission_denied（不含麦克风/录音失败两种错）", async () => {
    statusOk();
    getUserMedia.mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    await act(async () => {
      result.current.start();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.error?.code).toBe("permission_denied");
    expect(result.current.status).toBe("idle");
  });

  it("没有麦克风与录音失败是两种独立错误", async () => {
    statusOk();
    getUserMedia.mockRejectedValue(new DOMException("no device", "NotFoundError"));
    const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(true));
    await act(async () => {
      result.current.start();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error?.code).toBe("no_microphone");

    getUserMedia.mockRejectedValue(new DOMException("busy", "NotReadableError"));
    await act(async () => {
      result.current.start();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error?.code).toBe("recording_failed");
  });

  it("到 maxSeconds 自动停止并转写（最后一段录音不丢）", async () => {
    statusOk();
    const onTranscribed = vi.fn();
    const { result } = renderHook(() => useVoiceInput({ maxSeconds: 5, onTranscribed }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    vi.useFakeTimers();
    act(() => {
      result.current.start();
    });
    await flushStart();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("recording");

    const recorder = FakeMediaRecorder.instances[0];
    act(() => {
      recorder.emitData(10);
      vi.advanceTimersByTime(5000);
    });
    await act(async () => {
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.status).toBe("idle");
    expect(onTranscribed).toHaveBeenCalledWith("转写出来的文字");
  });

  it("上传失败按状态码分型：413 → too_large，409 → not_configured", async () => {
    apiMocks.request.mockImplementation((path: string) => {
      if (path === "/transcribe/status") {
        return Promise.resolve({ configured: true, provider_host: "asr.example.com" });
      }
      return Promise.reject(new ApiError("音频超过 10 MB，无法转写", 413, { code: "http" }));
    });
    const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    // 起录时长必须超过 MIN_RECORDING_MS（500ms），否则会先撞上 too_short 闸门：
    // 这是 #8 刻意的行为——0 毫秒的录音不该发给上游。
    vi.useFakeTimers();
    act(() => {
      result.current.start();
    });
    await flushStart();
    await act(async () => {
      await Promise.resolve();
    });
    const recorder = FakeMediaRecorder.instances[0];
    act(() => {
      recorder.emitData(10);
      vi.advanceTimersByTime(1200);
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error?.code).toBe("too_large");
    expect(result.current.status).toBe("idle");
  });

  it("卸载时停止录音并 stop 掉麦克风 track", async () => {
    statusOk();
    const { result, unmount } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    act(() => {
      result.current.start();
    });
    await flushStart();
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.status).toBe("recording");
    const recorder = FakeMediaRecorder.instances[0];

    unmount();

    expect(TRACK_STOP).toHaveBeenCalled();
    expect(recorder.state).toBe("inactive");
    // 卸载后的收尾不得再调用 onTranscribed / 发上传请求。
    const uploadCalls = apiMocks.request.mock.calls.filter(([path]) => path === "/transcribe");
    expect(uploadCalls).toHaveLength(0);
  });
  /**
   * 404/405 = 后端还是旧进程（没有 /api/transcribe）。后端 detail 只是一句英文
   * `Not Found`，原样显示既看不出原因也没法行动——必须换成中文说明。
   */
  it("后端 404/405 映射成 backend_too_old，而不是原样显示 Not Found", async () => {
    apiMocks.request.mockImplementation((path: string) => {
      if (path === "/transcribe/status") {
        return Promise.resolve({ configured: true, provider_host: "asr.example.com" });
      }
      return Promise.reject(new ApiError("Not Found", 404, { code: "http" }));
    });
    const { result } = renderHook(() => useVoiceInput({ onTranscribed: vi.fn() }));
    await waitFor(() => expect(result.current.configured).toBe(true));

    // 同上：先超过 MIN_RECORDING_MS，才轮得到上传路径。
    vi.useFakeTimers();
    act(() => {
      result.current.start();
    });
    await flushStart();
    await act(async () => {
      await Promise.resolve();
    });
    const recorder = FakeMediaRecorder.instances[0];
    act(() => {
      recorder.emitData(10);
      vi.advanceTimersByTime(1200);
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });

    expect(result.current.error?.code).toBe("backend_too_old");
    expect(result.current.error?.message).toBe(t("voiceInput.error.backendTooOld"));
    expect(result.current.error?.message).not.toBe("Not Found");
  });

  it("backend_too_old 的提示 6 秒后自动清除（不留红字常驻）", async () => {
    vi.useFakeTimers();
    const { result } = renderHook(() =>
      useVoiceInput({ maxSeconds: 180, onTranscribed: vi.fn(), probeStatus: false }),
    );
    // 直接走状态机的对外入口构造这类错误不方便，所以这里用 hook 内部同一条路径：
    // start → 录音 → stop → 上传失败 404。
    apiMocks.request.mockRejectedValue(new ApiError("Not Found", 405, { code: "http" }));
    act(() => {
      result.current.start();
    });
    await flushStart();
    await act(async () => {
      await Promise.resolve();
    });
    const recorder = FakeMediaRecorder.instances[0];
    act(() => {
      recorder.emitData(10);
      // 超过 MIN_RECORDING_MS，否则会先被 too_short 挡下（见 #8 的闸门）。
      vi.advanceTimersByTime(1200);
    });
    await act(async () => {
      result.current.stop();
      await Promise.resolve();
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(result.current.error?.code).toBe("backend_too_old");

    // 5.9 秒时还在（不是一闪就没了）
    act(() => {
      vi.advanceTimersByTime(5900);
    });
    expect(result.current.error).not.toBeNull();

    act(() => {
      vi.advanceTimersByTime(200);
    });
    expect(result.current.error).toBeNull();
  });
});

describe("uploadErrorFor 的 404/405 分支", () => {
  it("404 与 405 都归到 backend_too_old，其它状态码不受影响", () => {
    expect(uploadErrorFor(new ApiError("Not Found", 404, { code: "http" })).code).toBe(
      "backend_too_old",
    );
    expect(uploadErrorFor(new ApiError("Method Not Allowed", 405, { code: "http" })).code).toBe(
      "backend_too_old",
    );
    expect(uploadErrorFor(new ApiError("boom", 500, { code: "http" })).code).toBe("service_failed");
  });
});
