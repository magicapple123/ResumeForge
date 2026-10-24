// SPDX-License-Identifier: Apache-2.0
/**
 * W10 在模板图库里的入口：切到"试用与对比"视图、双模板并排、采纳/取消的文档边界。
 *
 * 关键断言：试用/返回**不改文档**（不调 onSelect）；只有采纳才回传一次目标模板，
 * 且宿主提供了 onTrialAdopt 时才允许"采用模板默认"。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Mock } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeFormatConfig, ResumeLayout } from "../../types";
import TemplateGalleryModal from "./TemplateGalleryModal";

const apiMocks = vi.hoisted(() => ({
  fetchResumeTemplates: vi.fn(),
  previewResumeTemplate: vi.fn(),
  fetchResumePreviewPdf: vi.fn(),
}));

vi.mock("../../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../api/resumes")>()),
  fetchResumeTemplates: apiMocks.fetchResumeTemplates,
  previewResumeTemplate: apiMocks.previewResumeTemplate,
  fetchResumePreviewPdf: apiMocks.fetchResumePreviewPdf,
}));

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: { accent: "#123456" },
};

function renderGallery(handlers: { onSelect?: Mock; onTrialAdopt?: Mock } = {}) {
  const onSelect = handlers.onSelect ?? vi.fn();
  const onTrialAdopt = handlers.onTrialAdopt as
    ((request: { template: string; formatConfig: ResumeFormatConfig }) => void) | undefined;
  render(
    <AntdApp>
      <TemplateGalleryModal
        open
        layout={LAYOUT}
        onFontScaleChange={vi.fn()}
        onSelect={onSelect as (template: string) => void}
        onClose={vi.fn()}
        onTrialAdopt={onTrialAdopt}
      />
    </AntdApp>,
  );
  return { onSelect, onTrialAdopt };
}

beforeEach(() => {
  apiMocks.fetchResumeTemplates.mockReset();
  apiMocks.fetchResumeTemplates.mockResolvedValue(TEMPLATE_CATALOG);
  apiMocks.previewResumeTemplate.mockReset();
  apiMocks.previewResumeTemplate.mockResolvedValue("<html><body>preview</body></html>");
  apiMocks.fetchResumePreviewPdf.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("TemplateGalleryModal · 试用入口", () => {
  it("卡片点「试用」进入对比视图，不改文档", async () => {
    const { onSelect } = renderGallery({ onTrialAdopt: vi.fn() });
    const trialButtons = await screen.findAllByRole("button", { name: t("trial.action.try") });
    fireEvent.click(trialButtons[0]);
    expect(await screen.findByText(t("trial.title"))).toBeInTheDocument();
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalled());
    expect(onSelect).not.toHaveBeenCalled();
    // 返回图库也只是关掉视图，仍然不动文档。
    // 注意"试用与对比"这五个字同时是图库工具条的入口按钮文本，所以返回后仍有 1 处；
    // 对比视图的标题会消失（进入时是 2 处）。
    fireEvent.click(screen.getByRole("button", { name: t("trial.action.back") }));
    expect(screen.queryAllByText(t("trial.title"))).toHaveLength(1);
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("宿主提供 onTrialAdopt 时：采纳回传目标模板与保留的排版覆盖", async () => {
    const onTrialAdopt = vi.fn();
    const { onSelect } = renderGallery({ onTrialAdopt });
    const trialButtons = await screen.findAllByRole("button", { name: t("trial.action.try") });
    fireEvent.click(trialButtons[0]);
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalled());
    const adoptButtons = await screen.findAllByRole("button", { name: t("trial.adopt") });
    fireEvent.click(adoptButtons[adoptButtons.length - 1]);
    expect(onTrialAdopt).toHaveBeenCalledWith({
      template: "modern",
      formatConfig: { accent: "#123456" },
    });
    expect(onSelect).not.toHaveBeenCalled();
  });

  it("宿主没接 onTrialAdopt 时：采纳退回 onSelect，且重设覆盖不可用", async () => {
    const { onSelect } = renderGallery();
    const trialButtons = await screen.findAllByRole("button", { name: t("trial.action.try") });
    fireEvent.click(trialButtons[0]);
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalled());
    expect(screen.getByRole("radio", { name: t("trial.override.reset") })).toBeDisabled();
    const adoptButtons = await screen.findAllByRole("button", { name: t("trial.adopt") });
    fireEvent.click(adoptButtons[adoptButtons.length - 1]);
    expect(onSelect).toHaveBeenCalledWith("modern");
  });
});
