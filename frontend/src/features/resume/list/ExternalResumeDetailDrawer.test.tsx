// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历详情抽屉：原件 / 文本 / 文本检查三个只读视图（#21），以及编辑与历史版本两个
 * 页签（#5）。编辑流程本身在 `features/resume/external/` 的用例里，这里只守"页签挂上了、
 * 切过去真的会去取块、改完原件预览跟着换 URL"。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import ExternalResumeDetailDrawer from "./ExternalResumeDetailDrawer";

const apiMocks = vi.hoisted(() => ({
  getExternalResume: vi.fn(),
  getExternalResumeAnalysis: vi.fn(),
  getExternalResumeBlocks: vi.fn(),
  editExternalResumeBlock: vi.fn(),
  listExternalResumeRevisions: vi.fn(),
  restoreExternalResumeRevision: vi.fn(),
  externalResumeFileUrl: (id: number) => `/api/external-resumes/${id}/file`,
}));
vi.mock("../../../api/externalResumes", () => apiMocks);

// 编辑页签里的 pdf.js 真跑不起来（jsdom 没有 canvas、也没有 worker）；这里只要它别炸。
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 1,
      getPage: async () => ({
        getViewport: ({ scale }: { scale: number }) => ({ width: 600 * scale, height: 800 * scale }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup: () => undefined,
      }),
    }),
    destroy: () => Promise.resolve(),
  }),
}));
vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf-worker-url" }));

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
  initialTab: "original" | "text" | "check" | "edit" | "revisions" = "original",
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
  apiMocks.getExternalResumeBlocks.mockReset().mockResolvedValue({
    resume_id: 7,
    kind: "pdf",
    page_count: 1,
    page_width: 600,
    page_height: 800,
    blocks: [
      {
        block_id: "p1b0",
        page: 1,
        text: "Zhang San",
        editable: true,
        reason: "",
        x0: 60,
        y0: 700,
        x1: 360,
        y1: 720,
        size: 18,
        leading: 22,
        align: "left",
      },
    ],
    warnings: [],
  });
  apiMocks.editExternalResumeBlock.mockReset();
  apiMocks.listExternalResumeRevisions.mockReset().mockResolvedValue({
    resume_id: 7,
    total: 1,
    items: [
      {
        id: 5,
        file_id: 21,
        text_chars: 12,
        has_text: true,
        source: "upload",
        created_at: "2026-11-10T10:00:00",
        current: true,
      },
    ],
  });
  apiMocks.restoreExternalResumeRevision.mockReset();
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ExternalResumeDetailDrawer", () => {
  it("原件视图：PDF 直接嵌 iframe，按整页宽度铺满可用高度", async () => {
    renderDrawer(7);

    await waitFor(() => {
      const frame = document.querySelector("iframe");
      expect(frame).not.toBeNull();
      // CR-16：`#view=FitV` 让 Chromium 内置 PDF 阅读器按视口宽度铺满，而不是缩成默认比例。
      // `?v=<file_id>`：编辑会写新的 user_file，URL 变了才不会被浏览器缓存成旧 PDF。
      expect(frame?.getAttribute("src")).toBe("/api/external-resumes/7/file?v=21#view=FitV");
      // 高度交给 flex 链（Drawer body → Tabs → tabpane → iframe），固定 560px 会留白。
      expect(frame?.style.height).toBe("100%");
    });
  });

  it("「编辑」页签：切过去才去取块，页签名字与界面语汇一致", async () => {
    renderDrawer(7, "edit");

    expect(await screen.findByText(t("externalEdit.tab.edit"))).toBeInTheDocument();
    expect(screen.getByText(t("externalEdit.tab.revisions"))).toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.getExternalResumeBlocks).toHaveBeenCalledWith(7);
    });
    expect(await screen.findByTestId("external-block-p1b0")).toBeInTheDocument();
  });

  it("「历史版本」页签：列出当前版本并标出来", async () => {
    renderDrawer(7, "revisions");

    expect(await screen.findByTestId("external-revision-5")).toHaveTextContent(
      t("externalEdit.revisions.current"),
    );
    expect(apiMocks.listExternalResumeRevisions).toHaveBeenCalledWith(7);
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
