// SPDX-License-Identifier: Apache-2.0
/**
 * 诊断条的 `compact` 变体（#24 24A）：制作台左栏那条常驻状态行。
 *
 * 与 `full` 变体共用同一批 key 与同一条琥珀判据，只是形状收成一行。这里钉三条：
 * 1. 整句状态与「未保存」标签都渲染出来（读屏名与预览卡用同一条 aria key）；
 * 2. **没有可展开内容时不渲染按钮**（点了没反应比不摆更糟）；
 * 3. `lazyContent` 只在打开后构造正文——关着的时候请求方是**未挂载**的，
 *    这正是"拖动滑杆零请求"的实现位置。
 *
 * 本文件不含 CJK 字面量（棘轮对新增中文断言会红）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import ResumeDiagnosticsBar from "./ResumeDiagnosticsBar";

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

const SUMMARY = t("workbench.layoutStatus.summaryOverflow", {
  percent: 426,
  pages: 5,
  limit: 1,
  over: 4,
});
const ARIA = t("resume.diagnostics.aria.diagnosis", { label: SUMMARY });

function renderCompact(diagnosis: React.ComponentProps<typeof ResumeDiagnosticsBar>["diagnosis"]) {
  return render(
    <AntdApp>
      <ResumeDiagnosticsBar variant="compact" diagnosis={diagnosis} />
    </AntdApp>,
  );
}

describe("ResumeDiagnosticsBar · compact", () => {
  it("renders the whole sentence as one line with the unsaved marker", () => {
    const { container } = renderCompact({
      content: null,
      summary: SUMMARY,
      attention: true,
      dirty: true,
    });
    expect(screen.getByText(SUMMARY)).toBeInTheDocument();
    expect(screen.getByText(t("workbench.layoutStatus.unsaved"))).toBeInTheDocument();
    // 琥珀语义由那一颗点承载（与 full 变体同一个类名）。
    expect(container.querySelectorAll(".resume-diagnostics-dot")).toHaveLength(1);
    expect(container.querySelector(".resume-diagnostics-bar.is-compact")).not.toBeNull();
    // 没有可展开内容 → 不许有按钮。
    expect(screen.queryByRole("button")).toBeNull();
  });

  it("hides the marker in a healthy state", () => {
    const { container } = renderCompact({ content: null, summary: SUMMARY });
    expect(screen.queryByText(t("workbench.layoutStatus.unsaved"))).toBeNull();
    expect(container.querySelectorAll(".resume-diagnostics-dot")).toHaveLength(0);
  });

  it("is a real button when there is something to expand", () => {
    renderCompact({ content: <p>diagnosis-body</p>, summary: SUMMARY });
    expect(screen.getByRole("button", { name: ARIA })).toBeInTheDocument();
  });

  it("only builds lazy content once opened (closed = nothing mounted, so no request)", () => {
    const lazyContent = vi.fn((open: boolean) => (open ? <p>lazy-body</p> : null));
    renderCompact({ content: null, summary: SUMMARY, lazyContent });
    // 首帧：工厂被问过一次，但**关着**，所以正文是 null
    expect(lazyContent).toHaveBeenCalledWith(false);
    expect(screen.queryByText("lazy-body")).toBeNull();
    expect(screen.getByRole("button", { name: ARIA })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: ARIA }));
    expect(lazyContent).toHaveBeenCalledWith(true);
    expect(screen.getByText("lazy-body")).toBeInTheDocument();
  });

  it("renders nothing without a diagnosis entry", () => {
    const { container } = renderCompact(null);
    expect(container.querySelector(".resume-diagnostics-bar")).toBeNull();
  });
});
