// SPDX-License-Identifier: Apache-2.0
/**
 * Q2：面试房间的「暂停」入口。
 *
 * 两条断言对应两个真实退化：
 * 1. 暂停按钮在 `finished` 后仍然渲染 —— 报告页上点一下会停掉一个已经结束的计时器；
 * 2. 闸门卡没有 `paused` 口径 —— 暂停后仍显示「Jane 已就位，准备好了吗？」，读起来像没开始。
 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { InterviewDetail } from "../../types";
import { ReadyGate } from "./ReadyGate";
import { RoomHeader } from "./RoomHeader";

// 面经区块会读路由与接口（#29D），这里的断言与它无关——同 RoomHeader.companyKnowledge.test.tsx 的做法打桩掉。
vi.mock("./CompanyKnowledgeSection", () => ({
  CompanyKnowledgeSection: () => null,
}));

function session(overrides: Partial<InterviewDetail> = {}): InterviewDetail {
  return {
    id: 7,
    title: "综合面 · 中级",
    job_id: 3,
    job_title: "后端开发工程师",
    company: "",
    resume_id: 5,
    resume_title: "后端版简历",
    duration_seconds: 0,
    interview_type: "综合面",
    difficulty: "中级",
    interviewer_style: "严谨专业",
    rounds: 6,
    rounds_min: null,
    status: "active",
    created_at: "2026-01-01T00:00:00",
    updated_at: "2026-01-01T00:00:00",
    answered_rounds: 0,
    persona: "",
    focus: "",
    model: "test-model",
    report: {},
    messages: [],
    ...overrides,
  };
}

function renderHeader(props: { finished?: boolean; onPause?: () => void }) {
  render(
    <AntdApp>
      <RoomHeader
        session={session()}
        finished={props.finished ?? false}
        answered={0}
        submitting={false}
        timerLabel="00:12"
        showTimer
        onPause={props.onPause}
        onEndEarly={vi.fn()}
        onNew={vi.fn()}
      />
    </AntdApp>,
  );
}

describe("Q2 面试暂停", () => {
  it("进行中渲染暂停按钮，点一次回调一次", () => {
    const onPause = vi.fn();
    renderHeader({ onPause });
    const button = screen.getByRole("button", { name: t("interviewPage.paused.action") });
    button.click();
    expect(onPause).toHaveBeenCalledTimes(1);
  });

  it("面试结束后不再渲染暂停按钮（报告页上暂停没有意义）", () => {
    renderHeader({ finished: true, onPause: vi.fn() });
    expect(
      screen.queryByRole("button", { name: t("interviewPage.paused.action") }),
    ).not.toBeInTheDocument();
  });

  it("闸门卡 paused 口径给的是「已暂停」标题与「继续面试」，不是「准备好了」", () => {
    render(
      <AntdApp>
        <ReadyGate mode="paused" onReady={vi.fn()} onResume={vi.fn()} />
      </AntdApp>,
    );
    expect(screen.getByText(t("interviewPage.paused.title"))).toBeInTheDocument();
    expect(
      screen.getByRole("button", { name: new RegExp(t("interviewPage.paused.resume")) }),
    ).toBeInTheDocument();
    expect(screen.queryByText(t("interviewPage.ready.title"))).not.toBeInTheDocument();
  });

  it("暂停态点「继续面试」只走 onResume，不走 onReady（F13）", () => {
    const onReady = vi.fn();
    const onResume = vi.fn();
    render(
      <AntdApp>
        <ReadyGate mode="paused" onReady={onReady} onResume={onResume} />
      </AntdApp>,
    );
    screen.getByRole("button", { name: new RegExp(t("interviewPage.paused.resume")) }).click();
    expect(onResume).toHaveBeenCalledTimes(1);
    expect(onReady).not.toHaveBeenCalled();
  });
});
