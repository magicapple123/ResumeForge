// SPDX-License-Identifier: Apache-2.0
/**
 * Composer 与 #26 P0 实时语音的接线：转写结果追加进作答框、硬插话走「停止本轮」、
 * 面试官生成期间麦克风自动进入插话检测（assistantActive 跟随 submitting）。
 */
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { UseInterviewVoiceOptions } from "../../features/interview-voice/useInterviewVoice";
import { t } from "../../i18n";

const realtime = vi.hoisted(() => ({
  options: null as UseInterviewVoiceOptions | null,
}));

vi.mock("../../features/interview-voice/useInterviewVoice", () => ({
  useInterviewVoice: (options: UseInterviewVoiceOptions) => {
    realtime.options = options;
    return {
      supported: true,
      enabled: true,
      starting: false,
      error: null,
      mode: options.mode,
      toggle: vi.fn(),
      releasePushToTalk: vi.fn(),
      clearError: vi.fn(),
      snapshot: {
        phase: "idle" as const,
        voiceActive: false,
        level: 0,
        waveform: [],
        thinking: false,
        ducked: false,
      },
    };
  },
}));

vi.mock("../../hooks/useVoiceInput", () => ({
  useVoiceInput: () => ({
    status: "idle",
    seconds: 0,
    error: null,
    configured: true,
    providerHost: "",
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    clearError: vi.fn(),
  }),
}));

import { Composer } from "./Composer";

function renderComposer(props: { value?: string; submitting?: boolean } = {}) {
  const onChange = vi.fn();
  const onSubmit = vi.fn();
  const onSubmitText = vi.fn();
  const onStop = vi.fn();
  render(
    <AntdApp>
      <Composer
        value={props.value ?? ""}
        submitting={props.submitting ?? false}
        onChange={onChange}
        onSubmit={onSubmit}
        onSubmitText={onSubmitText}
        onStop={onStop}
        interviewerReply={null}
        interviewerStyle="严谨专业"
        messages={[]}
        pendingAnswer={null}
        streamingQuestion={null}
      />
    </AntdApp>,
  );
  return { onChange, onSubmit, onSubmitText, onStop };
}

beforeEach(() => {
  realtime.options = null;
});

describe("Composer + 实时语音（#26 P0）", () => {
  it("转写结果按「追加」语义落进输入框（不覆盖已有文字）", () => {
    const { onChange } = renderComposer({ value: "我先说了一句。" });
    realtime.options?.onTranscript("这是语音补充");
    expect(onChange).toHaveBeenCalledTimes(1);
    expect(onChange.mock.calls[0][0]).toContain("我先说了一句。");
    expect(onChange.mock.calls[0][0]).toContain("这是语音补充");
  });

  it("面试官生成中（submitting）→ 麦克风切到插话检测", () => {
    renderComposer({ submitting: true });
    expect(realtime.options?.assistantActive).toBe(true);
    expect(screen.getByText(t("interviewVoice.action.stop"))).toBeInTheDocument();
  });

  it("硬插话：调用「停止本轮」（abort 当前 SSE），不弹错误", () => {
    const { onStop } = renderComposer({ submitting: true });
    realtime.options?.onBargeIn();
    expect(onStop).toHaveBeenCalledTimes(1);
  });

  it("通话内的语音转写直接提交，不写入下方输入框", () => {
    const { onChange, onSubmitText } = renderComposer();
    fireEvent.click(screen.getByRole("button", { name: t("interviewVoice.room.enter") }));
    realtime.options?.onTranscript("我负责过一个推荐系统项目");
    expect(onSubmitText).toHaveBeenCalledWith("我负责过一个推荐系统项目");
    expect(onChange).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: t("interviewVoice.room.exit") })).toBeInTheDocument();
  });

  it("Escape 退出通话后将焦点还给入口", async () => {
    renderComposer();
    const trigger = screen.getByRole("button", { name: t("interviewVoice.room.enter") });
    fireEvent.click(trigger);
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() =>
      expect(screen.getByRole("button", { name: t("interviewVoice.room.enter") })).toHaveFocus(),
    );
  });

  it("通话外仍保留文字输入与手动提交", () => {
    const { onSubmit } = renderComposer({ value: "回答内容" });
    expect(screen.getByText(t("interviewVoice.mode.alwaysOn"))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("interview.action.submit") }));
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });
});
