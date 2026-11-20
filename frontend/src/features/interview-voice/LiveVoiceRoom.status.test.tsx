// SPDX-License-Identifier: Apache-2.0
/**
 * I-27：状态胶囊必须覆盖五态，且通话期间隐藏全局助手浮球。
 *
 * 缺陷原形：五种状态只渲染成底栏一行 12px 灰字，和"谁在说"没有绑定。搬到在场条之后，
 * 它成了全页唯一的状态出口——所以每一条都得单独验，避免优先级阶梯写错（例如
 * `ducked` 被 `thinking` 盖掉，用户就看不到"被打断"）。
 *
 * 单独成文件：主测试已 449 行（预算 500），再塞六条会超。
 */
import { render } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { InterviewVoiceController } from "./useInterviewVoice";
import type { VoiceSessionSnapshot } from "./voiceSession";
import { LiveVoiceRoom } from "./LiveVoiceRoom";

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

function voiceWith(
  patch: Omit<Partial<InterviewVoiceController>, "snapshot"> & {
    snapshot?: Partial<VoiceSessionSnapshot>;
  } = {},
): InterviewVoiceController {
  const base = voice();
  return {
    ...base,
    ...patch,
    snapshot: { ...base.snapshot, ...(patch.snapshot ?? {}) },
  };
}

function renderVoice(v: InterviewVoiceController, speaking = false) {
  return render(room(v, speaking));
}

/** 拆出可复用的一棵 React 树：三态红点需要 `rerender` 到同一个组件上（保留内部标记）。 */
function room(v: InterviewVoiceController, speaking = false) {
  return (
    <AntdApp>
      <LiveVoiceRoom
        voice={v}
        mode="always-on"
        onModeChange={vi.fn()}
        interviewerStyle="严谨专业"
        messages={[]}
        pendingAnswer={null}
        streamingQuestion={null}
        speaking={speaking}
        speechNotice={null}
        onClose={vi.fn()}
      />
    </AntdApp>
  );
}

function pill(): string {
  return document.querySelector(".interview-live-room__status-pill")?.textContent ?? "";
}

function liveDot(): Element | null {
  return document.querySelector(".interview-live-room__live-dot");
}

describe("LiveVoiceRoom 状态胶囊（I-27）", () => {
  it("启动中", () => {
    renderVoice(voiceWith({ starting: true, enabled: true }));
    expect(pill()).toBe(t("interviewVoice.status.starting"));
  });

  it("对方在说", () => {
    renderVoice(voiceWith({ enabled: true }), true);
    expect(pill()).toBe(t("interviewVoice.room.speaking"));
  });

  it("被打断（优先于思考）", () => {
    renderVoice(voiceWith({ enabled: true, snapshot: { ducked: true, thinking: true } }));
    expect(pill()).toBe(t("interviewVoice.status.bargeIn"));
  });

  it("思考中", () => {
    renderVoice(voiceWith({ enabled: true, snapshot: { thinking: true } }));
    expect(pill()).toBe(t("interviewVoice.status.thinking"));
  });

  it("等转写 / 聆听 / 麦克风未开", () => {
    const view = renderVoice(voiceWith({ enabled: true, snapshot: { phase: "waiting-asr" } }));
    expect(pill()).toBe(t("interviewVoice.status.waitingAsr"));
    view.unmount();

    const listening = renderVoice(voiceWith({ enabled: true }));
    expect(pill()).toBe(t("interviewVoice.status.listening"));
    listening.unmount();

    renderVoice(voiceWith());
    expect(pill()).toBe(t("interviewVoice.room.micIdle"));
  });

  it("通话期间给 body 打标，退出后移除（助手浮球随之恢复）", () => {
    const view = renderVoice(voice());
    expect(document.body.dataset.immersive).toBe("interview");
    view.unmount();
    expect(document.body.dataset.immersive).toBeUndefined();
  });
});

/**
 * R3-03：顶栏那颗红点原来是恒亮的装饰（`aria-hidden`，永远红 + 光晕），同一屏的在场条
 * 却写「未开始」。现在三态：未开始 / 通话中 / 已结束，且都有可访问名称。
 */
describe("顶栏通话状态指示点（R3-03）", () => {
  it("还没开过通话 = 未开始", () => {
    renderVoice(voice());
    expect(liveDot()?.classList.contains("is-idle")).toBe(true);
    expect(liveDot()?.getAttribute("role")).toBe("img");
    expect(liveDot()?.getAttribute("aria-label")).toBe(t("interviewVoice.room.liveDotIdle"));
  });

  it("通话中", () => {
    renderVoice(voiceWith({ enabled: true }));
    expect(liveDot()?.classList.contains("is-live")).toBe(true);
    expect(liveDot()?.getAttribute("aria-label")).toBe(t("interviewVoice.room.liveDotLive"));
  });

  it("开过又停了 = 已结束（不残留「通话中」）", () => {
    const view = renderVoice(voiceWith({ enabled: true }));
    view.rerender(room(voice()));
    expect(liveDot()?.classList.contains("is-ended")).toBe(true);
    expect(liveDot()?.getAttribute("aria-label")).toBe(t("interviewVoice.room.liveDotEnded"));
  });
});
