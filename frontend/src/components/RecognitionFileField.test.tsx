// SPDX-License-Identifier: Apache-2.0
/**
 * 识别前的文件暂存区（T6 / 项 7）：三种文件的预览形态与删除入口。
 *
 * 口径是"预览上传的文件本身，不是识别结果"：图片给缩略图（点开可放大），PDF 由**服务端**
 * 渲染首页位图后在弹层里看，docx 说明清楚不支持预览——给一个点了会报错的按钮比没有按钮更糟。
 *
 * PDF 那条断言的重点不是"有个弹层"，而是**不再调用 `window.open`**：Chrome/Edge 早已
 * 禁止顶层导航到 `data:`，Electron 没有内置查看器，老实现必然失败。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { StagedFile } from "../hooks/useRecognitionFiles";
import RecognitionFileField from "./RecognitionFileField";
import { formatFileSize, isPdfFile } from "./RecognitionFilePreview";

// 与 `styles/color-regression.test.ts` 同一套写法：从磁盘读 CSS 原文（jsdom 测不出布局）。
declare const process: { cwd(): string };

const apiMocks = vi.hoisted(() => ({ previewPdf: vi.fn() }));

vi.mock("../api/attachments", () => ({ previewPdf: apiMocks.previewPdf }));

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";
const PDF_PAGE_IMAGE = "data:image/jpeg;base64,AAA";

function makeFile(overrides: Partial<StagedFile> = {}): StagedFile {
  return {
    id: 1,
    name: "screenshot.png",
    mime_type: "image/png",
    kind: "image",
    data: PNG_DATA_URL,
    size: 2048,
    ...overrides,
  };
}

function makePdf(overrides: Partial<StagedFile> = {}): StagedFile {
  return makeFile({
    id: 2,
    name: "岗位描述.pdf",
    mime_type: "application/pdf",
    kind: "document",
    data: "data:application/pdf;base64,JVBERi0=",
    size: 1024 * 1024 * 1.5,
    ...overrides,
  });
}

function renderField(files: StagedFile[], onRemove = vi.fn()) {
  render(
    <AntdApp>
      <RecognitionFileField
        files={files}
        reading={false}
        onAddFiles={vi.fn()}
        onRemove={onRemove}
      />
    </AntdApp>,
  );
  return onRemove;
}

beforeEach(() => {
  apiMocks.previewPdf.mockReset();
  apiMocks.previewPdf.mockResolvedValue({ pages: [{ page: 1, image: PDF_PAGE_IMAGE }] });
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("RecognitionFileField 预览（T6 / 项 7）", () => {
  it("图片出 48×48 缩略图（点开走 antd 预览组）", () => {
    renderField([makeFile({ name: "岗位截图.png" })]);

    const image = screen.getByRole("img", { name: "岗位截图.png" });
    expect(image).toHaveClass("recognition-image");
    expect(image).toHaveAttribute("src", PNG_DATA_URL);
    // 尺寸由 antd 的 Image 属性决定（width/height=48）：它写在包裹层上，
    // 内层 img 是 width: 100% + object-fit: cover。
    expect(image.closest(".ant-image")).toHaveStyle({ width: "48px", height: "48px" });
    expect(image).toHaveStyle({ objectFit: "cover" });
  });

  it("PDF 预览走服务端渲染：不调 window.open，弹层里显示首页图", async () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    renderField([makePdf()]);

    expect(screen.getByText("岗位描述.pdf")).toBeInTheDocument();
    // 体积按一位小数：1.5 MB。
    expect(screen.getByText("1.5 MB")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "预览 岗位描述.pdf" }));

    await waitFor(() =>
      expect(apiMocks.previewPdf).toHaveBeenCalledWith(
        expect.objectContaining({ name: "岗位描述.pdf", pages: 1 }),
      ),
    );
    // 核心回归：老实现把 data URL 交给 window.open，而顶层导航到 data: 已被平台禁止。
    expect(open).not.toHaveBeenCalled();
    expect(await screen.findByAltText("第 1 页")).toHaveAttribute("src", PDF_PAGE_IMAGE);
    expect(screen.getByText("预览 岗位描述.pdf")).toBeInTheDocument();
  });

  it("预览失败只说一句、不阻断识别（弹层关掉，文件还在列表里）", async () => {
    apiMocks.previewPdf.mockRejectedValueOnce(new Error("坏文件"));
    renderField([makePdf()]);

    fireEvent.click(screen.getByRole("button", { name: "预览 岗位描述.pdf" }));

    expect(await screen.findByText("这个文件预览不了，识别仍可正常使用")).toBeInTheDocument();
    // 文件本身没有被移除：预览失败不该影响"接下来要识别它"。
    expect(screen.getByText("岗位描述.pdf")).toBeInTheDocument();
  });

  it("docx 说明不支持预览，且不出现预览入口", () => {
    const docx = makeFile({
      id: 3,
      name: "简历.docx",
      mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
      kind: "document",
      data: "data:application/vnd.openxmlformats-officedocument.wordprocessingml.document;base64,UEs=",
      size: 900,
    });
    renderField([docx]);

    expect(screen.getByText("简历.docx")).toBeInTheDocument();
    expect(screen.getByText("900 B")).toBeInTheDocument();
    expect(screen.queryByRole("button", { name: /预览 简历.docx/ })).not.toBeInTheDocument();
  });

  it("删除按钮仍然可用，且按下标定位到对应文件", () => {
    const onRemove = renderField([
      makeFile({ id: 11, name: "a.png" }),
      makePdf({ id: 12, name: "b.pdf" }),
    ]);

    const rows = document.querySelectorAll(".recognition-file-item");
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: "移除文件 b.pdf" }));

    expect(onRemove).toHaveBeenCalledWith(12);
  });
});

/** D16：整行布局 + 体积不许换行（截图里「3 7 8 K B」竖排的根因）。 */
describe("文件条目的布局契约（D16）", () => {
  function css(): string {
    return readFileSync([process.cwd(), "src", "styles", "recognition.css"].join("/"), "utf8");
  }

  it("体积声明了 nowrap，且不再用两行网格", () => {
    const text = css();
    expect(text).toMatch(
      /\.recognition-file-item \.recognition-file-size\s*\{[^}]*white-space:\s*nowrap/,
    );
    // 原来的 `grid-template-rows: 48px auto` 正是"体积被挤成竖排"的来源。
    expect(text).not.toContain("grid-template-rows: 48px auto");
  });

  it("条目是整行 flex，动作区不收缩", () => {
    const text = css();
    expect(text).toMatch(/\.recognition-file-item\s*\{[^}]*display:\s*flex/);
    expect(text).toMatch(/\.recognition-file-actions\s*\{[^}]*flex:\s*0 0 auto/);
  });
});

describe("文件体积与类型判定", () => {
  it("格式化：B / KB / MB（MB 一位小数）", () => {
    expect(formatFileSize(0)).toBe("0 B");
    expect(formatFileSize(900)).toBe("900 B");
    expect(formatFileSize(2048)).toBe("2 KB");
    expect(formatFileSize(1024 * 1024)).toBe("1.0 MB");
    expect(formatFileSize(1024 * 1024 * 3.14)).toBe("3.1 MB");
  });

  it("PDF 判定看 MIME 或扩展名（用户给的 MIME 不一定可信）", () => {
    expect(isPdfFile(makeFile({ kind: "document", mime_type: "application/pdf" }))).toBe(true);
    expect(
      isPdfFile(
        makeFile({ kind: "document", name: "x.PDF", mime_type: "application/octet-stream" }),
      ),
    ).toBe(true);
    expect(isPdfFile(makeFile({ kind: "document", name: "x.docx", mime_type: "text/plain" }))).toBe(
      false,
    );
  });
});
