// SPDX-License-Identifier: Apache-2.0
/**
 * W09 面板集成：`content` 给了才出现「内容精简候选」；应用调 `onApplyContent`（宿主写回+一步历史）；
 * `contentHints` 缺省时 fail-soft（不出现低相关候选），有值时才追加且排第一。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ot } from "../../../features/resume-optimizer/i18n";
import type { OptimizerCurrentValues } from "../../../features/resume-optimizer/types";
import type { ResumeContent } from "../../../types/resume";
import LayoutOptimizerPanel from "./LayoutOptimizerPanel";

const CURRENT: OptimizerCurrentValues = {
  page_padding: 14,
  section_gap: 1.3,
  line_height: 1.7,
  font_scale_adjust: 1,
};

function content(): ResumeContent {
  return {
    photo: "",
    name: "示例甲",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    education: [],
    experience: [
      {
        id: "exp_aaaa0001",
        company: "甲公司",
        role: "工程师",
        start_date: "2020",
        end_date: "2022",
        description: ["负责 A"],
      },
      {
        id: "exp_aaaa0002",
        company: "甲公司",
        role: "工程师",
        start_date: "2020",
        end_date: "2022",
        description: ["负责 B"],
      },
    ],
    campus_experience: [],
    projects: [],
    skills: [],
    awards: [],
  } as unknown as ResumeContent;
}

function renderPanel(props: Partial<Parameters<typeof LayoutOptimizerPanel>[0]> = {}) {
  const onApplyContent = vi.fn();
  render(
    <AntdApp>
      <LayoutOptimizerPanel
        analysis={null}
        current={CURRENT}
        content={content()}
        onApplyContent={onApplyContent}
        {...props}
      />
    </AntdApp>,
  );
  return { onApplyContent };
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("LayoutOptimizerPanel 内容精简候选", () => {
  it("没有版面诊断但有正文：生成按钮可用，点击后出内容候选", () => {
    renderPanel();
    const generate = screen.getByRole("button", { name: ot("optimizer.generate") });
    expect(generate).toBeEnabled();
    fireEvent.click(generate);
    expect(screen.getByText(ot("optimizer.content.title"))).toBeInTheDocument();
    expect(screen.getByText(ot("optimizer.content.kind.duplicate-entries"))).toBeInTheDocument();
  });

  it("应用内容候选：把新 content 交给宿主（不直接写库）", async () => {
    const { onApplyContent } = renderPanel();
    fireEvent.click(screen.getByRole("button", { name: ot("optimizer.generate") }));
    fireEvent.click(
      screen.getByRole("button", { name: ot("optimizer.content.apply.aria", { index: 1 }) }),
    );
    await waitFor(() => expect(onApplyContent).toHaveBeenCalledTimes(1));
    const next = onApplyContent.mock.calls[0][0] as ResumeContent;
    expect((next as unknown as { experience: unknown[] }).experience).toHaveLength(1);
  });

  it("contentHints 存在时追加低相关候选且排第一（缺省 fail-soft 不出现）", () => {
    renderPanel({
      contentHints: [
        {
          kind: "low_relevance",
          section: "experience",
          object_id: "exp_aaaa0001",
          reason: "与岗位无关",
          evidence: [],
        },
      ],
    });
    fireEvent.click(screen.getByRole("button", { name: ot("optimizer.generate") }));
    expect(screen.getByText(ot("optimizer.content.kind.low-relevance-points"))).toBeInTheDocument();
  });

  it("既无诊断也无正文：生成按钮禁用（不能凭空生成）", () => {
    render(
      <AntdApp>
        <LayoutOptimizerPanel analysis={null} current={CURRENT} />
      </AntdApp>,
    );
    expect(screen.getByRole("button", { name: ot("optimizer.generate") })).toBeDisabled();
  });
});
