// SPDX-License-Identifier: Apache-2.0
/**
 * 文件类型判定的边界：MIME 不可信时扩展名优先、MIME 带参数也要认、都没有就落到 `other`。
 *
 * 这些用例守的是列表徽标的正确性：`text/plain` 配 `.md` 必须显示 MD（Windows 上的常见组合），
 * 而 `application/octet-stream` 配 `.pdf` 必须显示 PDF（浏览器说不清时的万能 MIME）。
 */
import { describe, expect, it } from "vitest";
import { fileKindBadge, fileKindOf } from "./fileKind";

describe("fileKindOf", () => {
  it("按扩展名判定，MIME 说别的也以扩展名为准", () => {
    expect(fileKindOf("text/plain", "resume.md")).toBe("markdown");
    expect(fileKindOf("application/octet-stream", "resume.pdf")).toBe("pdf");
    expect(fileKindOf("application/octet-stream", "resume.docx")).toBe("docx");
  });

  it("扩展名大写也认", () => {
    expect(fileKindOf("", "RESUME.PDF")).toBe("pdf");
    expect(fileKindOf("", "Resume.DocX")).toBe("docx");
  });

  it("没有扩展名时回落到 MIME（含 charset 参数）", () => {
    expect(fileKindOf("application/pdf", "resume")).toBe("pdf");
    expect(fileKindOf("text/plain; charset=utf-8", "resume")).toBe("text");
    expect(fileKindOf("application/msword", "resume")).toBe("doc");
    expect(
      fileKindOf(
        "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        "resume",
      ),
    ).toBe("docx");
  });

  it("白名单外的 text/* 也算文本，其余是 other", () => {
    expect(fileKindOf("text/csv", "resume")).toBe("text");
    expect(fileKindOf("image/png", "photo.png")).toBe("other");
    expect(fileKindOf("", "")).toBe("other");
  });

  it("隐藏文件的开头点不算扩展名", () => {
    expect(fileKindOf("text/plain", ".gitignore")).toBe("text");
  });
});

describe("fileKindBadge", () => {
  it("已知类型给格式名，未知类型交给调用方取文案", () => {
    expect(fileKindBadge("pdf")).toBe("PDF");
    expect(fileKindBadge("docx")).toBe("DOCX");
    expect(fileKindBadge("doc")).toBe("DOC");
    expect(fileKindBadge("markdown")).toBe("MD");
    expect(fileKindBadge("text")).toBe("TXT");
    expect(fileKindBadge("other")).toBeNull();
  });
});
