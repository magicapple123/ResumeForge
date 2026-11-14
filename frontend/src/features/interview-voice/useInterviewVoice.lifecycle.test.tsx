// SPDX-License-Identifier: Apache-2.0
/**
 * 语音采集的生命周期：权限还挂起时用户退出，迟到的麦克风流必须立刻停掉；卸载后不再
 * 回调状态。
 *
 * 与 LiveVoiceRoom 的摄像头序号是同一类竞态——异步授权回来得比「关闭」晚。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { useInterviewVoice } from "./useInterviewVoice";
import type { UseInterviewVoiceOptions } from "./useInterviewVoice";

const captureMock = vi.hoisted(() => ({ start: vi.fn(), stop: vi.fn() }));

vi.mock("./capture", async (importOriginal) => {
  const actual = await importOriginal<typeof import("./capture")>();
  return {
    ...actual,
    isMicCaptureSupported: () => true,
    MicCapture: class {
      start = captureMock.start;
      stop = captureMock.stop;
    },
  };
});

const options: UseInterviewVoiceOptions = {
  mode: "always-on",
  assistantActive: false,
  onTranscript: vi.fn(),
  onBargeIn: vi.fn(),
  deps: { cancelTurn: vi.fn().mockResolvedValue(undefined) },
};

describe("useInterviewVoice lifecycle", () => {
  it("stops a microphone that resolves after the user exits while permission is pending", async () => {
    let resolveStart!: () => void;
    captureMock.start.mockImplementationOnce(
      () => new Promise<void>((resolve) => (resolveStart = resolve)),
    );
    captureMock.stop.mockClear();
    const { result } = renderHook(() => useInterviewVoice(options));

    act(() => result.current.toggle());
    await waitFor(() => expect(result.current.starting).toBe(true));
    act(() => result.current.toggle());
    expect(result.current.starting).toBe(false);

    await act(async () => resolveStart());
    expect(captureMock.stop).toHaveBeenCalledTimes(2);
    expect(result.current.enabled).toBe(false);
  });
});
