// SPDX-License-Identifier: Apache-2.0
/**
 * W10-INT 真实壳 e2e（wb-core 接完 resumeId/content/onTrialAdopt 后）：
 * 1. 打开模板图库 → 试用与对比 → **我的内容**模式按当前简历 content 预览 + 真实 PDF 测页数/溢出；
 * 2. 选「采用模板默认」→ 采纳 → onTrialAdopt 经 shell 写回 template 且 **format_config 被清空**。
 *
 * 只 mock 网络（templates/preview/measure）与画布 iframe，其余是真实 shell。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { useState } from "react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { TEMPLATE_CATALOG } from "../../test/resumeFixtures";
import type { ResumeContent, ResumeLayout } from "../../types";
import { DEFAULT_LAYOUT } from "../ResumeLayoutControls.testkit";
import ResumeZoomModal from "./ResumeZoomModal";

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
vi.mock("../../hooks/useResumeTemplateCatalog", () => ({
  useResumeTemplateCatalog: () => ({ catalog: TEMPLATE_CATALOG }),
}));
vi.mock("../ResumePreview", () => ({
  default: () => <div data-testid="workbench-preview" />,
}));

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
  summary: "current-content",
  education: [],
  experience: [
    {
      id: "e2e_entry001",
      company: "Acme",
      role: "Backend",
      start_date: "",
      end_date: "",
      description: ["Core pipeline"],
      point_ids: { description: ["e2e_point001"] },
    },
  ],
  campus_experience: [],
  projects: [],
  skills: [],
  awards: [],
};

const LAYOUT: ResumeLayout = {
  ...DEFAULT_LAYOUT,
  page_limit: 1,
  // 具名版式也属于"当前覆盖"的一部分：用来区分「保留当前覆盖」与「采用模板默认」。
  format_name: "compact",
  format_config: { accent: "#123456" },
};

function Harness({ onApplyLayout }: { onApplyLayout: (next: ResumeLayout) => void }) {
  const [layout, setLayout] = useState<ResumeLayout>(LAYOUT);
  const apply = (next: ResumeLayout) => {
    onApplyLayout(next);
    setLayout(next);
  };
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
        onApplyLayout={apply}
        onSaveContent={vi.fn(async () => undefined)}
      />
    </AntdApp>
  );
}

function openGallery(): void {
  fireEvent.click(screen.getByRole("button", { name: /选择简历模板并预览效果/ }));
}

function paramsColumn(): HTMLElement {
  return document.querySelector<HTMLElement>(".resume-wb-col-params") as HTMLElement;
}

function switchTab(label: string): void {
  fireEvent.click(within(paramsColumn()).getByText(label));
}

beforeEach(() => {
  apiMocks.fetchResumeTemplates.mockReset();
  apiMocks.fetchResumeTemplates.mockResolvedValue(TEMPLATE_CATALOG);
  apiMocks.previewResumeTemplate.mockReset();
  apiMocks.previewResumeTemplate.mockResolvedValue("<html><body>trial</body></html>");
  apiMocks.fetchResumePreviewPdf.mockReset();
  apiMocks.fetchResumePreviewPdf.mockResolvedValue({
    blob: new Blob(),
    pages: 1,
    pagesNeeded: 2,
    pageLimit: 1,
    overflow: true,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  sessionStorage.clear();
  vi.restoreAllMocks();
});

describe("W10-INT · 模板试用真实壳", () => {
  it("我的内容模式：按当前简历 content 预览并显示真实页数/溢出", async () => {
    const onApplyLayout = vi.fn();
    render(<Harness onApplyLayout={onApplyLayout} />);
    openGallery();
    fireEvent.click(await screen.findByRole("button", { name: t("trial.action.open") }));

    // 图库缩略图也会走 preview（每个模板一次）；"试用"两侧各一次、带当前简历 content。
    // 测量只在试用里发生 → 以 fetchResumePreviewPdf 两次作为"试用已就绪"的信号。
    await waitFor(() => expect(apiMocks.fetchResumePreviewPdf).toHaveBeenCalledTimes(2));
    const trialCall = apiMocks.previewResumeTemplate.mock.calls.filter(
      (call) => (call[0] as { content?: ResumeContent }).content !== undefined,
    );
    expect(trialCall).toHaveLength(2);
    for (const call of trialCall) {
      expect((call[0] as { content?: ResumeContent }).content).toEqual(CONTENT);
    }
    // 当前内容模式下两侧各测一次真实 PDF 页数；界面按统一页数措辞显示并提示溢出。
    expect(
      (apiMocks.fetchResumePreviewPdf.mock.calls[0][1] as { content?: ResumeContent }).content,
    ).toEqual(CONTENT);
    const pageLines = await screen.findAllByText(t("trial.measure.pages", { pages: 2, limit: 1 }));
    expect(pageLines.length).toBeGreaterThan(0);
    expect(screen.getAllByText(t("trial.measure.overflow")).length).toBeGreaterThan(0);
    expect(onApplyLayout).not.toHaveBeenCalled();
  });

  it("采用模板默认 → 采纳写回 template 且清空 format_config（经 shell onTrialAdopt）", async () => {
    const onApplyLayout = vi.fn();
    render(<Harness onApplyLayout={onApplyLayout} />);
    openGallery();
    fireEvent.click(await screen.findByRole("button", { name: t("trial.action.open") }));
    await waitFor(() => expect(apiMocks.fetchResumePreviewPdf).toHaveBeenCalledTimes(2));

    fireEvent.click(screen.getByText(t("trial.override.reset")));
    const adoptButtons = await screen.findAllByRole("button", { name: t("trial.adopt") });
    fireEvent.click(adoptButtons[adoptButtons.length - 1]);

    await waitFor(() => expect(onApplyLayout).toHaveBeenCalled());
    const layout = onApplyLayout.mock.calls[onApplyLayout.mock.calls.length - 1][0] as {
      template: string;
      format_name: string;
      format_config: Record<string, unknown>;
    };
    // 右侧默认是"当前模板之外的第一套"（classic → modern）；
    // 「采用模板默认」= 真正回到模板默认：具名版式与全部覆盖都清空。
    expect(layout.template).toBe("modern");
    expect(layout.format_name).toBe("");
    expect(layout.format_config).toEqual({});
  });

  it("保留当前覆盖（默认）→ 只换模板，format_name 与 format_config 原样保留", async () => {
    const onApplyLayout = vi.fn();
    render(<Harness onApplyLayout={onApplyLayout} />);
    openGallery();
    fireEvent.click(await screen.findByRole("button", { name: t("trial.action.open") }));
    await waitFor(() => expect(apiMocks.fetchResumePreviewPdf).toHaveBeenCalledTimes(2));
    const adoptButtons = await screen.findAllByRole("button", { name: t("trial.adopt") });
    fireEvent.click(adoptButtons[adoptButtons.length - 1]);
    await waitFor(() => expect(onApplyLayout).toHaveBeenCalled());
    const layout = onApplyLayout.mock.calls[onApplyLayout.mock.calls.length - 1][0] as {
      template: string;
      format_name: string;
      format_config: Record<string, unknown>;
    };
    expect(layout.template).toBe("modern");
    expect(layout.format_name).toBe("compact");
    expect(layout.format_config).toEqual({ accent: "#123456" });
  });

  it("未保存草稿：在大纲复制条目后，试用按草稿内容预览/测量（不是已保存正文）", async () => {
    const onApplyLayout = vi.fn();
    render(<Harness onApplyLayout={onApplyLayout} />);
    // 1) 在大纲里复制当前条目：这是"未保存的草稿改动"（history.content 变化，未落库）。
    switchTab(t("outline.panel.title"));
    fireEvent.click(await screen.findByText("Acme"));
    fireEvent.click(
      await screen.findByRole("button", { name: new RegExp(t("outline.action.clone")) }),
    );
    // 2) 回到参数栏，打开图库试用与对比。
    switchTab(t("responsive.action.params"));
    openGallery();
    fireEvent.click(await screen.findByRole("button", { name: t("trial.action.open") }));
    await waitFor(() => expect(apiMocks.fetchResumePreviewPdf).toHaveBeenCalledTimes(2));

    // 3) 预览与测量用的 content 是**草稿**（experience 两条），不是已保存的 CONTENT（一条）。
    const previewCalls = apiMocks.previewResumeTemplate.mock.calls.filter(
      (call) => (call[0] as { content?: ResumeContent }).content !== undefined,
    );
    expect(previewCalls).toHaveLength(2);
    for (const call of previewCalls) {
      const draft = (call[0] as { content?: ResumeContent }).content!;
      expect(draft.experience).toHaveLength(2);
    }
    const measureContent = (
      apiMocks.fetchResumePreviewPdf.mock.calls[0][1] as { content?: ResumeContent }
    ).content!;
    expect(measureContent.experience).toHaveLength(2);
    expect(CONTENT.experience).toHaveLength(1);
    expect(onApplyLayout).not.toHaveBeenCalled();
  });
});
