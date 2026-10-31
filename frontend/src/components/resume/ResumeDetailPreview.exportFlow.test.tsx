// SPDX-License-Identifier: Apache-2.0
/**
 * W19 导出入口口径：**已保存简历**走新的「导出交付包」面板；
 * **生成流程/未保存预览**（exportFlow="legacy"）保留旧导出选项面板。
 *
 * 这一层只钉"入口路由"：两个弹层都被替成哨兵节点，断言点「导出」后打开的是哪一个。
 * 新面板自身的内容/请求由 ExportConfigModal 的用例与制作台 e2e 覆盖。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import { makeResumeDocument } from "../../test/documentHarness";
import type { ResumeDetail, ResumeLayout } from "../../types";
import ResumeDetailPreview from "./ResumeDetailPreview";

vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="preview-stub" />,
}));
vi.mock("./ResumeLayoutDiagnosisCard", () => ({ default: () => null }));
vi.mock("./ResumeTemplateControls", () => ({ default: () => null }));
vi.mock("./ResumeMeasureControls", () => ({ default: () => null }));
// 导出按钮：把宿主的 onOpen 原样暴露成一个可点击节点。
vi.mock("../ExportButtons", () => ({
  default: ({ onOpen }: { onOpen?: () => void }) => (
    <button type="button" onClick={onOpen}>
      {t("export.action.export")}
    </button>
  ),
}));
vi.mock("./delivery/ExportConfigModal", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="delivery-export" /> : null),
}));
vi.mock("../ExportOptionsModal", () => ({
  default: ({ open }: { open: boolean }) => (open ? <div data-testid="legacy-export" /> : null),
}));
vi.mock("../../api/profile", () => ({
  getProfile: vi.fn(async () => ({
    photo: "",
    name: "",
    gender: "",
    birth_year: "",
    phone: "",
    email: "",
    city: "",
    personal_website: "",
    github: "",
    job_intent: "",
    summary: "",
    educations: [],
    experiences: [],
    campus_experiences: [],
    projects: [],
    skills: [],
    awards: [],
  })),
}));

const DETAIL = {
  id: 42,
  title: "后端开发-示例科技",
  job_id: 7,
  job_title: "后端开发",
  company: "示例科技",
  source: "ai",
  favorite: false,
  note: "",
  model: "demo-model",
  enhancement_enabled: false,
  enhancement_level: "balanced",
  template: "classic",
  format_name: "",
  format_config: {},
  page_limit: 1,
  font_scale: "standard",
  created_at: "2026-10-20T08:00:00",
  content: makeResumeDocument(),
  warnings: [],
} as unknown as ResumeDetail;

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: {},
};

function renderPreview(exportFlow?: "delivery" | "legacy") {
  return render(
    <MemoryRouter>
      <AntdApp>
        <ResumeDetailPreview
          detail={DETAIL}
          html="<html></html>"
          layout={LAYOUT}
          layoutStatus={null}
          measure={null}
          pdfDirectAvailable
          relayouting={false}
          previewRef={{ current: null }}
          onLayoutStatus={vi.fn()}
          onMeasure={vi.fn()}
          onApplyLayout={vi.fn()}
          onApplyFittedFormat={vi.fn()}
          onSaveEditedResume={vi.fn(async () => undefined)}
          suggestionsGenerated={false}
          suggestionsResetKey={0}
          onSuggestionsGenerated={vi.fn()}
          exportFlow={exportFlow}
        />
      </AntdApp>
    </MemoryRouter>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("W19 导出入口口径", () => {
  it("已保存简历（默认 delivery）：点「导出」打开新的导出交付包面板", () => {
    renderPreview();
    fireEvent.click(screen.getByRole("button", { name: t("export.action.export") }));
    expect(screen.getByTestId("delivery-export")).toBeInTheDocument();
    expect(screen.queryByTestId("legacy-export")).toBeNull();
  });

  it("生成流程/未保存预览（legacy）：仍打开旧导出选项面板，不挂新面板", () => {
    renderPreview("legacy");
    fireEvent.click(screen.getByRole("button", { name: t("export.action.export") }));
    expect(screen.getByTestId("legacy-export")).toBeInTheDocument();
    expect(screen.queryByTestId("delivery-export")).toBeNull();
  });
});
