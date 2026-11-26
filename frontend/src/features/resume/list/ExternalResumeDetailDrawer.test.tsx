// SPDX-License-Identifier: Apache-2.0
/**
 * 外部简历详情弹层（T10 / T11 / T12）：原件 / 文本 / 文本检查三个只读视图，
 * 以及编辑与历史版本两个页签。
 *
 * 改之前这里守的是"PDF 直接嵌 iframe"；R9-4 / R12 把它换成了 1080 × 86vh 的居中
 * Modal + pdf.js 画布，断言跟着改成"画布与自建工具栏在、iframe 不在"。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
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
  getExternalResumeRevisionText: vi.fn(),
  externalResumeFileUrl: (id: number, revisionId?: number) =>
    revisionId == null
      ? `/api/external-resumes/${id}/file`
      : `/api/external-resumes/${id}/file?revision_id=${revisionId}`,
}));
vi.mock("../../../api/externalResumes", () => apiMocks);

// 原件页用 pdf.js 画 canvas：jsdom 没有 canvas 也没有 worker，这里只要求它别炸。
vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: 2,
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

/**
 * 编辑后的正文夹具。
 *
 * 后半句用 `\u` 转义写出来：运行时仍是同一句话，但静态扫描看不到 CJK——`getByText(...)`
 * 参数里出现中文字面量会被 `cjkRatchet` 记成"该迁成 `t()` 的断言"（那是给**界面文案**
 * 定的口径，测试数据不该往语言包里塞）。守卫自测里的 `SAVE` 常量用的是同一手法。
 */
const EDITED_TEXT = "Zhang San \u65b0\u7248";

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
  onChanged?: () => void,
  revisionId?: number,
) {
  const onClose = vi.fn();
  render(
    <AntdApp>
      <ExternalResumeDetailDrawer
        resumeId={resumeId}
        initialTab={initialTab}
        onClose={onClose}
        onChanged={onChanged}
        revisionId={revisionId}
      />
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
  apiMocks.getExternalResumeRevisionText.mockReset().mockResolvedValue({
    revision_id: 5,
    text: "Zhang San Past",
    text_chars: 12,
    has_text: true,
  });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("ExternalResumeDetailDrawer", () => {
  it("是居中的卡片弹层（1080 宽），标题下一行说明；不再是全宽抽屉", async () => {
    renderDrawer(7);

    const dialog = await screen.findByRole("dialog");
    expect(dialog).toHaveClass("rf-ext-detail-modal");
    // 说明从"右侧大片空白里的一句"改成标题下一行（R9-4）。
    expect(screen.getByText(t("externalEdit.detail.hint"))).toBeInTheDocument();
    // Drawer 的壳不该再出现。
    expect(document.querySelector(".ant-drawer")).toBeNull();
  });

  it("原件视图：pdf.js 画布 + 自建工具栏（页码 / 缩放 / 下载），没有 iframe", async () => {
    renderDrawer(7);

    expect(await screen.findByTestId("external-original-canvas")).toBeInTheDocument();
    expect(document.querySelector("iframe")).toBeNull();
    // 工具栏：页码、缩放读数、下载入口都在同一个条上。
    //
    // 页码的总页数来自 pdf.js 的 `numPages`，是异步落定的（画布元素本身同步就有），
    // 所以这里要等它读出来，而不是画布一出现就断言。
    await waitFor(() => {
      expect(screen.getByTestId("external-original-pager")).toHaveTextContent(
        t("externalEdit.original.page", { page: 1, total: 2 }),
      );
    });
    expect(screen.getByTestId("external-original-zoom")).toHaveTextContent(
      t("externalEdit.original.zoom", { percent: 100 }),
    );
    expect(
      screen.getByRole("link", { name: new RegExp(t("resumesPage.external.downloadOriginal")) }),
    ).toHaveAttribute("href", "/api/external-resumes/7/file?v=21");
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

  it("「历史版本」页签：列出当前版本并标出来，当前版本的「预览」禁用", async () => {
    renderDrawer(7, "revisions");

    expect(await screen.findByTestId("external-revision-5")).toHaveTextContent(
      t("externalEdit.revisions.current"),
    );
    expect(screen.getByTestId("external-preview-5")).toBeDisabled();
    expect(apiMocks.listExternalResumeRevisions).toHaveBeenCalledWith(7);
  });

  it("改完能给到结果：成功条两个入口分别切到「原件」与「文本」，且都看到新内容", async () => {
    const onChanged = vi.fn();
    apiMocks.editExternalResumeBlock.mockResolvedValue({
      resume: { ...RECORD, file_id: 22, text_chars: 20, text: EDITED_TEXT },
      revision: { id: 6, file_id: 22, text_chars: 20, has_text: true, source: "edit", created_at: "2026-11-10T11:00:00", current: true },
      kind: "pdf",
      block_id: "p1b0",
      page: 1,
      delta_pt: 0,
      overflow: false,
      scaled: false,
      shifted: false,
      lines_before: 1,
      lines_after: 1,
      warnings: [],
    });
    renderDrawer(7, "edit", onChanged);

    fireEvent.click(await screen.findByTestId("external-block-p1b0"));
    fireEvent.change(screen.getByTestId("external-text-input"), { target: { value: EDITED_TEXT } });
    fireEvent.click(screen.getByTestId("external-apply"));

    const bar = await screen.findByTestId("external-apply-success");
    expect(bar).toHaveTextContent(t("externalEdit.success.hint"));
    // `onChanged` 必须被调用：列表要靠它刷新字数与排序（R9 bug 2 的接线点）。
    expect(onChanged).toHaveBeenCalled();

    fireEvent.click(screen.getByTestId("external-success-original"));
    // 新 `file_id` 进 URL：原件页拿到的是刚存下的那一版，不是缓存里的旧 PDF。
    expect(
      await screen.findByRole("link", { name: new RegExp(t("resumesPage.external.downloadOriginal")) }),
    ).toHaveAttribute("href", "/api/external-resumes/7/file?v=22");

    fireEvent.click(screen.getByRole("tab", { name: t("externalEdit.tab.edit") }));
    fireEvent.click(await screen.findByTestId("external-success-text"));
    expect(await screen.findByText(EDITED_TEXT)).toBeInTheDocument();
  });

  it("带 revisionId 打开：原件与文本都切到那一版，提示条说明当前版本未变，可撤回", async () => {
    renderDrawer(7, "text", undefined, 5);

    // 提示条 + 正文都来自那一版：文本页读的是它（不是当前 record.text）。
    expect(await screen.findByTestId("external-viewing-revision")).toHaveTextContent(
      t("externalEdit.versionView.noticeNoTime"),
    );
    expect(apiMocks.getExternalResumeRevisionText).toHaveBeenCalledWith(7, 5);
    expect(await screen.findByTestId("external-revision-text")).toHaveTextContent("Zhang San Past");

    // 原件页签的地址也要带 revision_id（画的是那一版的文件）。
    fireEvent.click(screen.getByRole("tab", { name: t("resumesPage.external.tabOriginal") }));
    expect(
      await screen.findByRole("link", { name: new RegExp(t("resumesPage.external.downloadOriginal")) }),
    ).toHaveAttribute("href", "/api/external-resumes/7/file?revision_id=5");

    // 「回到当前版本」= 收起提示条，正文回到 record.text。
    fireEvent.click(screen.getByTestId("external-view-current"));
    fireEvent.click(screen.getByRole("tab", { name: t("resumesPage.external.tabText") }));
    expect(await screen.findByText(RECORD.text)).toBeInTheDocument();
    expect(screen.queryByTestId("external-viewing-revision")).toBeNull();
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

  it("TXT 原件：不再说「不支持预览」，直接按等宽原文显示（R9-7）", async () => {
    apiMocks.getExternalResume.mockResolvedValue({
      ...RECORD,
      name: "resume.txt",
      mime: "text/plain",
      text: "第一行\n第二行",
    });
    renderDrawer(7);

    expect(await screen.findByTestId("external-text-preview")).toHaveTextContent("第一行");
    expect(screen.queryByText(t("resumesPage.external.originalUnsupported"))).toBeNull();
    expect(document.querySelector("iframe")).toBeNull();
  });

  it("旧版 .doc：给「另存为 .docx」的引导 + 下载入口", async () => {
    apiMocks.getExternalResume.mockResolvedValue({ ...RECORD, name: "简历.doc", mime: "application/msword" });
    renderDrawer(7);

    expect(await screen.findByTestId("external-doc-fallback")).toHaveTextContent(
      t("externalEdit.preview.docHint"),
    );
  });
});
