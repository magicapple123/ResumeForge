// SPDX-License-Identifier: Apache-2.0
/**
 * W10 试用与对比：演示/当前内容切换、双模板并排、真实页数与溢出、采纳/取消。
 *
 * 断言一律 t()/role/testid，不写中文字面量（i18n 棘轮）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import type { ComponentProps } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { TEMPLATE_CATALOG } from "../../../test/resumeFixtures";
import type { ResumeLayout } from "../../../types";
import TemplateTrialPanel from "./TemplateTrialPanel";

const apiMocks = vi.hoisted(() => ({
  previewResumeTemplate: vi.fn(),
  fetchResumePreviewPdf: vi.fn(),
}));
const preflightMocks = vi.hoisted(() => ({ runPreflight: vi.fn() }));

vi.mock("../../../api/resumes", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/resumes")>()),
  previewResumeTemplate: apiMocks.previewResumeTemplate,
  fetchResumePreviewPdf: apiMocks.fetchResumePreviewPdf,
}));
vi.mock("../../../features/resume-preflight/preflightApi", () => ({
  runPreflight: preflightMocks.runPreflight,
}));

const LAYOUT: ResumeLayout = {
  template: "classic",
  format_name: "",
  page_limit: 1,
  font_scale: "standard",
  format_config: { accent: "#123456" },
};

const CAPABILITIES: Record<string, string> = {
  "html:italic": "supported",
  "html:link_clickable": "supported",
  "pdf:italic": "approx",
  "pdf:link_clickable": "unsupported",
  "docx:italic": "supported",
  "docx:link_clickable": "approx",
};

function renderPanel(
  props: Partial<ComponentProps<typeof TemplateTrialPanel>> = {},
  onAdopt = vi.fn(),
  onBack = vi.fn(),
) {
  render(
    <AntdApp>
      <TemplateTrialPanel
        layout={LAYOUT}
        catalog={TEMPLATE_CATALOG}
        onBack={onBack}
        onAdopt={onAdopt}
        canResetOverrides
        capabilities={CAPABILITIES}
        {...props}
      />
    </AntdApp>,
  );
  return { onAdopt, onBack };
}

beforeEach(() => {
  apiMocks.previewResumeTemplate.mockReset();
  apiMocks.previewResumeTemplate.mockResolvedValue("<html><body>preview</body></html>");
  apiMocks.fetchResumePreviewPdf.mockReset();
  apiMocks.fetchResumePreviewPdf.mockResolvedValue({
    blob: new Blob(),
    pages: 1,
    pagesNeeded: 3,
    pageLimit: 1,
    overflow: true,
  });
  preflightMocks.runPreflight.mockReset();
  preflightMocks.runPreflight.mockResolvedValue({ capabilities: CAPABILITIES });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("TemplateTrialPanel · 两套模板并排", () => {
  it("默认左=当前模板、右=另一套；两侧各发一次预览", async () => {
    renderPanel({ resumeId: 5 });
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(2));
    const requested = apiMocks.previewResumeTemplate.mock.calls.map(
      (call) => (call[0] as { template_name: string }).template_name,
    );
    expect(new Set(requested).size).toBe(2);
    expect(screen.getAllByRole("combobox", { name: t("trial.template.label") })).toHaveLength(2);
    expect(screen.getByText(t("trial.badge.current"))).toBeInTheDocument();
    expect(screen.getByText(t("trial.badge.trial"))).toBeInTheDocument();
  });

  it("当前内容模式用真实排版测量，显示页数与溢出", async () => {
    renderPanel({ resumeId: 5 });
    // 两侧各显示一次（左右并排），所以用 findAll。
    const pageLines = await screen.findAllByText(t("trial.measure.pages", { pages: 3, limit: 1 }));
    expect(pageLines.length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("trial.measure.overflow")).length).toBeGreaterThan(0);
    // measurement 走真 PDF 端点，按两份模板各测一次。
    expect(apiMocks.fetchResumePreviewPdf).toHaveBeenCalledTimes(2);
  });

  it("示例模式不测量页数，也不带 resume_id", async () => {
    const { onAdopt } = renderPanel({ resumeId: 5 });
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(2));
    // 只看切换后的那一轮请求。
    apiMocks.previewResumeTemplate.mockClear();
    fireEvent.click(screen.getByText(t("trial.mode.demo")));
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(2));
    expect(
      apiMocks.previewResumeTemplate.mock.calls.every(
        (call) => (call[0] as { resume_id?: number }).resume_id === undefined,
      ),
    ).toBe(true);
    expect(screen.getAllByText(t("trial.measure.demo")).length).toBeGreaterThan(0);
    expect(onAdopt).not.toHaveBeenCalled();
  });
});

describe("TemplateTrialPanel · 采纳与取消", () => {
  it("默认保留排版覆盖：采纳回传当前 format_config", async () => {
    const { onAdopt } = renderPanel({ resumeId: 5 });
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(2));
    const buttons = screen.getAllByRole("button", { name: t("trial.adopt") });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onAdopt).toHaveBeenCalledTimes(1);
    expect(onAdopt.mock.calls[0][0]).toEqual({
      template: "modern",
      formatConfig: { accent: "#123456" },
    });
  });

  it("选「采用模板默认」后采纳回传空覆盖（重设覆盖是显式选择）", async () => {
    const { onAdopt } = renderPanel({ resumeId: 5 });
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByText(t("trial.override.reset")));
    const buttons = screen.getAllByRole("button", { name: t("trial.adopt") });
    fireEvent.click(buttons[buttons.length - 1]);
    expect(onAdopt).toHaveBeenCalledWith({ template: "modern", formatConfig: {} });
  });

  it("取消/返回不采纳任何模板（试用不污染文档）", async () => {
    const { onAdopt, onBack } = renderPanel({ resumeId: 5 });
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(2));
    fireEvent.click(screen.getByRole("button", { name: t("trial.action.back") }));
    expect(onBack).toHaveBeenCalledTimes(1);
    expect(onAdopt).not.toHaveBeenCalled();
  });

  it("宿主没提供重设通道时「采用模板默认」如实禁用", async () => {
    renderPanel({ resumeId: 5, canResetOverrides: false });
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(2));
    expect(screen.getByRole("radio", { name: t("trial.override.reset") })).toBeDisabled();
  });

  it("当前模板那一侧的采纳按钮禁用", async () => {
    renderPanel({ resumeId: 5 });
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(2));
    const disabled = screen.getAllByRole("button", { name: t("trial.adopt.disabled") });
    expect(disabled.length).toBeGreaterThan(0);
    for (const button of disabled) expect(button).toBeDisabled();
  });
});

describe("TemplateTrialPanel · 格式能力（矩阵口径）", () => {
  it("只显示矩阵里不是 supported 的格子", async () => {
    renderPanel({ resumeId: 5 });
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(2));
    const section = screen.getByLabelText(t("trial.capability.title"));
    expect(
      within(section).getByText(
        `${t("preflight.format.pdf")} ${t("preflight.capability.linkClickable")} ${t("preflight.capability.unsupported")}`,
      ),
    ).toBeInTheDocument();
    // html 全支持 → 不出现 html 行
    expect(within(section).queryByText(new RegExp(t("preflight.format.html")))).toBeNull();
  });

  it("能力矩阵缺失时给出暂不可用提示，不自己编支持情况", async () => {
    preflightMocks.runPreflight.mockResolvedValue({ capabilities: null });
    renderPanel({ resumeId: 5, capabilities: null });
    await waitFor(() => expect(apiMocks.previewResumeTemplate).toHaveBeenCalledTimes(2));
    expect(screen.getByText(t("trial.capability.pending"))).toBeInTheDocument();
  });
});
