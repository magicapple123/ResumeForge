// SPDX-License-Identifier: Apache-2.0
/**
 * 实时语音房间的资源与出口：摄像头未经请求不打开；关掉或卸载时必须停掉本地轨道；
 * 退出有显式按钮，Escape 也能退出。
 *
 * 为什么单独测：摄像头指示灯不灭、麦克风没释放，这类问题在 jsdom 里不会自己暴露，
 * 真实设备上却是隐私事故。
 */
import { fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { InterviewMessage } from "../../types";
import { LiveVoiceRoom } from "./LiveVoiceRoom";
import { CAMERA_SETTINGS_KEY, DEFAULT_CAMERA_SETTINGS } from "./cameraSettings";
import {
  CAMERA_SETTINGS_PATH,
  cameraNotice,
  cameraSettingsActionLabel,
} from "./liveVoiceRoomCamera";
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
      // I-26：轻提示走 `App.useApp()`，必须包一层 App 才会真的渲染进 DOM。
      <AntdApp>
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
        />
      </AntdApp>,
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
  vi.restoreAllMocks();
  // antd v6 的静态 message 没有 destroy()：直接摘掉提示节点，避免跨用例串台。
  document.querySelectorAll(".ant-message-notice").forEach((node) => node.remove());
  window.localStorage.clear();
});

/** 只替换 `navigator.mediaDevices`：jsdom 没有摄像头，别动其它字段。 */
function stubMedia(getUserMedia: ReturnType<typeof vi.fn>) {
  const fakeNavigator = Object.create(navigator) as Navigator;
  Object.defineProperty(fakeNavigator, "mediaDevices", { value: { getUserMedia } });
  vi.stubGlobal("navigator", fakeNavigator);
}

/** 底栏右侧那颗摄像头按钮（左栏另有一颗占位按钮，两者受同一套状态管辖）。 */
function footerCameraButton(): HTMLElement {
  const right = document.querySelector<HTMLElement>(".interview-live-room__controls-right");
  if (!right) throw new Error("底栏右侧容器不存在");
  return within(right).getByRole("button", {
    name: new RegExp(t("interviewVoice.room.cameraOn")),
  });
}

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
    // I-27：摄像头关闭时**不留空框**——"关着"只由底栏那颗按钮的文案与悬停提示体现。
    expect(screen.queryByText(t("interviewVoice.room.cameraOff"))).toBeNull();
    expect(screen.queryByTestId("camera-pip")).toBeNull();
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
    // 关掉之后回到"没有任何占位"的状态，不是又留一块空框。
    expect(screen.queryByTestId("camera-pip")).toBeNull();
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
    const getUserMedia = vi.fn();
    stubMedia(getUserMedia);

    renderRoom();
    // I-27：左轨占位按钮已随左轨删除，摄像头只剩底栏这一颗（仍受总开关管辖）。
    fireEvent.click(footerCameraButton());
    // 不申请权限（隐私红线），但必须说出为什么——轻提示与按钮悬停提示同一句话。
    expect(await screen.findByText(cameraNotice(false, null) as string)).toBeInTheDocument();
    expect(getUserMedia).not.toHaveBeenCalled();
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
      // 当前轮（最后一条提问 + 最后一条回答）只在底部卡片里出现，记录区放的是已完成的轮次。
      message({ id: 3, role: "interviewer", content: "How did you size the cache?" }),
      message({ id: 4, role: "user", content: "By hit rate and working set." }),
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

    // 昵称：气泡里写的是房间自己的称呼（面试官 / 我）。两轮各两条，所以会有重复。
    expect(
      within(conversation).getAllByText(t("interviewVoice.room.interviewer")).length,
    ).toBeGreaterThan(0);
    expect(within(conversation).getAllByText(t("interviewVoice.room.you")).length).toBeGreaterThan(
      0,
    );

    // I-27：时间按 5 分钟分组——两条同一时刻的气泡只标一次（原来是 2 条各标一次）。
    expect(within(conversation).getAllByText(/2026/)).toHaveLength(1);
    // I-27：点评搬出气泡，进右侧独立栏；对话区不再出现评分。
    expect(conversation.textContent).not.toContain("Clear structure, but no measurable result.");
    const review = screen.getByRole("complementary", { name: t("interviewVoice.room.review") });
    expect(review.textContent).toContain("Clear structure, but no measurable result.");
  });

  it("renders the pending answer as a user bubble without a timestamp", () => {
    renderWithMessages(
      [message({ id: 1, role: "interviewer" })],
      "Draft answer typed but not sent yet.",
    );
    const bubble = screen
      .getByText("Draft answer typed but not sent yet.")
      .closest(".interview-message");
    expect(bubble).toHaveClass("interview-message--me");
    // 占位气泡不是服务端记录：不写时间，避免"刚刚"这种假信息。
    expect(bubble?.querySelector(".assistant-message-time")).toBeNull();
  });

  /**
   * I-25：记录在上、当前问答在下。
   *
   * 顺序必须落在 DOM 上（不是 CSS `order`）：否则 Tab 顺序会与视觉顺序相反。
   */
  it("puts the conversation above the current exchange in DOM order", () => {
    renderWithMessages([
      message({ id: 1, role: "interviewer", content: "First question." }),
      message({ id: 2, role: "user", content: "First answer." }),
      message({ id: 3, role: "interviewer", content: "Second question." }),
      message({ id: 4, role: "user", content: "Second answer." }),
    ]);

    const conversation = screen.getByRole("complementary", {
      name: t("interviewVoice.room.conversation"),
    });
    const turn = screen.getByRole("region", { name: t("interviewVoice.room.currentTurn") });
    // DOCUMENT_POSITION_FOLLOWING：turn 排在 conversation 之后。
    expect(conversation.compareDocumentPosition(turn) & Node.DOCUMENT_POSITION_FOLLOWING).toBe(
      Node.DOCUMENT_POSITION_FOLLOWING,
    );
  });

  /**
   * I-25：同一轮内容只渲染一次。
   *
   * 缺陷原形：`Aside` 收到完整的 `formal`，`Turn` 又拿最后两条构造——当前问答同时出现在
   * 两处，读屏（`aria-live="polite"`）还会播报两遍。
   */
  it("renders the current exchange only once", () => {
    const q2 = "Second question.";
    const a2 = "Second answer.";
    renderWithMessages([
      message({ id: 1, role: "interviewer", content: "First question." }),
      message({ id: 2, role: "user", content: "First answer." }),
      message({ id: 3, role: "interviewer", content: q2 }),
      message({ id: 4, role: "user", content: a2 }),
    ]);

    // 整页各一次：底部卡片有，记录区没有。
    expect(screen.getAllByText(q2)).toHaveLength(1);
    expect(screen.getAllByText(a2)).toHaveLength(1);

    const conversation = screen.getByRole("complementary", {
      name: t("interviewVoice.room.conversation"),
    });
    expect(within(conversation).queryByText(q2)).toBeNull();
    expect(within(conversation).queryByText(a2)).toBeNull();
    // 已完成的上一轮仍留在记录区。
    expect(within(conversation).getByText("First question.")).toBeInTheDocument();
  });

  /**
   * I-25：只有提问、还没回答时，记录区必须换一句说明。
   *
   * 交换顺序后「历史为空、下方已有当前问答」是开场常态；沿用「等待面试官提问」会让同一屏
   * 上的记录区说"还在等面试官"，而卡片里已经是他刚问出的那道题。
   */
  it("explains an empty history when the current question is already showing", () => {
    renderWithMessages([message({ id: 1, role: "interviewer", content: "Only question." })]);

    const conversation = screen.getByRole("complementary", {
      name: t("interviewVoice.room.conversation"),
    });
    expect(
      within(conversation).getByText(t("interviewVoice.room.historyEmpty")),
    ).toBeInTheDocument();
    expect(within(conversation).queryByText(t("interviewVoice.room.waiting"))).toBeNull();
    // 当前轮仍在底部卡片里（记录区不留"半条记录"）。
    expect(within(conversation).queryByText("Only question.")).toBeNull();
    expect(
      screen.getByRole("region", { name: t("interviewVoice.room.currentTurn") }).textContent,
    ).toContain("Only question.");
  });

  it("keeps the waiting hint when there is no exchange at all", () => {
    renderWithMessages([]);
    const conversation = screen.getByRole("complementary", {
      name: t("interviewVoice.room.conversation"),
    });
    expect(within(conversation).getByText(t("interviewVoice.room.waiting"))).toBeInTheDocument();
  });
});

/**
 * I-26：点「开启摄像头」必须有反馈。
 *
 * 缺陷原形：总开关关着时 `toggleCamera` 第一行静默 `return`——按钮不变灰、不 loading、
 * 不弹提示、画面也不变。以下每条都断言"说得出为什么"，而不只是"没有崩溃"。
 */
describe("LiveVoiceRoom camera feedback (I-26)", () => {
  it("explains the master switch is off, in the same words as the stage hint", async () => {
    const getUserMedia = vi.fn();
    stubMedia(getUserMedia);
    renderRoom();

    // I-27：左轨连同那块 4:3 空框一起删了，页面上不再常驻"摄像头预览已关闭"；
    // 这句话只在点按钮之后作为轻提示出现一次。
    const sentence = cameraNotice(false, null);
    expect(sentence).toBeTruthy();
    expect(screen.queryByText(sentence as string)).toBeNull();

    fireEvent.click(footerCameraButton());
    await waitFor(() => expect(screen.getAllByText(sentence as string)).toHaveLength(1));

    // 总开关关着时绝不申请权限（隐私红线），但提示里要能一键去设置。
    expect(getUserMedia).not.toHaveBeenCalled();
    expect(screen.getByRole("button", { name: cameraSettingsActionLabel() })).toBeInTheDocument();
  });

  it("opens the camera section of settings from the toast", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    stubMedia(vi.fn());
    renderRoom();

    fireEvent.click(footerCameraButton());
    fireEvent.click(await screen.findByRole("button", { name: cameraSettingsActionLabel() }));

    // 通话是全屏覆盖层：同标签页跳走会结束这场面试，所以开新标签页。
    expect(open).toHaveBeenCalledWith(CAMERA_SETTINGS_PATH, "_blank", "noopener,noreferrer");
  });

  it("names a denied permission and keeps the button usable", async () => {
    enableCamera();
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("denied", "NotAllowedError"));
    stubMedia(getUserMedia);

    renderRoom();
    const button = footerCameraButton();
    fireEvent.click(button);

    const sentence = cameraNotice(true, "denied") as string;
    await waitFor(() => expect(screen.getAllByText(sentence).length).toBeGreaterThan(0));
    // 不能卡在 loading：权限被拒是一次"这次没成"，不是终态。
    await waitFor(() => expect(button).not.toHaveClass("ant-btn-loading"));
    expect(button).toBeEnabled();

    // 用户在浏览器里刚授过权：再点一次就能出画面。
    getUserMedia.mockResolvedValue({ getTracks: () => [{ stop: vi.fn() }] });
    fireEvent.click(button);
    await waitFor(() =>
      expect(screen.getByLabelText(t("interviewVoice.room.cameraPreview"))).toBeInTheDocument(),
    );
  });

  it("names a missing camera device instead of spinning forever", async () => {
    enableCamera();
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("none", "NotFoundError"));
    stubMedia(getUserMedia);

    renderRoom();
    const button = footerCameraButton();
    fireEvent.click(button);

    const sentence = cameraNotice(true, "no-device") as string;
    await waitFor(() => expect(screen.getAllByText(sentence).length).toBeGreaterThan(0));
    await waitFor(() => expect(button).not.toHaveClass("ant-btn-loading"));
    expect(button).toBeEnabled();
  });

  it("names a camera held by another program", async () => {
    enableCamera();
    const getUserMedia = vi.fn().mockRejectedValue(new DOMException("busy", "NotReadableError"));
    stubMedia(getUserMedia);

    renderRoom();
    fireEvent.click(footerCameraButton());

    const sentence = cameraNotice(true, "busy") as string;
    await waitFor(() => expect(screen.getAllByText(sentence).length).toBeGreaterThan(0));
  });
});
