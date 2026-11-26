// SPDX-License-Identifier: Apache-2.0
/**
 * 「编辑」页签的编排：取块 → 选块 → 应用 → **用服务端返回的文件重取块与预览**。
 *
 * 守三件事：
 * 1. 应用时带上正确的 `block_id` / `text`，并把服务端返回的 `resume` 交回外层（`file_id` 变了）；
 * 2. 应用后重新拉一次 `blocks`（几何可能变了，不能拿旧的继续画）；
 * 3. 溢出时不动任何东西，点「下移下方内容」才用 `shift_below` 再提交一次。
 *
 * 422（扫描件 / 转曲 / 加密）不走这页的逻辑，只给原因与下载引导 —— 这是"宁可拒绝"那条。
 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../../../api/client";
import type { ExternalResumeBlocks, ExternalResumeDetail } from "../../../api/externalResumes";
import { t } from "../../../i18n";
import { ExternalResumeEditTab } from "./ExternalResumeEditTab";

const apiMocks = vi.hoisted(() => ({
  getExternalResumeBlocks: vi.fn(),
  editExternalResumeBlock: vi.fn(),
  externalResumeFileUrl: (id: number) => `/api/external-resumes/${id}/file`,
}));
vi.mock("../../../api/externalResumes", () => apiMocks);

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

const RECORD: ExternalResumeDetail = {
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
  text: "旧标题 正文说明",
};

function blocksWith(title: string): ExternalResumeBlocks {
  return {
    resume_id: 7,
    kind: "pdf",
    page_count: 1,
    page_width: 600,
    page_height: 800,
    blocks: [
      {
        block_id: "p1b0",
        page: 1,
        text: title,
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
      {
        block_id: "p1b1",
        page: 1,
        text: "正文说明",
        editable: true,
        reason: "",
        x0: 60,
        y0: 600,
        x1: 360,
        y1: 612,
        size: 10,
        leading: 14,
        align: "left",
      },
    ],
    warnings: [],
  };
}

const EDIT_RESULT = {
  resume: { ...RECORD, file_id: 22, text_chars: 20, updated_at: "2026-11-10T11:00:00" },
  revision: {
    id: 3,
    file_id: 22,
    text_chars: 20,
    has_text: true,
    source: "edit",
    created_at: "2026-11-10T11:00:00",
    current: true,
  },
  kind: "pdf",
  block_id: "p1b0",
  page: 1,
  delta_pt: 23.4,
  overflow: true,
  scaled: false,
  shifted: false,
  lines_before: 2,
  lines_after: 3,
  warnings: [],
};

function renderTab(onRecordChange = vi.fn()) {
  render(<ExternalResumeEditTab resumeId={7} record={RECORD} onRecordChange={onRecordChange} />);
  return { onRecordChange };
}

beforeEach(() => {
  apiMocks.getExternalResumeBlocks.mockReset();
  apiMocks.editExternalResumeBlock.mockReset();
});

afterEach(() => {
  cleanup();
});

describe("ExternalResumeEditTab", () => {
  it("选块 → 改字 → 应用：带对的 block_id/text，交回新详情，并重取块", async () => {
    apiMocks.getExternalResumeBlocks
      .mockResolvedValueOnce(blocksWith("旧标题"))
      .mockResolvedValue(blocksWith("新标题"));
    apiMocks.editExternalResumeBlock.mockResolvedValue(EDIT_RESULT);

    const { onRecordChange } = renderTab();
    fireEvent.click(await screen.findByTestId("external-block-p1b0"));

    const input = screen.getByTestId("external-text-input");
    expect(input).toHaveValue("旧标题");
    fireEvent.change(input, { target: { value: "新标题" } });
    fireEvent.click(screen.getByTestId("external-apply"));

    await waitFor(() => {
      expect(apiMocks.editExternalResumeBlock).toHaveBeenCalledWith(7, {
        block_id: "p1b0",
        text: "新标题",
        shift_below: 0,
      });
    });
    expect(onRecordChange).toHaveBeenCalledWith(EDIT_RESULT.resume);
    // 应用后重取块：热区与原文都换成服务端的新结果，而不是前端自己算的。
    await waitFor(() => {
      expect(apiMocks.getExternalResumeBlocks).toHaveBeenCalledTimes(2);
    });
  });

  it("溢出时先不动下方内容；点「下移下方内容」才用 shift_below 再提交一次", async () => {
    apiMocks.getExternalResumeBlocks
      .mockResolvedValueOnce(blocksWith("旧标题"))
      .mockResolvedValue(blocksWith("新标题"));
    apiMocks.editExternalResumeBlock.mockResolvedValue(EDIT_RESULT);

    renderTab();
    fireEvent.click(await screen.findByTestId("external-block-p1b0"));
    fireEvent.change(screen.getByTestId("external-text-input"), { target: { value: "新标题" } });
    fireEvent.click(screen.getByTestId("external-apply"));

    expect(await screen.findByTestId("external-overflow")).toBeInTheDocument();
    // 只提交了一次（应用），下移必须等用户点。
    expect(apiMocks.editExternalResumeBlock).toHaveBeenCalledTimes(1);

    fireEvent.click(screen.getByTestId("external-shift"));
    await waitFor(() => {
      expect(apiMocks.editExternalResumeBlock).toHaveBeenLastCalledWith(7, {
        block_id: "p1b0",
        // 重取后这一块的原文就是刚存下的新文字：下移不改字，只移动下方内容。
        text: "新标题",
        shift_below: 24,
      });
    });
  });

  it("能力探测失败（422）：说清原因、给下载引导，不画编辑器", async () => {
    apiMocks.getExternalResumeBlocks.mockRejectedValue(
      new ApiError("这份 PDF 没有文字层（扫描件或纯图片）", 422),
    );

    renderTab();
    const alert = await screen.findByTestId("external-unsupported");
    expect(alert).toHaveTextContent("这份 PDF 没有文字层（扫描件或纯图片）");
    expect(alert).toHaveTextContent(t("externalEdit.unsupported.title"));
    expect(screen.getByRole("link", { name: new RegExp(t("externalEdit.download")) })).toHaveAttribute(
      "href",
      "/api/external-resumes/7/file?v=21",
    );
    expect(screen.queryByTestId("external-editor")).toBeNull();
  });

  it("没有可编辑的块时给一句说明，而不是一块空白", async () => {
    apiMocks.getExternalResumeBlocks.mockResolvedValue({ ...blocksWith("x"), blocks: [] });

    renderTab();
    expect(await screen.findByTestId("external-blocks-empty")).toHaveTextContent(
      t("externalEdit.blocksEmpty"),
    );
  });
});
