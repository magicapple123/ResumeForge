// SPDX-License-Identifier: Apache-2.0
/**
 * 面试作答框（T13）与语音的联动：
 * - 录音中「提交回答」禁用并改文案「请先结束录音」，Ctrl/Cmd+Enter 也不提交；
 * - 转写结果追加在已有文字后面（不覆盖）；
 * - 进入提交态（这一轮已结束/切轮次清空）时取消正在录的那段。
 */

import { act, fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { VoiceController } from "../../hooks/useVoiceInput";

const voiceMock = vi.hoisted(() => ({
  options: null as { onTranscribed: (text: string) => void } | null,
  controller: null as VoiceController | null,
}));

vi.mock("../../hooks/useVoiceInput", () => ({
  useVoiceInput: (options: { onTranscribed: (text: string) => void }) => {
    voiceMock.options = options;
    return voiceMock.controller;
  },
}));

import { Composer } from "./Composer";

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

function renderComposer(props: {
  value?: string;
  submitting?: boolean;
  onChange?: (value: string) => void;
  onSubmit?: () => void;
}) {
  const onChange = props.onChange ?? vi.fn();
  const onSubmit = props.onSubmit ?? vi.fn();
  const view = render(
    <AntdApp>
      <Composer
        value={props.value ?? ""}
        submitting={props.submitting ?? false}
        onChange={onChange}
        onSubmit={onSubmit}
        onStop={vi.fn()}
      />
    </AntdApp>,
  );
  return { ...view, onChange, onSubmit };
}

beforeEach(() => {
  voiceMock.options = null;
  voiceMock.controller = controller();
});

describe("Composer 语音（T13）", () => {
  it("录音中「提交回答」禁用且文案为「请先结束录音」，Ctrl+Enter 不提交", () => {
    voiceMock.controller = controller({ status: "recording", seconds: 5 });
    const { onSubmit } = renderComposer({ value: "已经打了一半的回答" });

    const submit = screen.getByRole("button", { name: t("voiceInput.action.submitBlocked") });
    expect(submit).toBeDisabled();
    expect(screen.queryByRole("button", { name: t("interview.action.submit") })).toBeNull();

    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true });
    expect(onSubmit).not.toHaveBeenCalled();
  });

  it("非录音时 Ctrl+Enter 仍照常提交", () => {
    const { onSubmit } = renderComposer({ value: "正常回答" });
    fireEvent.keyDown(screen.getByRole("textbox"), { key: "Enter", ctrlKey: true });
    expect(onSubmit).toHaveBeenCalledTimes(1);
  });

  it("已有文字 + 转写：结果追加在后，原文保留", () => {
    const { onChange } = renderComposer({ value: "我先说一段项目经历" });
    act(() => {
      voiceMock.options?.onTranscribed("然后补充技术栈");
    });
    expect(onChange).toHaveBeenCalledWith("我先说一段项目经历\n然后补充技术栈");
  });

  it("提交态（这一轮结束）会取消正在录的那段", () => {
    voiceMock.controller = controller({ status: "recording", seconds: 2 });
    const { rerender } = renderComposer({ value: "回答" });
    expect(voiceMock.controller.cancel).not.toHaveBeenCalled();
    rerender(
      <AntdApp>
        <Composer value="" submitting onChange={vi.fn()} onSubmit={vi.fn()} onStop={vi.fn()} />
      </AntdApp>,
    );
    expect(voiceMock.controller.cancel).toHaveBeenCalledTimes(1);
  });
});
