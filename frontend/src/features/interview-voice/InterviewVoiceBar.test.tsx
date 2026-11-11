// SPDX-License-Identifier: Apache-2.0
/** 26A / 26B / 26G：常开指示、波形、一键关闭、双模式与错误文案的渲染契约。 */
import { fireEvent, render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { InterviewVoiceBar } from "./InterviewVoiceBar";
import type { InterviewVoiceController } from "./useInterviewVoice";
import type { VoiceSessionSnapshot } from "./voiceSession";

function controller(overrides: Partial<InterviewVoiceController> = {}): InterviewVoiceController {
  return {
    supported: true,
    enabled: false,
    starting: false,
    error: null,
    mode: "always-on",
    toggle: vi.fn(),
    releasePushToTalk: vi.fn(),
    clearError: vi.fn(),
    snapshot: {
      phase: "idle",
      voiceActive: false,
      level: 0,
      waveform: [],
      thinking: false,
      ducked: false,
    },
    ...overrides,
  };
}

function snapshot(overrides: Partial<VoiceSessionSnapshot> = {}): VoiceSessionSnapshot {
  return {
    phase: "idle",
    voiceActive: false,
    level: 0,
    waveform: [],
    thinking: false,
    ducked: false,
    ...overrides,
  };
}

function renderBar(overrides: Partial<InterviewVoiceController> = {}, mode = "always-on") {
  const onModeChange = vi.fn();
  const view = render(
    <InterviewVoiceBar
      voice={controller(overrides)}
      mode={mode as "always-on" | "push-to-talk"}
      onModeChange={onModeChange}
    />,
  );
  return { ...view, onModeChange };
}

describe("interview-voice/InterviewVoiceBar", () => {
  it("环境不支持麦克风时整条不渲染（不吓用户）", () => {
    const { container } = renderBar({ supported: false });
    expect(container.querySelector(".interview-voice-bar")).toBeNull();
  });

  it("未开启时只给「开启实时语音」，点一下走总开关", () => {
    const toggle = vi.fn();
    renderBar({ toggle });
    expect(screen.getByText(t("interviewVoice.action.start"))).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewVoice.action.start")) }),
    );
    expect(toggle).toHaveBeenCalledTimes(1);
  });

  it("开启后：常开红点 + 24 根波形 + 一键关闭 + 隐私提示", () => {
    const { container } = renderBar({
      enabled: true,
      snapshot: snapshot({ phase: "collecting", voiceActive: true, waveform: Array(24).fill(0.5) }),
    });
    expect(screen.getByText(t("interviewVoice.action.stop"))).toBeInTheDocument();
    expect(container.querySelector(".interview-voice-bar__dot")).not.toBeNull();
    expect(container.querySelectorAll(".interview-voice-bar__bar").length).toBe(24);
    expect(screen.getByText(t("interviewVoice.hint.privacy"))).toBeInTheDocument();
  });

  it("思考模式：状态行与提示都说明「最多等 5 秒」", () => {
    renderBar({
      enabled: true,
      snapshot: snapshot({ phase: "thinking", thinking: true }),
    });
    expect(screen.getByText(t("interviewVoice.status.thinking"))).toBeInTheDocument();
    expect(screen.getByText(t("interviewVoice.hint.thinking"))).toBeInTheDocument();
  });

  it("正在识别 / 还在听你说 是两种不同状态（延迟错觉不能只剩「正在听」）", () => {
    const { rerender } = renderBar({
      enabled: true,
      snapshot: snapshot({ phase: "waiting-asr" }),
    });
    expect(screen.getByText(t("interviewVoice.status.waitingAsr"))).toBeInTheDocument();
    rerender(
      <InterviewVoiceBar
        voice={controller({ enabled: true, snapshot: snapshot({ phase: "extended" }) })}
        mode="always-on"
        onModeChange={vi.fn()}
      />,
    );
    expect(screen.getByText(t("interviewVoice.status.extended"))).toBeInTheDocument();
  });

  it("插话 duck 时状态行显示「已降低面试官音量」", () => {
    renderBar({ enabled: true, snapshot: snapshot({ phase: "barge-in", ducked: true }) });
    expect(screen.getByText(t("interviewVoice.status.bargeIn"))).toBeInTheDocument();
    expect(screen.getByText(t("interviewVoice.hint.interrupted"))).toBeInTheDocument();
  });

  it("错误给出路：权限被拒绝有具体下一步，关闭按钮清错误", () => {
    const clearError = vi.fn();
    renderBar({ enabled: true, error: "microphone-denied", clearError });
    expect(screen.getByText(t("interviewVoice.error.microphoneDenied"))).toBeInTheDocument();
    fireEvent.click(
      document.querySelector(".interview-voice-bar__error .ant-alert-close-icon") as Element,
    );
    expect(clearError).toHaveBeenCalledTimes(1);
  });

  it("双模式切换：选「按住说话」回调上层；按住说话按钮只在 PTT 模式出现", () => {
    const onModeChange = vi.fn();
    const releasePushToTalk = vi.fn();
    const voice = controller({ enabled: true, releasePushToTalk });
    const { rerender } = render(
      <InterviewVoiceBar voice={voice} mode="always-on" onModeChange={onModeChange} />,
    );
    expect(screen.queryByText(t("interviewVoice.action.hold"))).toBeNull();
    fireEvent.click(screen.getByText(t("interviewVoice.mode.pushToTalk")));
    expect(onModeChange).toHaveBeenCalledWith("push-to-talk");
    rerender(<InterviewVoiceBar voice={voice} mode="push-to-talk" onModeChange={onModeChange} />);
    const hold = screen.getByRole("button", { name: t("interviewVoice.action.hold") });
    fireEvent.pointerUp(hold);
    expect(releasePushToTalk).toHaveBeenCalledTimes(1);
  });
});
