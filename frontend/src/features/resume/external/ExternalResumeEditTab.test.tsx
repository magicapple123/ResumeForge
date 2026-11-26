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
 *
 * 失败还要分「原件读不到」与「原件不存在」：404 说明文件已不在本机（副本库里 2 份
 * 外部简历就是这样），此时不许说"原件不受影响"、也不给重试与下载（两个都不可能成功）；
 * 非 404 的临时错误才保留"重试"与"原件不受影响"。两个分支各有用例钉住文案 key。
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

/**
 * 后端给的失败句子（`ApiError.message`）。用 ASCII 常量而不是抄一份中文：这些句子
 * 来自服务端、不是界面文案，测试要断言的是"原样展示"，与 i18n 无关。
 */
const UNSUPPORTED_MESSAGE = "pdf_no_text_layer: no text layer in this PDF";
const MISSING_MESSAGE = "the file of this revision no longer exists";
const TRANSIENT_MESSAGE = "502: upstream temporarily unavailable";

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
    apiMocks.getExternalResumeBlocks.mockRejectedValue(new ApiError(UNSUPPORTED_MESSAGE, 422));

    renderTab();
    const alert = await screen.findByTestId("external-edit-failure-unsupported");
    expect(alert).toHaveTextContent(UNSUPPORTED_MESSAGE);
    expect(alert).toHaveTextContent(t("externalEdit.unsupported.title"));
    expect(screen.getByRole("link", { name: new RegExp(t("externalEdit.download")) })).toHaveAttribute(
      "href",
      "/api/external-resumes/7/file?v=21",
    );
    expect(screen.queryByTestId("external-editor")).toBeNull();
  });

  it("原件文件已不在本机（404）：说要重新上传或从历史版本下载，绝不说「原件不受影响」", async () => {
    apiMocks.getExternalResumeBlocks.mockRejectedValue(new ApiError(MISSING_MESSAGE, 404));

    renderTab();
    const alert = await screen.findByTestId("external-edit-failure-missing");
    expect(alert).toHaveTextContent(t("externalEdit.blocksMissingTitle"));
    expect(alert).toHaveTextContent(MISSING_MESSAGE);
    // 正文说明必须换成"原件已不在本机"这一套，不能沿用"网络/服务暂时不可用"那句。
    expect(screen.getByText(t("externalEdit.blocksMissingHint"))).toBeInTheDocument();
    expect(screen.queryByText(t("externalEdit.blocksFailedHint"))).toBeNull();
    // 文件没了，「重试」与「下载原件」都不会成功：两个按钮都不该出现。
    expect(screen.queryByTestId("external-retry")).toBeNull();
    expect(screen.queryByRole("link", { name: new RegExp(t("externalEdit.download")) })).toBeNull();
  });

  it("网络/服务临时出错（500）：保留「重试」与「原件不受影响」", async () => {
    apiMocks.getExternalResumeBlocks
      .mockRejectedValueOnce(new ApiError(TRANSIENT_MESSAGE, 500))
      .mockResolvedValue(blocksWith("旧标题"));

    renderTab();
    const alert = await screen.findByTestId("external-edit-failure-transient");
    expect(alert).toHaveTextContent(t("externalEdit.blocksFailed"));
    expect(screen.getByText(t("externalEdit.blocksFailedHint"))).toBeInTheDocument();
    // 临时错误不能误报成"原件没了"。
    expect(screen.queryByText(t("externalEdit.blocksMissingHint"))).toBeNull();

    fireEvent.click(screen.getByTestId("external-retry"));
    await waitFor(() => {
      expect(apiMocks.getExternalResumeBlocks).toHaveBeenCalledTimes(2);
    });
    expect(await screen.findByTestId("external-block-p1b0")).toBeInTheDocument();
  });

  it("没有可编辑的块时给一句说明，而不是一块空白", async () => {
    apiMocks.getExternalResumeBlocks.mockResolvedValue({ ...blocksWith("x"), blocks: [] });

    renderTab();
    expect(await screen.findByTestId("external-blocks-empty")).toHaveTextContent(
      t("externalEdit.blocksEmpty"),
    );
  });
});
