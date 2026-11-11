// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台左栏**版面状态条**（#24 24A / 24C）。
 *
 * 钉四条性质，全部来自 #24 的三条一致性约束：
 * 1. **拖动时零请求**：测量一变就只重算本地数字；`/layout/analyze` 一次都不许发
 *    （关着弹层时诊断卡根本没挂载——`lazyContent`）。这是"别在 onChange 里请求后端"的可测面。
 * 2. **点开才请求**，且请求带的是**当前草稿版式**（不是记录里存的那一份）。
 * 3. **文案与预览卡同一份**：状态句与徽标都走 `layoutStatusSummary` 的 key，测试直接拿同一个
 *    `t()` 组装期望值——组件一旦另写一套句子，这里立刻红。
 * 4. **未保存标记**：版式与打开那一刻不同才出现；相同就不许出现（否则用户以为没保存上）。
 *
 * 本文件不含 CJK 字面量（棘轮对新增中文断言会红）。
 */
import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { createRef } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import type { ResumeLayout } from "../../types";
import type { LayoutMeasure } from "../../utils/resumeLayoutMeasure";
import type { ResumeLayoutAnalysis } from "../../types";
import type { ResumePreviewHandle } from "../ResumePreview";
import WorkbenchLayoutStatusBar from "./WorkbenchLayoutStatusBar";
import { resetWorkbenchLayout, syncWorkbenchLayout } from "./workbenchLayoutStore";

const mocks = vi.hoisted(() => ({
  analyze: vi.fn(),
  updateLayout: vi.fn(),
}));

vi.mock("../../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/resumes")>()),
  analyzeResumeLayout: mocks.analyze,
  updateResumeLayout: mocks.updateLayout,
}));

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  language: "zh-CN",
  format_config: {},
};

const MEASURE: LayoutMeasure = { usedHeight: 5000, pageContentHeight: 1000, pageLimit: 1 };

const ANALYSIS = {
  diagnosis: {
    status: "overflow",
    status_label: "OVERFLOW",
    fill: 5,
    summary: "too much",
    suggestions: [],
  },
  fit_ladder: [],
} as unknown as ResumeLayoutAnalysis;

const SUMMARY = t("workbench.layoutStatus.summaryOverflow", {
  percent: 500,
  pages: 5,
  limit: 1,
  over: 4,
});

function renderBar(overrides: Partial<React.ComponentProps<typeof WorkbenchLayoutStatusBar>> = {}) {
  const previewRef = createRef<ResumePreviewHandle>();
  const onApplyLayout = vi.fn();
  const view = render(
    <AntdApp>
      <WorkbenchLayoutStatusBar
        layout={LAYOUT}
        baseline={LAYOUT}
        resumeId={7}
        previewRef={previewRef}
        onApplyLayout={onApplyLayout}
        {...overrides}
      />
    </AntdApp>,
  );
  return { ...view, onApplyLayout };
}

/** 画布上报测量（等价于右栏重排完一次）。页数留给本地推算（服务端报告另有用例覆盖）。 */
function publish(measure: LayoutMeasure | null, overflow = false) {
  act(() => {
    syncWorkbenchLayout({ measure, layoutStatus: measure ? { pages: 1, overflow } : null });
  });
}

beforeEach(() => {
  mocks.analyze.mockReset();
  mocks.analyze.mockResolvedValue(ANALYSIS);
  mocks.updateLayout.mockReset();
  resetWorkbenchLayout();
});

afterEach(() => {
  cleanup();
  resetWorkbenchLayout();
  document.body.innerHTML = "";
});

describe("WorkbenchLayoutStatusBar", () => {
  it("says it is measuring before the canvas reports anything", () => {
    renderBar();
    expect(screen.getByText(t("workbench.layoutStatus.measuring"))).toBeInTheDocument();
    // 没有测量就没有可展开的内容：这一行必须是**不可点**的，别摆一颗点了没反应的按钮。
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("shows the same sentence as the preview card, and raises amber past 100%", () => {
    const { container } = renderBar();
    publish(MEASURE);
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(container.querySelectorAll(".resume-diagnostics-dot")).toHaveLength(1);
  });

  it("stays neutral and dot-free while the page fits", () => {
    const { container } = renderBar();
    publish({ usedHeight: 900, pageContentHeight: 1000, pageLimit: 1 });
    expect(
      screen.getByText(t("workbench.layoutStatus.summary", { percent: 90, pages: 1, limit: 1 })),
    ).toBeInTheDocument();
    expect(container.querySelectorAll(".resume-diagnostics-dot")).toHaveLength(0);
  });

  it("never asks the backend while the popover stays closed (dragging a slider)", async () => {
    renderBar();
    publish(MEASURE);
    // 再拖两次：测量变了，但弹层没开过
    publish({ usedHeight: 6000, pageContentHeight: 1000, pageLimit: 1 });
    publish({ usedHeight: 4000, pageContentHeight: 1000, pageLimit: 1 });
    expect(mocks.analyze).not.toHaveBeenCalled();
  });

  it("opens the same diagnosis card on click and only then calls /layout/analyze", async () => {
    renderBar();
    publish(MEASURE);
    fireEvent.click(
      screen.getByRole("button", {
        name: t("resume.diagnostics.aria.diagnosis", { label: SUMMARY }),
      }),
    );
    await waitFor(() => expect(mocks.analyze).toHaveBeenCalledTimes(1));
    // 请求带的是**当前草稿版式** + 本地测量（诊断看的是屏幕上这一版）。
    expect(mocks.analyze.mock.calls[0][2]).toMatchObject({ page_limit: 1, template: "classic" });
    expect(mocks.analyze.mock.calls[0][1]).toMatchObject({
      used_height: MEASURE.usedHeight,
      page_content_height: MEASURE.pageContentHeight,
      page_limit: 1,
    });
  });

  it("marks the figures as unsaved only when the draft layout differs", () => {
    const { rerender } = renderBar();
    publish(MEASURE);
    expect(screen.queryByText(t("workbench.layoutStatus.unsaved"))).toBeNull();

    rerender(
      <AntdApp>
        <WorkbenchLayoutStatusBar
          layout={{ ...LAYOUT, font_scale: "large" }}
          baseline={LAYOUT}
          resumeId={7}
          previewRef={createRef<ResumePreviewHandle>()}
          onApplyLayout={vi.fn()}
        />
      </AntdApp>,
    );
    expect(screen.getByText(t("workbench.layoutStatus.unsaved"))).toBeInTheDocument();
  });

  it("clears the unsaved marker once the record revision moves without a layout change", () => {
    const view = renderBar();
    publish(MEASURE);
    // 改版式 → 出现「未保存」
    view.rerender(
      <AntdApp>
        <WorkbenchLayoutStatusBar
          layout={{ ...LAYOUT, font_scale: "large" }}
          baseline={LAYOUT}
          resumeId={7}
          revision={3}
          previewRef={createRef<ResumePreviewHandle>()}
          onApplyLayout={vi.fn()}
        />
      </AntdApp>,
    );
    expect(screen.getByText(t("workbench.layoutStatus.unsaved"))).toBeInTheDocument();

    // 保存成功：revision 前进，版式没变 → 标记消失（验收判据"保存后该标记消失"）
    view.rerender(
      <AntdApp>
        <WorkbenchLayoutStatusBar
          layout={{ ...LAYOUT, font_scale: "large" }}
          baseline={LAYOUT}
          resumeId={7}
          revision={4}
          previewRef={createRef<ResumePreviewHandle>()}
          onApplyLayout={vi.fn()}
        />
      </AntdApp>,
    );
    expect(screen.queryByText(t("workbench.layoutStatus.unsaved"))).toBeNull();
  });

  it("accepts a host-provided dirty flag (the body draft the shell owns)", () => {
    renderBar({ dirty: true });
    publish(MEASURE);
    expect(screen.getByText(t("workbench.layoutStatus.unsaved"))).toBeInTheDocument();
  });

  it("falls back to a plain status line when there is no record id", () => {
    renderBar({ resumeId: null });
    publish(MEASURE);
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(screen.queryByRole("button")).toBeNull();
  });
});
