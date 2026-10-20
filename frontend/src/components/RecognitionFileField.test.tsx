/**
 * 识别前的文件暂存区（T6）：三种文件的预览形态与删除入口。
 *
 * 口径是"预览上传的文件本身，不是识别结果"：图片给缩略图（点开可放大），PDF 交给浏览器
 * 内置阅读器，docx 说明清楚不支持预览——给一个点了会报错的按钮比没有按钮更糟。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, within } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { StagedFile } from "../hooks/useRecognitionFiles";
import RecognitionFileField from "./RecognitionFileField";
import { formatFileSize, isPdfFile } from "./RecognitionFilePreview";

const PNG_DATA_URL = "data:image/png;base64,iVBORw0KGgo=";

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

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  vi.restoreAllMocks();
});

describe("RecognitionFileField 预览（T6）", () => {
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

  it("PDF 给「预览」入口，点它把文件交给浏览器内置阅读器", () => {
    const open = vi.spyOn(window, "open").mockImplementation(() => null);
    const pdf = makeFile({
      id: 2,
      name: "岗位描述.pdf",
      mime_type: "application/pdf",
      kind: "document",
      data: "data:application/pdf;base64,JVBERi0=",
      size: 1024 * 1024 * 1.5,
    });
    renderField([pdf]);

    expect(screen.getByText("岗位描述.pdf")).toBeInTheDocument();
    // 体积按一位小数：1.5 MB。
    expect(screen.getByText("1.5 MB")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "预览 岗位描述.pdf" }));

    expect(open).toHaveBeenCalledWith(
      "data:application/pdf;base64,JVBERi0=",
      "_blank",
      "noopener,noreferrer",
    );
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
      makeFile({
        id: 12,
        name: "b.pdf",
        mime_type: "application/pdf",
        kind: "document",
        data: "data:application/pdf;base64,JVBERi0=",
        size: 4096,
      }),
    ]);

    const rows = document.querySelectorAll(".recognition-file-item");
    expect(rows).toHaveLength(2);
    fireEvent.click(within(rows[1] as HTMLElement).getByRole("button", { name: "移除文件 b.pdf" }));

    expect(onRemove).toHaveBeenCalledWith(12);
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
