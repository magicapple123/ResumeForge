// SPDX-License-Identifier: Apache-2.0
/** 外部简历详情抽屉：原件 / 文本 / 文本检查三个视图，以及"没有文字不显示检查通过"。 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import ExternalResumeDetailDrawer from "./ExternalResumeDetailDrawer";

const apiMocks = vi.hoisted(() => ({
  getExternalResume: vi.fn(),
  getExternalResumeAnalysis: vi.fn(),
  externalResumeFileUrl: (id: number) => `/api/external-resumes/${id}/file`,
}));
vi.mock("../../../api/externalResumes", () => apiMocks);

const RECORD = {
  id: 7,
  file_id: 21,
  name: "外部简历.pdf",
  mime: "application/pdf",
  text_chars: 12,
  has_text: true,
  job_id: null,
  job_title: "",
  created_at: "2026-11-10T10:00:00",
  updated_at: "2026-11-10T10:00:00",
  warnings: [],
  text: "Zhang San Backend Engineer",
};

const ANALYSIS = {
  resume_id: 7,
  text_chars: 12,
  line_count: 1,
  estimated_pages: 0.1,
  has_text: true,
  warnings: [],
  checks: [
    {
      key: "placeholder",
      count: 1,
      ratio: null,
      sample_size: 1,
      items: [{ line: 1, text: "TO-DO project" }],
      keywords: null,
    },
    { key: "contact", count: 0, ratio: null, sample_size: 1, items: [], keywords: null },
    { key: "length", count: 12, ratio: null, sample_size: 1, items: [], keywords: null },
  ],
};

function renderDrawer(
  resumeId: number | null,
  initialTab: "original" | "text" | "check" = "original",
) {
  const onClose = vi.fn();
  render(
    <AntdApp>
      <ExternalResumeDetailDrawer resumeId={resumeId} initialTab={initialTab} onClose={onClose} />
    </AntdApp>,
  );
  return { onClose };
}

beforeEach(() => {
  apiMocks.getExternalResume.mockReset().mockResolvedValue(RECORD);
  apiMocks.getExternalResumeAnalysis.mockReset().mockResolvedValue(ANALYSIS);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ExternalResumeDetailDrawer", () => {
  it("原件视图：PDF 直接嵌 iframe 预览", async () => {
    renderDrawer(7);

    await waitFor(() => {
      const frame = document.querySelector("iframe");
      expect(frame).not.toBeNull();
      expect(frame?.getAttribute("src")).toBe("/api/external-resumes/7/file");
    });
  });

  it("文本视图显示提取到的正文", async () => {
    renderDrawer(7, "text");

    expect(await screen.findByText("Zhang San Backend Engineer")).toBeInTheDocument();
  });

  it("文本检查：条目化结论带行号，未覆盖的联系方式给出明显提示", async () => {
    renderDrawer(7, "check");

    expect(await screen.findByText(t("resumesPage.external.checkHint"))).toBeInTheDocument();
    expect(screen.getByText(t("resumesPage.external.checkPlaceholder"))).toBeInTheDocument();
    expect(
      screen.getByText(t("resumesPage.external.checkPlaceholderDetail", { count: 1 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("resumesPage.external.checkContactMissing"))).toBeInTheDocument();
    expect(screen.getByText(/TO-DO/)).toBeInTheDocument();
  });

  it("没有提取到文字：只说明无法检查，不发检查请求、也不出现「正常」", async () => {
    apiMocks.getExternalResume.mockResolvedValue({
      ...RECORD,
      name: "scan-file.pdf",
      has_text: false,
      text: "",
      text_chars: 0,
    });
    renderDrawer(7, "check");

    expect(await screen.findByText(t("resumesPage.external.textEmpty"))).toBeInTheDocument();
    expect(screen.getByText(t("resumesPage.external.checkNoText"))).toBeInTheDocument();
    expect(screen.queryByText(t("resumesPage.external.checkStatusOk"))).toBeNull();
    expect(apiMocks.getExternalResumeAnalysis).not.toHaveBeenCalled();
  });

  it("非 PDF 原件：不硬塞 iframe，改为给下载入口", async () => {
    apiMocks.getExternalResume.mockResolvedValue({ ...RECORD, mime: "text/plain" });
    renderDrawer(7);

    expect(
      await screen.findByText(t("resumesPage.external.originalUnsupported")),
    ).toBeInTheDocument();
    expect(
      screen.getByRole("link", { name: new RegExp(t("resumesPage.external.downloadOriginal")) }),
    ).toHaveAttribute("href", "/api/external-resumes/7/file");
    expect(document.querySelector("iframe")).toBeNull();
  });
});
