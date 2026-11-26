// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑页左栏的**段落清单**（R9-5 改造后的形态）。
 *
 * 改之前这里画的是 PDF 页面 + 百分比热区；改之后 PDF 只在「原件」页签，
 * 编辑页对三种格式都给同一份清单：序号 / 摘要 / 页内位置 / 标题·正文·锁定。
 *
 * 守四件事：
 * 1. 不再画 canvas（PDF 已经不在这一页）；
 * 2. 块上写清"第几页第几段"（DOCX 没有页码时写「第 N 段」）；
 * 3. 不可编辑的块点不动，原因码翻成人话写在行内；
 * 4. 大面积字号的那一块被标成「标题」（PDF 才有的信息，没有字号时一律正文）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ExternalResumeBlocks } from "../../../api/externalResumes";
import { t } from "../../../i18n";
import { ExternalResumeEditor } from "./ExternalResumeEditor";

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
      text: "黄岑果",
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

describe("ExternalResumeEditor（PDF 块清单）", () => {
  it("不再画 canvas：PDF 只在原件页，这里只是清单", () => {
    render(<ExternalResumeEditor blocks={PDF_BLOCKS} selectedId={null} onSelect={vi.fn()} />);

    expect(screen.queryByTestId("external-original-canvas")).toBeNull();
    expect(document.querySelector("canvas")).toBeNull();
    expect(screen.getByTestId("external-editor")).toHaveTextContent(
      t("externalEdit.blocks.count", { editable: 1, total: 2 }),
    );
  });

  it("块上写清页内位置；字号最大的那块标「标题」", () => {
    render(<ExternalResumeEditor blocks={PDF_BLOCKS} selectedId={null} onSelect={vi.fn()} />);

    const title = screen.getByTestId("external-block-p1b0");
    expect(title).toHaveTextContent(t("externalEdit.block.label", { page: 1, index: 1 }));
    expect(title).toHaveTextContent(t("externalEdit.block.roleTitle"));
    expect(screen.getByTestId("external-block-p1b1")).toHaveTextContent(
      t("externalEdit.block.roleBody"),
    );
  });

  it("点中可编辑块回传 block_id，并标记为选中", () => {
    const onSelect = vi.fn();
    render(<ExternalResumeEditor blocks={PDF_BLOCKS} selectedId="p1b0" onSelect={onSelect} />);

    const block = screen.getByTestId("external-block-p1b0");
    expect(block).toHaveAttribute("aria-pressed", "true");
    fireEvent.click(block);
    expect(onSelect).toHaveBeenCalledWith("p1b0");
  });

  it("不可编辑的块不让点，并把原因码翻成人话写在行内", () => {
    const onSelect = vi.fn();
    render(<ExternalResumeEditor blocks={PDF_BLOCKS} selectedId={null} onSelect={onSelect} />);

    const locked = screen.getByTestId("external-block-p1b1");
    expect(locked).toBeDisabled();
    expect(locked).toHaveTextContent(t("externalEdit.block.locked"));
    expect(locked).toHaveTextContent(t("externalEdit.reason.pdf_block_rotated"));
    fireEvent.click(locked);
    expect(onSelect).not.toHaveBeenCalled();
  });
});

describe("ExternalResumeEditor（DOCX / TXT）", () => {
  it("没有页码时写「第 N 段」，也没有字号信息就不硬标标题", () => {
    render(<ExternalResumeEditor blocks={DOCX_BLOCKS} selectedId={null} onSelect={vi.fn()} />);

    const paragraph = screen.getByTestId("external-block-d0");
    expect(paragraph).toHaveTextContent(t("externalEdit.block.labelNoPage", { index: 1 }));
    expect(paragraph).toHaveTextContent(t("externalEdit.block.roleBody"));
    expect(screen.queryAllByTestId(/^external-block-roleTitle/)).toHaveLength(0);
  });

  it("表格里的段落在行内直接说明原因", () => {
    const onSelect = vi.fn();
    render(<ExternalResumeEditor blocks={DOCX_BLOCKS} selectedId={null} onSelect={onSelect} />);

    const inTable = screen.getByTestId("external-block-d1");
    expect(inTable).toBeDisabled();
    expect(inTable).toHaveTextContent(t("externalEdit.reason.docx_text_in_table"));
    fireEvent.click(screen.getByTestId("external-block-d0"));
    expect(onSelect).toHaveBeenCalledWith("d0");
  });
});
