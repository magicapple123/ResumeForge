// SPDX-License-Identifier: Apache-2.0
import { App as AntdApp } from "antd";
import { fireEvent, render, screen, waitFor } from "@testing-library/react";
import { beforeEach, describe, expect, it, vi } from "vitest";

const requestMock = vi.hoisted(() => vi.fn());
vi.mock("../../api/client", () => ({ request: requestMock }));

import { t } from "../../i18n";
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
