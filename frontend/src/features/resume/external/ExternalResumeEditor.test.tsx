// SPDX-License-Identifier: Apache-2.0
/**
 * 左侧选择区：PDF 画热区、DOCX/TXT 只给段落列表。
 *
 * jsdom 里没有 canvas，真 pdf.js 也起不来 worker，所以整块 pdfjs 被 mock 掉：
 * 这里只断"画了几页、热区数量与百分比位置对不对、点了回传哪一块"，
 * **不断像素**（那是人工/Playwright 的事）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalResumeBlocks } from "../../../api/externalResumes";
import { t } from "../../../i18n";
import { ExternalResumeEditor } from "./ExternalResumeEditor";

const pdfState = vi.hoisted(() => ({ sizes: [{ width: 600, height: 800 }] }));

vi.mock("pdfjs-dist", () => ({
  GlobalWorkerOptions: { workerSrc: "" },
  getDocument: () => ({
    promise: Promise.resolve({
      numPages: pdfState.sizes.length,
      getPage: async (pageNumber: number) => ({
        getViewport: ({ scale }: { scale: number }) => ({
          width: pdfState.sizes[pageNumber - 1].width * scale,
          height: pdfState.sizes[pageNumber - 1].height * scale,
        }),
        render: () => ({ promise: Promise.resolve() }),
        cleanup: () => undefined,
      }),
    }),
    destroy: () => Promise.resolve(),
  }),
}));

vi.mock("pdfjs-dist/build/pdf.worker.min.mjs?url", () => ({ default: "pdf-worker-url" }));

const PDF_BLOCKS: ExternalResumeBlocks = {
  resume_id: 7,
  kind: "pdf",
  page_count: 1,
  page_width: 600,
  page_height: 800,
  blocks: [
    {
      block_id: "p1b0",
      page: 1,
      text: "标题",
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
      text: "旋转的块",
      editable: false,
      reason: "pdf_block_rotated",
      x0: 60,
      y0: 420,
      x1: 360,
      y1: 440,
      size: 10,
      leading: 14,
      align: "left",
    },
  ],
  warnings: [],
};

const DOCX_BLOCKS: ExternalResumeBlocks = {
  resume_id: 7,
  kind: "docx",
  page_count: 0,
  page_width: 0,
  page_height: 0,
  blocks: [
    {
      block_id: "d0",
      page: 0,
      text: "第一段",
      editable: true,
      reason: "",
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
      size: 0,
      leading: 0,
      align: "",
    },
    {
      block_id: "d1",
      page: 0,
      text: "表格里的字",
      editable: false,
      reason: "docx_text_in_table",
      x0: 0,
      y0: 0,
      x1: 0,
      y1: 0,
      size: 0,
      leading: 0,
      align: "",
    },
  ],
  warnings: [],
};

afterEach(() => {
  cleanup();
});

describe("ExternalResumeEditor（PDF）", () => {
  it("按 bbox 画热区：位置是页面内的百分比，且 y 已从底部原点翻到顶部原点", async () => {
    render(
      <ExternalResumeEditor blocks={PDF_BLOCKS} selectedId={null} onSelect={vi.fn()} fileUrl="/file" />,
    );

    expect(await screen.findByTestId("external-page-canvas-1")).toBeInTheDocument();
    const hotspot = screen.getByTestId("external-block-p1b0");
    expect(hotspot.style.left).toBe("10%");
    expect(hotspot.style.top).toBe("10%");
    expect(hotspot.style.width).toBe("50%");
    expect(hotspot.style.height).toBe("2.5%");
    expect(screen.getAllByTestId(/^external-block-/)).toHaveLength(2);
  });

  it("点中可编辑块回传 block_id", async () => {
    const onSelect = vi.fn();
    render(
      <ExternalResumeEditor blocks={PDF_BLOCKS} selectedId={null} onSelect={onSelect} fileUrl="/file" />,
    );

    fireEvent.click(await screen.findByTestId("external-block-p1b0"));
    expect(onSelect).toHaveBeenCalledWith("p1b0");
  });

  it("不可编辑的块不让点，并把原因码翻成人话列出来", async () => {
    const onSelect = vi.fn();
    render(
      <ExternalResumeEditor blocks={PDF_BLOCKS} selectedId={null} onSelect={onSelect} fileUrl="/file" />,
    );

    const blocked = await screen.findByTestId("external-block-p1b1");
    expect(blocked).toBeDisabled();
    fireEvent.click(blocked);
    expect(onSelect).not.toHaveBeenCalled();
    expect(screen.getByTestId("external-not-editable")).toHaveTextContent(
      t("externalEdit.reason.pdf_block_rotated"),
    );
  });
});

describe("ExternalResumeEditor（DOCX / TXT）", () => {
  it("没有纸面坐标就不画页面与热区，只按段落列出来", async () => {
    render(
      <ExternalResumeEditor blocks={DOCX_BLOCKS} selectedId={null} onSelect={vi.fn()} fileUrl="/file" />,
    );

    const paragraph = await screen.findByTestId("external-block-d0");
    // 几何字段恒为 0：不能给它一个绝对定位的热区，否则所有块会叠在原点上。
    expect(paragraph.style.position).toBe("");
    expect(screen.queryAllByTestId(/^external-page-/)).toHaveLength(0);
    expect(screen.queryByTestId("external-editor")).toBeInTheDocument();
    expect(screen.getAllByTestId(/^external-block-/)).toHaveLength(2);
  });

  it("点段落回传 block_id；表格里的段落在行内直接说明原因", async () => {
    const onSelect = vi.fn();
    render(
      <ExternalResumeEditor blocks={DOCX_BLOCKS} selectedId={null} onSelect={onSelect} fileUrl="/file" />,
    );

    fireEvent.click(await screen.findByTestId("external-block-d0"));
    expect(onSelect).toHaveBeenCalledWith("d0");
    expect(screen.getByTestId("external-block-d1")).toHaveTextContent(
      t("externalEdit.reason.docx_text_in_table"),
    );
  });
});
