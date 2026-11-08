// SPDX-License-Identifier: Apache-2.0
/**
 * VoiceButton 三态渲染：idle 是 Button、recording 刻意不是 Button（红色脉冲 + mm:ss）、
 * transcribing 转圈 +「识别中」。提示行按"错误 > 录音隐私 > 未配置"的优先级只显示一条。
 *
 * 状态由注入的 controller 控制：这里测的是渲染与交互，录音状态机本身在
 * hooks/useVoiceInput.test.ts 覆盖。
 *
 * R06-C 追加一条样式契约：提示行必须**脱离文档流**。它是 `inline-flex; column` 里的
 * 第二个子元素，参与高度计算时会把包裹撑高，工具栏 `align-items: center` 就会把麦克风
 * 顶得比同级控件高一截——那是这次改动要修的原始 bug，所以直接读 CSS 原文钉住它。
 */

declare const process: { cwd(): string };

function css(): string {
  return readFileSync([process.cwd(), "src", "styles", "voice-input.css"].join("/"), "utf8");
}

function interviewCss(): string {
  return readFileSync([process.cwd(), "src", "styles", "interview-voice.css"].join("/"), "utf8");
}

// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { fireEvent, render, screen } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { VoiceController } from "../../hooks/useVoiceInput";
import VoiceButton from "./VoiceButton";

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

function renderButton(voice: VoiceController, variant?: "inline" | "compact") {
  const onTranscribed = vi.fn();
  const view = render(
    <AntdApp>
      <VoiceButton voice={voice} variant={variant} maxSeconds={180} onTranscribed={onTranscribed} />
    </AntdApp>,
  );
  return { ...view, onTranscribed };
}

describe("VoiceButton", () => {
  it("空闲态是麦克风 Button，点击开始录音", () => {
    const voice = controller();
    renderButton(voice);
    const button = screen.getByRole("button", { name: t("voiceInput.aria.start") });
    fireEvent.click(button);
    expect(voice.start).toHaveBeenCalledTimes(1);
    // 未录音、未配置齐全时不显示隐私提示。
    expect(
      screen.queryByText(t("voiceInput.hint.privacy", { host: "asr.example.com" })),
    ).toBeNull();
  });

  it("录音中是红色脉冲 + mm:ss，且不是 antd Button；下方显示隐私提示", () => {
    const voice = controller({ status: "recording", seconds: 65 });
    renderButton(voice);
    const control = screen.getByRole("button", { name: t("voiceInput.aria.stop") });
    expect(control.className).not.toContain("ant-btn");
    expect(control.textContent).toContain("01:05");
    expect(
      screen.getByText(t("voiceInput.hint.privacy", { host: "asr.example.com" })),
    ).toBeInTheDocument();
    fireEvent.click(control);
    expect(voice.stop).toHaveBeenCalledTimes(1);
  });

  it("转写中显示「识别中」", () => {
    const voice = controller({ status: "transcribing" });
    renderButton(voice);
    expect(screen.getByText(t("voiceInput.status.transcribing"))).toBeInTheDocument();
  });

  it("未配置时显示指路文案；点击仍会调用 start（由 hook 出 not_configured，不发请求）", () => {
    const voice = controller({ configured: false, providerHost: "" });
    renderButton(voice);
    expect(screen.getByText(new RegExp(t("voiceInput.hint.notConfigured")))).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: t("voiceInput.aria.start") }));
    expect(voice.clearError).toHaveBeenCalledTimes(1);
    expect(voice.start).toHaveBeenCalledTimes(1);
    // 未配置时不显示隐私提示。
    expect(screen.queryByText(t("voiceInput.hint.privacy", { host: "" }))).toBeNull();
  });

  it("错误态显示具体原因（不同错误各有独立文案）", () => {
    const voice = controller({
      error: { code: "permission_denied", message: t("voiceInput.error.permissionDenied") },
    });
    renderButton(voice);
    expect(screen.getByText(t("voiceInput.error.permissionDenied"))).toBeInTheDocument();
  });

  it("compact 形态只给控件本身（Space.Compact 内不塞提示行）", () => {
    const voice = controller({ status: "recording", seconds: 3 });
    renderButton(voice, "compact");
    expect(screen.getByRole("button", { name: t("voiceInput.aria.stop") })).toBeInTheDocument();
    expect(
      screen.queryByText(t("voiceInput.hint.privacy", { host: "asr.example.com" })),
    ).toBeNull();
  });

  it("提示行不在文档流里：包裹 relative + 提示行 absolute（否则把工具栏顶高）", () => {
    const wrapper = /\.voice-input \{([\s\S]*?)\}/.exec(css())?.[1] ?? "";
    expect(wrapper).toContain("position: relative");

    const hint = /\.voice-input-hint \{([\s\S]*?)\}/.exec(css())?.[1] ?? "";
    expect(hint).toContain("position: absolute");
    expect(hint).toContain("top: calc(100% + 4px)");
    expect(hint).toContain("pointer-events: none");
  });

  it("提示行贴右缘并按单行优先排（贴左缘会被压成竖条、盖住发送键）", () => {
    const hint = /\.voice-input-hint \{([\s\S]*?)\}/.exec(css())?.[1] ?? "";
    // 绝对定位元素只给 left 时，宽度按"左侧到包含块右缘"的可用空间收缩；
    // 麦克风紧贴视口右缘，可用空间只剩几十像素 → 长句变成每行四五个字的竖条。
    expect(hint).toContain("right: 0");
    expect(hint).not.toContain("left: 0");
    expect(hint).toContain("width: max-content");
    // 只在窄栏才折行，且折行时不许超出视口。
    expect(hint).toContain("max-width: min(340px, calc(100vw - 16px))");
  });

  it("面试页的提示行仍是「在流里」（基类改成绝对定位后必须显式恢复）", () => {
    // 注意：文件里还有一条**旧的** `.interview-followup .voice-input-hint`（只管 display/margin），
    // 所以不能用 indexOf 找第一条同名规则，必须匹配「两个选择器成组」的那条。
    const restore =
      /\.interview-composer-actions \.voice-input-hint,\s*\.interview-followup \.voice-input-hint \{([\s\S]*?)\}/.exec(
        interviewCss(),
      )?.[1] ?? "";
    expect(restore).toContain("position: static");
    expect(restore).toContain("width: auto");
    expect(restore).toContain("max-width: none");
  });

  it("空闲态是无边框的文字型控件；录音态的红描边胶囊保持不变", () => {
    const idle = /\.voice-input-button \{([\s\S]*?)\}/.exec(css())?.[1] ?? "";
    expect(idle).toContain("border: none");
    expect(idle).toContain("background: transparent");

    const recording = /\.voice-recording-button \{([\s\S]*?)\}/.exec(css())?.[1] ?? "";
    expect(recording).toContain("border: 1px solid var(--rf-danger)");
  });
});
