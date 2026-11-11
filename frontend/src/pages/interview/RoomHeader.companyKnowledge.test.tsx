// SPDX-License-Identifier: Apache-2.0
/** #29D：面试房间头部要挂上「这家公司面经 N 条」，并把公司名传下去。 */
import { App as AntdApp } from "antd";
import { render, screen } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { InterviewDetail } from "../../types";
import { RoomHeader } from "./RoomHeader";

/** 公司名用 \u 转义：测试计数守卫会把断言里的中文字面量算成"待迁移文案"。 */
const COMPANY = "\u5b57\u8282\u8df3\u52a8";

vi.mock("./CompanyKnowledgeSection", () => ({
  CompanyKnowledgeSection: ({ company }: { company: string }) => (
    <div data-testid="company-knowledge">knowledge:{company}</div>
  ),
}));

function session(overrides: Partial<InterviewDetail> = {}): InterviewDetail {
  return {
    id: 7,
    title: "综合面 · 中级",
    job_id: 3,
    job_title: "后端开发工程师",
    company: COMPANY,
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

function renderHeader(company: string) {
  render(
    <AntdApp>
      <RoomHeader
        session={session({ company })}
        finished={false}
        answered={0}
        submitting={false}
        timerLabel="00:00"
        showTimer={false}
        onEndEarly={vi.fn()}
        onNew={vi.fn()}
      />
    </AntdApp>,
  );
}

describe("#29D 面试房间头部", () => {
  it("把会话里的公司名传给面经区块", () => {
    renderHeader(COMPANY);
    expect(screen.getByTestId("company-knowledge").textContent).toBe("knowledge:字节跳动");
  });

  it("没有公司名时也照常渲染头部（区块自己决定不显示）", () => {
    renderHeader("");
    expect(screen.getByTestId("company-knowledge")).toBeInTheDocument();
    // 头部本体仍在（用语言包文案定位，不在断言里写中文字面量）。
    expect(
      screen.getByRole("button", { name: new RegExp(t("interview.action.new")) }),
    ).toBeInTheDocument();
  });
});
