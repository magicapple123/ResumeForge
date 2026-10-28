// SPDX-License-Identifier: Apache-2.0
/**
 * W09 内容精简候选在**真实诊断卡**里的接线（fe-mount C）：
 * 卡把"当前正文"交给优化器；应用候选时把新正文交给宿主（宿主写回 + 一步历史），
 * 面板自己不直接调接口；后端未下发 content_hints 时只生成正文类候选（fail-soft）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { ot } from "../../features/resume-optimizer/i18n";
import type { ResumeContent } from "../../types";
import type { ResumePreviewHandle } from "../ResumePreview";
import ResumeLayoutDiagnosisCard from "./ResumeLayoutDiagnosisCard";

const apiMocks = vi.hoisted(() => ({
  analyzeResumeLayout: vi.fn(),
  updateResumeLayout: vi.fn(),
}));

vi.mock("../../api/resumes", () => apiMocks);

const CONTENT = {
  photo: "",
  name: "Ada",
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
    { id: "exp_duplicate01", company: "Acme", role: "Engineer", description: ["First bullet"] },
    { id: "exp_duplicate02", company: "Acme", role: "Engineer", description: ["Second bullet"] },
  ],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
} as unknown as ResumeContent;

const LAYOUT = {
  template: "elegant",
  format_name: "",
  page_limit: 1,
  font_scale: "standard" as const,
};
const MEASURE = { usedHeight: 2800, pageContentHeight: 2600, pageLimit: 1 };

function previewRef() {
  const ref = createRef<ResumePreviewHandle>();
  (ref as { current: ResumePreviewHandle | null }).current = {
    measureWithProbe: () => null,
    setLiveProbe() {},
  };
  return ref;
}

beforeEach(() => {
  apiMocks.analyzeResumeLayout.mockReset();
  apiMocks.updateResumeLayout.mockReset();
  apiMocks.analyzeResumeLayout.mockResolvedValue({
    diagnosis: {
      status: "overflow",
      status_label: "Overflow",
      summary: "Needs two pages.",
      fill: 1.2,
      pages_needed: 2,
      page_limit: 1,
      pages: [],
      suggestions: [],
    },
    fit_ladder: [],
    fit_room: {
      has_room: false,
      steps: 0,
      font_floor_px: 11,
      font_adjust_floor: 0.9,
      font_floor_note: "Floor.",
    },
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("诊断卡 · 内容精简候选", () => {
  it("生成候选 → 应用把新正文交给宿主一次（不直接写库）", async () => {
    const onApplyContent = vi.fn<(next: ResumeContent) => Promise<void>>(async () => undefined);
    render(
      <AntdApp>
        <ResumeLayoutDiagnosisCard
          resumeId={7}
          measure={MEASURE}
          overflow
          previewRef={previewRef()}
          layout={LAYOUT}
          onApplied={vi.fn()}
          onAddPage={vi.fn()}
          content={CONTENT}
          onApplyContent={onApplyContent}
        />
      </AntdApp>,
    );

    // 详情默认收起（2026-10-28）：优化候选在"详情"里，先展开再点它的开关。
    const expand = screen.getByRole("button", { name: t("resume.diagnosis.expand") });
    fireEvent.click(expand);
    fireEvent.click(screen.getByRole("button", { name: ot("optimizer.generate") }));
    // 正文类候选不依赖诊断：重复条目会被列出来。
    expect(
      await screen.findByText(ot("optimizer.content.kind.duplicate-entries")),
    ).toBeInTheDocument();
    fireEvent.click(
      screen.getByRole("button", { name: ot("optimizer.content.apply.aria", { index: 1 }) }),
    );

    await waitFor(() => expect(onApplyContent).toHaveBeenCalledTimes(1));
    const next = onApplyContent.mock.calls[0][0];
    expect(next.experience).toHaveLength(1);
    expect((next.experience[0] as { id?: string }).id).toBe("exp_duplicate01");
    // 面板自己不写库：只走宿主的写回回调。
    expect(apiMocks.updateResumeLayout).not.toHaveBeenCalled();
    expect(await screen.findByText(ot("optimizer.content.applied"))).toBeInTheDocument();
  });
});
