// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../api/client", () => ({ request: requestMock }));

import { t } from "../../i18n";
import { rt } from "../../features/resume-research/i18n";
import type { ResumeDetail, ResumeLayout } from "../../types";
import DocumentModePanel from "./DocumentModePanel";

function layout(): ResumeLayout {
  return {
    template: "classic",
    format_name: "",
    page_limit: 1,
    font_scale: "standard",
    language: "zh-CN",
  };
}

function detail(pageLimit = 2): ResumeDetail {
  return { id: 7, page_limit: pageLimit } as unknown as ResumeDetail;
}

function renderPanel(ui: React.ReactNode) {
  return render(<AntdApp>{ui}</AntdApp>);
}

describe("DocumentModePanel · 文档模式保存", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  it("没有记录 id 时不渲染模式控件（只读宿主没有保存落点）", () => {
    renderPanel(<DocumentModePanel resumeId={null} layout={layout()} onChange={vi.fn()} />);
    expect(screen.queryByText(t("research.mode.label"))).toBeNull();
  });

  it("切到长 CV 走 PATCH /layout 条件写，并回写后端夹紧后的页数", async () => {
    requestMock.mockResolvedValue(detail(2));
    const onChange = vi.fn();
    const onSaved = vi.fn();
    renderPanel(
      <DocumentModePanel
        resumeId={7}
        revision={5}
        documentMode="resume"
        layout={layout()}
        onChange={onChange}
        onSaved={onSaved}
      />,
    );
    expect(screen.getByText(t("research.mode.label"))).toBeInTheDocument();
    fireEvent.click(screen.getByText(t("research.mode.longCv")));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    const [path, init] = requestMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(path).toBe("/resumes/7/layout");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.document_mode).toBe("long_cv");
    expect(body.expected_revision).toBe(5);
    await waitFor(() => expect(onSaved).toHaveBeenCalledWith(detail(2)));
    expect(onChange).toHaveBeenCalledWith({ ...layout(), page_limit: 2 });
  });

  it("页数没被夹紧时不额外触发 onChange", async () => {
    requestMock.mockResolvedValue(detail(1));
    const onChange = vi.fn();
    renderPanel(
      <DocumentModePanel
        resumeId={7}
        revision={5}
        documentMode="resume"
        layout={layout()}
        onChange={onChange}
      />,
    );
    fireEvent.click(screen.getByText(t("research.mode.longCv")));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(onChange).not.toHaveBeenCalled();
  });

  it("保存失败不调用 onSaved / onChange（错误由面板 toast）", async () => {
    requestMock.mockRejectedValue(new Error("layout conflict"));
    const onChange = vi.fn();
    const onSaved = vi.fn();
    renderPanel(
      <DocumentModePanel resumeId={7} layout={layout()} onChange={onChange} onSaved={onSaved} />,
    );
    fireEvent.click(screen.getByText(t("research.mode.longCv")));
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    expect(onSaved).not.toHaveBeenCalled();
    expect(onChange).not.toHaveBeenCalled();
  });
});

/**
 * 「不限篇幅」（0）在制作台里必须是**选得到、且不会被夹成 1 页**的一档。
 *
 * 缺陷族：所有把 0 当"没填"的地方，最后都表现为"用户选了不限，界面上却是 1 页"。
 * 这里从控件读起：选项里有「不限」→ 选中它 → PATCH 的 body 里 `page_limit` 是 0。
 */
describe("DocumentModePanel · 「不限篇幅」档", () => {
  beforeEach(() => {
    requestMock.mockReset();
  });

  /** 打开「篇幅上限」下拉，返回其中「不限」那一项。 */
  async function openLimitSelect() {
    const combobox = screen.getByRole("combobox", { name: rt("research.mode.limitLabel") });
    fireEvent.mouseDown(combobox);
    return screen.findByText(t("sections.templateControls.pageLimitUnlimited"));
  }

  it("选项里有「不限」，选了它就按 page_limit: 0 落库", async () => {
    requestMock.mockResolvedValue(detail(0));
    const onChange = vi.fn();
    renderPanel(
      <DocumentModePanel
        resumeId={7}
        revision={5}
        documentMode="resume"
        layout={layout()}
        onChange={onChange}
      />,
    );

    const unlimited = await openLimitSelect();
    fireEvent.click(unlimited);
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));

    const [path, init] = requestMock.mock.calls[0] as [string, { method: string; body: string }];
    expect(path).toBe("/resumes/7/layout");
    expect(init.method).toBe("PATCH");
    const body = JSON.parse(init.body) as Record<string, unknown>;
    expect(body.page_limit).toBe(0);
    expect(body.document_mode).toBe("resume");
    // 后端回 0：草稿按后端的真实值回写（0 也是"真实值"，不能被当成"没变"而吞掉）。
    await waitFor(() => expect(onChange).toHaveBeenCalledWith({ ...layout(), page_limit: 0 }));
  });

  it("记录就是 0 时控件显示「不限」，不被夹成 1 页", () => {
    renderPanel(
      <DocumentModePanel
        resumeId={7}
        documentMode="resume"
        layout={{ ...layout(), page_limit: 0 }}
        onChange={vi.fn()}
      />,
    );
    const combobox = screen.getByRole("combobox", { name: rt("research.mode.limitLabel") });
    expect(combobox.closest(".ant-select")).toHaveTextContent(
      t("sections.templateControls.pageLimitUnlimited"),
    );
    expect(combobox.closest(".ant-select")).not.toHaveTextContent(
      t("sections.templateControls.pageLimitPages", { count: 1 }),
    );
  });

  it("选了「不限」不会触发超出上限的警告（0 没有上限可比）", async () => {
    requestMock.mockResolvedValue(detail(0));
    renderPanel(
      <DocumentModePanel
        resumeId={7}
        documentMode="resume"
        layout={layout()}
        pagesNeeded={6}
        onChange={vi.fn()}
      />,
    );
    const unlimited = await openLimitSelect();
    fireEvent.click(unlimited);
    await waitFor(() => expect(requestMock).toHaveBeenCalledTimes(1));
    // 面板里只有宿主传进来的 pagesNeeded，警告文案来自 DocumentModeSwitch；
    // 选中后 Select 必须停在「不限」，而不是弹一句"约需 6 页 / 上限 0 页"。
    expect(screen.queryByText(rt("research.mode.overBudget", { pages: 6, limit: 0 }))).toBeNull();
  });
});
