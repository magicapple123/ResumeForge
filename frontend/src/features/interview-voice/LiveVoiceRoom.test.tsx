// SPDX-License-Identifier: Apache-2.0
/**
 * 实时语音房间的资源与出口：摄像头未经请求不打开；关掉或卸载时必须停掉本地轨道；
 * 退出有显式按钮，Escape 也能退出。
 *
 * 为什么单独测：摄像头指示灯不灭、麦克风没释放，这类问题在 jsdom 里不会自己暴露，
 * 真实设备上却是隐私事故。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { InterviewMessage } from "../../types";
import { LiveVoiceRoom } from "./LiveVoiceRoom";
import { CAMERA_SETTINGS_KEY, DEFAULT_CAMERA_SETTINGS } from "./cameraSettings";
import type { InterviewVoiceController } from "./useInterviewVoice";

/** F18 起摄像头受设置页总开关管辖：测"能用"的路径先把开关打开（默认关）。 */
function enableCamera() {
  window.localStorage.setItem(
    CAMERA_SETTINGS_KEY,
    JSON.stringify({ ...DEFAULT_CAMERA_SETTINGS, enabled: true }),
  );
}

function voice(): InterviewVoiceController {
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
  };
}

function renderRoom(onClose = vi.fn()) {
  return {
    onClose,
    ...render(
      <LiveVoiceRoom
        voice={voice()}
        mode="always-on"
        onModeChange={vi.fn()}
        interviewerStyle="严谨专业"
        messages={[]}
        pendingAnswer={null}
        streamingQuestion={null}
        speaking={false}
        speechNotice={null}
        onClose={onClose}
      />,
    ),
  };
}

function message(overrides: Partial<InterviewMessage> = {}): InterviewMessage {
  return {
    id: 1,
    role: "interviewer",
    content: "Describe the system you owned in your last job.",
    context: {},
    status: "ok",
    error: "",
    created_at: "2026-11-14T10:20:00",
    ...overrides,
  };
}

function renderWithMessages(messages: InterviewMessage[], pendingAnswer: string | null = null) {
  return render(
    <LiveVoiceRoom
      voice={voice()}
      mode="always-on"
      onModeChange={vi.fn()}
      interviewerStyle="严谨专业"
      messages={messages}
      pendingAnswer={pendingAnswer}
      streamingQuestion={null}
      speaking={false}
      speechNotice={null}
      onClose={vi.fn()}
    />,
  );
}

afterEach(() => {
  vi.unstubAllGlobals();
  window.localStorage.clear();
});

describe("LiveVoiceRoom", () => {
  it("keeps camera off until requested, then stops the local track when switched off", async () => {
    enableCamera();
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(stream) };
    const fakeNavigator = Object.create(navigator) as Navigator;
    Object.defineProperty(fakeNavigator, "mediaDevices", { value: mediaDevices });
    vi.stubGlobal("navigator", fakeNavigator);

    renderRoom();
    expect(screen.getByText(t("interviewVoice.room.cameraOff"))).toBeInTheDocument();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();

    fireEvent.click(screen.getByRole("button", { name: t("interviewVoice.room.cameraOn") }));
    await waitFor(() =>
      expect(screen.getByLabelText(t("interviewVoice.room.cameraPreview"))).toBeInTheDocument(),
    );
    expect(mediaDevices.getUserMedia).toHaveBeenCalledWith({
      audio: false,
      video: { facingMode: "user" },
    });

    const stopCameraButton = await screen.findByRole("button", {
      name: new RegExp(t("interviewVoice.room.cameraStop")),
    });
    await waitFor(() => expect(stopCameraButton).not.toHaveClass("ant-btn-loading"));
    fireEvent.click(stopCameraButton);
    expect(track.stop).toHaveBeenCalledTimes(1);
    expect(screen.queryByLabelText(t("interviewVoice.room.cameraPreview"))).toBeNull();
  });

  it("releases a local camera track when the call view unmounts", async () => {
    enableCamera();
    const track = { stop: vi.fn() };
    const stream = { getTracks: () => [track] } as unknown as MediaStream;
    const mediaDevices = { getUserMedia: vi.fn().mockResolvedValue(stream) };
    const fakeNavigator = Object.create(navigator) as Navigator;
    Object.defineProperty(fakeNavigator, "mediaDevices", { value: mediaDevices });
    vi.stubGlobal("navigator", fakeNavigator);
    const view = renderRoom();

    fireEvent.click(screen.getByRole("button", { name: t("interviewVoice.room.cameraOn") }));
    await waitFor(() =>
      expect(screen.getByLabelText(t("interviewVoice.room.cameraPreview"))).toBeInTheDocument(),
    );
    view.unmount();
    expect(track.stop).toHaveBeenCalledTimes(1);
  });

  it("never asks for the camera while the master switch is off", async () => {
    const mediaDevices = { getUserMedia: vi.fn() };
    const fakeNavigator = Object.create(navigator) as Navigator;
    Object.defineProperty(fakeNavigator, "mediaDevices", { value: mediaDevices });
    vi.stubGlobal("navigator", fakeNavigator);

    renderRoom();
    // 左栏里的占位按钮（底栏另有一颗摄像头开关，两颗都受总开关管辖）。
    const placeholder = screen.getByText(t("interviewVoice.room.cameraOff")).closest("button");
    expect(placeholder).toBeDisabled();
    if (placeholder) fireEvent.click(placeholder);
    await Promise.resolve();
    expect(mediaDevices.getUserMedia).not.toHaveBeenCalled();
  });

  it("exposes an explicit exit action", () => {
    const onClose = vi.fn();
    renderRoom(onClose);
    fireEvent.click(screen.getByRole("button", { name: t("interviewVoice.room.exit") }));
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("exits the call with Escape", () => {
    const onClose = vi.fn();
    renderRoom(onClose);
    fireEvent.keyDown(window, { key: "Escape" });
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("renders the conversation as chat bubbles with name, time and feedback", () => {
    renderWithMessages([
      message({ id: 1, role: "interviewer", content: "Walk me through your caching design." }),
      message({
        id: 2,
        role: "user",
        content: "We used a two-level cache.",
        context: { feedback: "Clear structure, but no measurable result." },
      }),
    ]);

    // 「当前问答」卡与对话记录会同时出现这段文字，断言只看记录区里的那一条。
    const conversation = screen.getByRole("complementary", {
      name: t("interviewVoice.room.conversation"),
    });
    // 气泡：左右分列靠修饰类区分（interviewer / me），与文字聊天页同一套。
    const interviewerBubble = within(conversation)
      .getByText("Walk me through your caching design.")
      .closest(".interview-message");
    expect(interviewerBubble).toHaveClass("interview-message--interviewer");
    const userBubble = within(conversation)
      .getByText("We used a two-level cache.")
      .closest(".interview-message");
    expect(userBubble).toHaveClass("interview-message--me");

    // 昵称：气泡里写的是房间自己的称呼（面试官 / 我）。
    expect(within(conversation).getByText(t("interviewVoice.room.interviewer"))).toBeInTheDocument();
    expect(within(conversation).getByText(t("interviewVoice.room.you"))).toBeInTheDocument();

    // 时间与点评也在气泡里。
    expect(within(conversation).getAllByText(/2026/).length).toBe(2);
    expect(conversation.textContent).toContain("Clear structure, but no measurable result.");
  });

  it("renders the pending answer as a user bubble without a timestamp", () => {
    renderWithMessages([message({ id: 1, role: "interviewer" })], "Draft answer typed but not sent yet.");
    const bubble = screen.getByText("Draft answer typed but not sent yet.").closest(".interview-message");
    expect(bubble).toHaveClass("interview-message--me");
    // 占位气泡不是服务端记录：不写时间，避免"刚刚"这种假信息。
    expect(bubble?.querySelector(".assistant-message-time")).toBeNull();
  });
});
