// SPDX-License-Identifier: Apache-2.0
/**
 * 结束后的追问区（#41）：**不占正式轮次**。
 *
 * 组件层面能钉住的部分：
 * 1. 头部一直写着"追问不占正式轮次，也不计入评分报告"（用户必须能一眼看到这条规则）；
 * 2. 只渲染 `phase="followup"` 的消息——正式问答不在这里重复；
 * 3. 提交后**原样采用服务端回传的会话**，不自己 +1 轮次（会不会被追问带偏，取决于
 *    这里有没有"顺手加一轮"的臆想；服务端已经保证 answered_rounds 只数正式问答）。
 *
 * 断言一律用 `t()` 或 role 定位（不用中文 `*ByText`）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { InterviewDetail, InterviewMessage } from "../../types";
import { FollowUpCard } from "./FollowUpCard";

const interviewMocks = vi.hoisted(() => ({
  submitInterviewFollowUp: vi.fn(),
  updateInterviewFollowUpState: vi.fn(),
}));
vi.mock("../../api/interview", () => interviewMocks);

function message(overrides: Partial<InterviewMessage>): InterviewMessage {
  return {
    id: 1,
    role: "interviewer",
    phase: "interview",
    content: "",
    context: {},
    status: "complete",
    error: "",
    created_at: "2026-11-01T10:00:00Z",
    ...overrides,
  };
}

function finishedSession(messages: InterviewMessage[]): InterviewDetail {
  return {
    id: 7,
    title: "后端开发 模拟面试",
    job_id: 1,
    job_title: "后端开发工程师",
    company: "示例公司",
    resume_id: 2,
    resume_title: "后端版简历",
    duration_seconds: 600,
    interview_type: "技术面",
    difficulty: "中级",
    interviewer_style: "严谨专业",
    rounds: 3,
    rounds_min: null,
    status: "finished",
    created_at: "2026-11-01T10:00:00Z",
    updated_at: "2026-11-01T10:30:00Z",
    answered_rounds: 1,
    persona: "",
    focus: "",
    model: "test-model",
    report: { score: 78 },
    messages,
  };
}

function renderCard(session: InterviewDetail) {
  const onSession = vi.fn();
  render(
    <AntdApp>
      <FollowUpCard session={session} onSession={onSession} />
    </AntdApp>,
  );
  return { onSession };
}

beforeEach(() => {
  for (const mock of Object.values(interviewMocks)) mock.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("追问区", () => {
  it("始终说明追问不占正式轮次", () => {
    renderCard(finishedSession([message({ id: 1, content: "Q1 self intro" })]));

    expect(screen.getByText(t("interviewPage.followUp.hint"))).toBeInTheDocument();
  });

  it("只展示追问阶段的消息，正式问答不重复渲染", () => {
    renderCard(
      finishedSession([
        message({ id: 1, role: "interviewer", content: "Q1 self intro" }),
        message({ id: 2, role: "user", content: "I am Alex", phase: "interview" }),
        message({ id: 3, role: "user", content: "what did I miss", phase: "followup" }),
        message({ id: 4, role: "interviewer", content: "capacity planning", phase: "followup" }),
      ]),
    );

    expect(screen.getByText("what did I miss")).toBeInTheDocument();
    expect(screen.getByText("capacity planning")).toBeInTheDocument();
    expect(screen.queryByText("I am Alex")).toBeNull();
    expect(screen.queryByText("Q1 self intro")).toBeNull();
  });

  it("没有追问时给出空状态", () => {
    renderCard(finishedSession([message({ id: 1, content: "Q1 self intro" })]));

    expect(screen.getByText(t("interviewPage.followUp.empty"))).toBeInTheDocument();
  });

  it("提交追问后原样采用服务端回传的会话（轮次一个都不多）", async () => {
    const base = finishedSession([message({ id: 1, content: "Q1 self intro" })]);
    // 服务端回的是"同一场已结束的面试 + 两条追问消息"，answered_rounds 仍是 1。
    const afterServer = {
      ...base,
      messages: [
        ...base.messages,
        message({ id: 5, role: "user", content: "how to fix", phase: "followup" }),
        message({ id: 6, role: "interviewer", content: "capacity estimate", phase: "followup" }),
      ],
    };
    interviewMocks.submitInterviewFollowUp.mockResolvedValue({
      session: afterServer,
      answer: "capacity estimate",
    });
    const { onSession } = renderCard(base);

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "how to fix" } });
    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewPage.followUp.submit")) }),
    );

    await waitFor(() => expect(onSession).toHaveBeenCalled());
    expect(interviewMocks.submitInterviewFollowUp).toHaveBeenCalledWith(7, "how to fix");
    const received = onSession.mock.calls[0][0] as InterviewDetail;
    expect(received.answered_rounds).toBe(1);
    expect(received.status).toBe("finished");
  });

  it("空输入不触发请求", () => {
    renderCard(finishedSession([message({ id: 1, content: "Q1 self intro" })]));

    fireEvent.change(screen.getByRole("textbox"), { target: { value: "   " } });

    expect(interviewMocks.submitInterviewFollowUp).not.toHaveBeenCalled();
  });

  it("默认开放：头部有「停止追问」，输入框可用", () => {
    renderCard(
      finishedSession([message({ id: 3, role: "interviewer", content: "q", phase: "followup" })]),
    );

    expect(
      screen.getByRole("button", { name: new RegExp(t("interviewPage.followUp.stop")) }),
    ).toBeInTheDocument();
    expect(screen.getByRole("textbox")).not.toBeDisabled();
  });

  it("点「停止追问」后采用服务端回传的会话，输入框收起", async () => {
    const base = finishedSession([message({ id: 1, content: "Q1 self intro" })]);
    const closed = { ...base, follow_up_closed_at: "2026-11-01T11:00:00Z" };
    interviewMocks.updateInterviewFollowUpState.mockResolvedValue(closed);
    const { onSession } = renderCard(base);

    fireEvent.click(
      screen.getByRole("button", { name: new RegExp(t("interviewPage.followUp.stop")) }),
    );

    await waitFor(() => expect(onSession).toHaveBeenCalledWith(closed));
    expect(interviewMocks.updateInterviewFollowUpState).toHaveBeenCalledWith(7, true);
  });

  it("已停止时不再渲染输入框，只留「继续追问」与说明", () => {
    renderCard({
      ...finishedSession([message({ id: 1, content: "Q1 self intro" })]),
      follow_up_closed_at: "2026-11-01T11:00:00Z",
    });

    expect(
      screen.getByRole("button", { name: new RegExp(t("interviewPage.followUp.resume")) }),
    ).toBeInTheDocument();
    expect(screen.queryByRole("textbox")).toBeNull();
    expect(screen.getByText(t("interviewPage.followUp.closedHint"))).toBeInTheDocument();
  });

  it("上一次追问还没答完时不再放行第二次提交", () => {
    renderCard(
      finishedSession([
        message({ id: 3, role: "user", content: "waiting for answer", phase: "followup" }),
      ]),
    );

    expect(screen.getByRole("textbox")).toBeDisabled();
  });
});
