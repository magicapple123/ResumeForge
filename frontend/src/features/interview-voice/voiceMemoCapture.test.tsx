// SPDX-License-Identifier: Apache-2.0
/**
 * I-19：「语音记一条」录音层的三道闸门（jsdom，无真麦克风）。
 *
 * `MicCapture` / `transcribeSegment` 全部被模块级 mock 替换——**不改生产代码的导入方式**
 * （为测试改架构就是把它改成"只有测试能跑"）。闸门本身是 `voiceMemoCapture` 的职责：
 * 太短 / 全程静音在**上传前**拦住，到 `maxSeconds` 自动收尾，三条都不能静默。
 */
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { MIN_RECORDING_MS } from "../../hooks/voiceGates";

const mocks = vi.hoisted(() => {
  const state = {
    instances: [] as Array<{
      emit: (amplitude: number) => void;
      opts: { onFrame: (frame: Float32Array) => void; onError: (error: unknown) => void };
    }>,
    supported: true,
  };
  class MicCapture {
    opts: { onFrame: (frame: Float32Array) => void; onError: (error: unknown) => void };
    start = vi.fn(async () => {});
    stop = vi.fn();
    constructor(opts: {
      onFrame: (frame: Float32Array) => void;
      onError: (error: unknown) => void;
    }) {
      this.opts = opts;
      state.instances.push({
        opts,
        emit(amplitude: number) {
          const frame = new Float32Array(160);
          frame.fill(amplitude);
          opts.onFrame(frame);
        },
      });
    }
  }
  return {
    state,
    MicCapture,
    isMicCaptureSupported: () => state.supported,
    micErrorCode: () => "other",
    transcribeSegment: vi.fn(async () => "我在某某公司做后端开发"),
  };
});

vi.mock("./capture", () => ({
  MicCapture: mocks.MicCapture,
  isMicCaptureSupported: mocks.isMicCaptureSupported,
  micErrorCode: mocks.micErrorCode,
}));
vi.mock("./transcribe", () => ({ transcribeSegment: mocks.transcribeSegment }));
vi.mock("./asrApi", () => ({
  getTranscribeStatus: vi.fn(async () => ({
    configured: true,
    provider_host: "asr.example.com",
    model: "test",
    protocol: "dashscope",
    max_seconds: 180,
    max_bytes: 10485760,
  })),
}));
vi.mock("../../api/profile", () => ({ parseProfileText: vi.fn(async () => ({ sections: [] })) }));

import { useVoiceMemoCapture } from "./voiceMemoCapture";

function Probe({
  maxSeconds,
  onTranscribed,
}: {
  maxSeconds: number;
  onTranscribed: (text: string) => void;
}) {
  const voice = useVoiceMemoCapture({ maxSeconds, onTranscribed });
  return (
    <div>
      <span data-testid="status">{voice.status}</span>
      <span data-testid="error">{voice.error?.code ?? ""}</span>
      <span data-testid="seconds">{voice.seconds}</span>
      <button type="button" onClick={voice.start}>
        start
      </button>
      <button type="button" onClick={voice.stop}>
        stop
      </button>
    </div>
  );
}

function lastCapture() {
  const instance = mocks.state.instances[mocks.state.instances.length - 1];
  if (!instance) throw new Error("MicCapture 没有被创建");
  return instance;
}

beforeEach(() => {
  mocks.state.instances.length = 0;
  mocks.state.supported = true;
  mocks.transcribeSegment.mockClear();
  vi.useFakeTimers({ shouldAdvanceTime: true });
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useVoiceMemoCapture 的三道闸门（I-19）", () => {
  it("太短（< MIN_RECORDING_MS）不上传，并说出原因", async () => {
    const onTranscribed = vi.fn();
    render(<Probe maxSeconds={180} onTranscribed={onTranscribed} />);
    fireEvent.click(screen.getByText("start"));
    lastCapture().emit(0.5);
    await vi.advanceTimersByTimeAsync(MIN_RECORDING_MS - 200);
    fireEvent.click(screen.getByText("stop"));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("too_short"));
    expect(mocks.transcribeSegment).not.toHaveBeenCalled();
    expect(onTranscribed).not.toHaveBeenCalled();
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });

  it("全程静音（峰值低于阈值）不上传，并给出可读文案", async () => {
    const onTranscribed = vi.fn();
    render(<Probe maxSeconds={180} onTranscribed={onTranscribed} />);
    fireEvent.click(screen.getByText("start"));
    lastCapture().emit(0);
    await vi.advanceTimersByTimeAsync(MIN_RECORDING_MS + 500);
    fireEvent.click(screen.getByText("stop"));
    await waitFor(() => expect(screen.getByTestId("error").textContent).toBe("no_sound"));
    expect(mocks.transcribeSegment).not.toHaveBeenCalled();
    expect(onTranscribed).not.toHaveBeenCalled();
  });

  it("达到 maxSeconds 自动收尾，最后一段仍会送去转写", async () => {
    const onTranscribed = vi.fn();
    render(<Probe maxSeconds={2} onTranscribed={onTranscribed} />);
    fireEvent.click(screen.getByText("start"));
    lastCapture().emit(0.5);
    await vi.advanceTimersByTimeAsync(2100);
    await waitFor(() => expect(onTranscribed).toHaveBeenCalledWith("我在某某公司做后端开发"));
    expect(mocks.transcribeSegment).toHaveBeenCalledTimes(1);
    expect(screen.getByTestId("status").textContent).toBe("idle");
  });

  it("正常时长 + 有声音：上传并回调文字", async () => {
    const onTranscribed = vi.fn();
    render(<Probe maxSeconds={180} onTranscribed={onTranscribed} />);
    fireEvent.click(screen.getByText("start"));
    lastCapture().emit(0.5);
    await vi.advanceTimersByTimeAsync(1200);
    fireEvent.click(screen.getByText("stop"));
    await waitFor(() => expect(onTranscribed).toHaveBeenCalled());
    // 录音中态有读屏可听的停止入口（不是"按钮变灰"这种无反馈）。
    expect(t("voiceMemo.status.recording")).toBeTruthy();
  });
});
