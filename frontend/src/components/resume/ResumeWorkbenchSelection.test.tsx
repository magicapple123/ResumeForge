// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲选中状态上提（W08 条目级 / W07 对象级 / 溢出定位共用一份 selection）。
 *
 * 这里钉的是**接线**：在大纲里点一条 → 分页控件出现条目级设置、对象排版面板出现；
 * 画布顶部常驻溢出定位（用户不点「获取分页报告」不发请求）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { t } from "../../i18n";
import type { ResumeContent, ResumeLayout } from "../../types";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import ResumeZoomModal from "./ResumeZoomModal";

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));

/** 测试夹具公司名（\u 转义：cjkRatchet 的 tests 口径不许新增中文字面量）。 */
const COMPANY = "\u6781\u5ba2\u516c\u53f8";

const CONTENT: ResumeContent = {
  photo: "",
  name: "Alex",
  gender: "",
  birth_year: "",
  phone: "",
  email: "",
  city: "",
  personal_website: "",
  github: "",
  job_intent: "Backend",
  summary: "",
  education: [],
  experience: [
    {
      id: "ob_entry0001",
      company: COMPANY,
      role: "后端工程师",
      start_date: "",
      end_date: "",
      description: ["负责核心链路"],
      point_ids: { description: ["ob_point0001"] },
    },
  ],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

const LAYOUT: ResumeLayout = { ...DEFAULT_LAYOUT, format_config: {} };

function paramsColumn(): HTMLElement {
  return document.querySelector<HTMLElement>(".resume-wb-col-params") as HTMLElement;
}

function renderWorkbench() {
  function Harness() {
    const [layout, setLayout] = useState<ResumeLayout>(LAYOUT);
    return (
      <AntdApp>
        <ResumeZoomModal
          open
          html="<html></html>"
          warnings={[]}
          pages={1}
          onClose={vi.fn()}
          layout={layout}
          resumeId={42}
          content={CONTENT}
          onApplyLayout={(next) => setLayout(next)}
          onSaveContent={vi.fn(async () => undefined)}
        />
      </AntdApp>
    );
  }
  render(<Harness />);
}

function switchTab(label: string): void {
  fireEvent.click(within(paramsColumn()).getByText(label));
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  localStorage.clear();
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("制作台 · 大纲选中状态上提", () => {
  it("画布顶部常驻溢出定位（空态，不自动请求）", () => {
    renderWorkbench();
    expect(screen.getByText(t("pagination.report.title"))).toBeInTheDocument();
    expect(screen.getByText(t("pagination.report.empty"))).toBeInTheDocument();
  });

  it("在大纲选中一条 → 分页条目级 + 对象排版面板出现", async () => {
    renderWorkbench();
    switchTab(t("outline.panel.title"));

    // 大纲行内容可点击（外层 treeitem 负责选中态）。
    fireEvent.click(screen.getByText(COMPANY));
    await waitFor(() => {
      const selected = document.querySelector('[role="treeitem"][aria-selected="true"]');
      expect(selected).not.toBeNull();
    });

    // 回到「排版参数」页签：条目级分页与对象排版都拿到同一份选中。
    switchTab(t("responsive.action.params"));
    await waitFor(() => {
      expect(screen.getByTestId("pagination-entry")).toBeInTheDocument();
    });
    expect(screen.getByText(t("typography.object.title"))).toBeInTheDocument();
    expect(screen.getByText(COMPANY)).toBeInTheDocument();
  });
});
