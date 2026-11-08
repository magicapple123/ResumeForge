// SPDX-License-Identifier: Apache-2.0
/**
 * 面试复盘「追问」（T13）与语音的联动：
 * - 转写结果只写受控 state，**绝不自动发送**；
 * - 已有文字 + 转写追加在后；
 * - 录音中 Enter 不发送、发送按钮禁用；
 * - 切场次时停掉录音。
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { VoiceController } from "../../hooks/useVoiceInput";
import type { InterviewDetail } from "../../types";

const voiceMock = vi.hoisted(() => ({
  options: null as { onTranscribed: (text: string) => void } | null,
  controller: null as VoiceController | null,
}));

const apiMocks = vi.hoisted(() => ({
  submitInterviewFollowUp: vi.fn(),
  updateInterviewFollowUpState: vi.fn(),
}));

vi.mock("../../hooks/useVoiceInput", () => ({
  useVoiceInput: (options: { onTranscribed: (text: string) => void }) => {
    voiceMock.options = options;
    return voiceMock.controller;
  },
}));

vi.mock("../../api/interview", () => apiMocks);

import { FollowUpCard } from "./FollowUpCard";

function controller(overrides: Partial<VoiceController> = {}): VoiceController {
  return {
    status: "idle",
    seconds: 0,
    error: null,
    configured: true,
    providerHost: "asr.example.com",
    start: vi.fn(),
    stop: vi.fn(),
    cancel: vi.fn(),
    clearError: vi.fn(),
    ...overrides,
  };
}

function session(id: number): InterviewDetail {
  return { id, messages: [], follow_up_closed_at: null } as unknown as InterviewDetail;
}

function renderCard(id = 1) {
  return render(
    <AntdApp>
      <FollowUpCard session={session(id)} onSession={vi.fn()} />
    </AntdApp>,
  );
}

function inputElement(): HTMLInputElement {
  return screen.getByPlaceholderText(t("interviewPage.followUp.placeholder")) as HTMLInputElement;
}

beforeEach(() => {
  voiceMock.options = null;
  voiceMock.controller = controller();
  apiMocks.submitInterviewFollowUp.mockReset();
  apiMocks.updateInterviewFollowUpState.mockReset();
});

describe("FollowUpCard 语音（T13）", () => {
  it("转写只填进输入框，不触发发送", () => {
    renderCard();
    act(() => {
      voiceMock.options?.onTranscribed("帮我看看回答里有没有漏洞");
    });
    expect(inputElement().value).toBe("帮我看看回答里有没有漏洞");
    expect(apiMocks.submitInterviewFollowUp).not.toHaveBeenCalled();
  });

  it("已有文字 + 转写：追加在后（不覆盖）", () => {
    renderCard();
    fireEvent.change(inputElement(), { target: { value: "我之前写的问题" } });
    act(() => {
      voiceMock.options?.onTranscribed("再补充一句");
    });
    expect(inputElement().value).toBe("我之前写的问题 再补充一句");
    expect(apiMocks.submitInterviewFollowUp).not.toHaveBeenCalled();
  });

  it("录音中 Enter 不发送，发送按钮禁用", () => {
    voiceMock.controller = controller({ status: "recording", seconds: 4 });
    renderCard();
    fireEvent.change(inputElement(), { target: { value: "一个完整的问题" } });
    fireEvent.keyDown(inputElement(), { key: "Enter" });
    expect(apiMocks.submitInterviewFollowUp).not.toHaveBeenCalled();
    // 按钮里还有一个带 aria-label 的图标，可访问名是「send 发送追问」，用正则匹配。
    expect(
      screen.getByRole("button", {
        name: new RegExp(t("interviewPage.followUp.submit")),
      }),
    ).toBeDisabled();
  });

  it("切场次时取消录音", () => {
    const { rerender } = renderCard(1);
    const cancel = voiceMock.controller!.cancel as ReturnType<typeof vi.fn>;
    expect(cancel).toHaveBeenCalledTimes(1); // 挂载即停一次（幂等）
    rerender(
      <AntdApp>
        <FollowUpCard session={session(2)} onSession={vi.fn()} />
      </AntdApp>,
    );
    expect(cancel).toHaveBeenCalledTimes(2);
  });

  it("录音中显示音频会发到哪个主机", () => {
    voiceMock.controller = controller({ status: "recording", seconds: 1 });
    renderCard();
    expect(
      screen.getByText(t("voiceInput.hint.privacy", { host: "asr.example.com" })),
    ).toBeInTheDocument();
  });
});
