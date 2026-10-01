/** 附件类型判定与限额：助手和识别两条链路共用这一份实现。 */

import { describe, expect, it } from "vitest";
import {
  ASSISTANT_ACCEPT,
  DOCUMENT_MIME_BY_EXTENSION,
  MAX_ATTACHMENT_BYTES,
  MAX_ATTACHMENT_COUNT,
  MAX_TOTAL_ATTACHMENT_BYTES,
  RECOGNITION_ACCEPT,
  canPreviewImage,
  classifyAttachment,
  clipboardImages,
} from "./attachments";

function fileOf(name: string, type: string, size = 8): File {
  return new File([new Uint8Array(size)], name, { type });
}

describe("classifyAttachment", () => {
  it("accepts images whose extension and MIME agree", () => {
    expect(classifyAttachment(fileOf("shot.png", "image/png"))).toEqual({
      kind: "image",
      mimeType: "image/png",
    });
    expect(classifyAttachment(fileOf("shot.JPG", "image/jpeg"))).toEqual({
      kind: "image",
      mimeType: "image/jpeg",
    });
  });

  it("accepts the image formats the backend transcodes", () => {
    expect(classifyAttachment(fileOf("board.bmp", "image/bmp"))).toEqual({
      kind: "image",
      mimeType: "image/bmp",
    });
    expect(classifyAttachment(fileOf("scan.tiff", "image/tiff"))).toEqual({
      kind: "image",
      mimeType: "image/tiff",
    });
  });

  it("accepts documents", () => {
    expect(classifyAttachment(fileOf("jd.pdf", "application/pdf"))).toEqual({
      kind: "document",
      mimeType: "application/pdf",
    });
    expect(classifyAttachment(fileOf("resume.docx", DOCUMENT_MIME_BY_EXTENSION.docx))).toEqual({
      kind: "document",
      mimeType: DOCUMENT_MIME_BY_EXTENSION.docx,
    });
    // 少数系统报 application/octet-stream，交给后端按文件头判定
    expect(classifyAttachment(fileOf("resume.docx", "application/octet-stream"))).toEqual({
      kind: "document",
      mimeType: DOCUMENT_MIME_BY_EXTENSION.docx,
    });
  });

  it("rejects a file whose extension and declared type disagree", () => {
    expect(classifyAttachment(fileOf("shot.png", "image/jpeg"))).toBeNull();
    expect(classifyAttachment(fileOf("resume.exe", "text/plain"))).toBeNull();
    expect(classifyAttachment(fileOf("resume.docx", "application/pdf"))).toBeNull();
  });

  it("rejects unsupported extensions", () => {
    expect(classifyAttachment(fileOf("photo.heic", "image/heic"))).toBeNull();
    expect(classifyAttachment(fileOf("archive.zip", "application/zip"))).toBeNull();
  });

  it("accepts text attachments for the assistant", () => {
    expect(classifyAttachment(fileOf("notes.md", "text/markdown"))).toEqual({
      kind: "text",
      mimeType: "text/markdown",
    });
    // 浏览器给不出类型时按扩展名兜底
    expect(classifyAttachment(fileOf("notes.txt", ""))).toEqual({
      kind: "text",
      mimeType: "text/plain",
    });
  });
});

describe("accept lists", () => {
  it("covers the formats each entry point accepts", () => {
    // 识别弹窗只收截图与文档：文本直接粘在输入框里
    expect(RECOGNITION_ACCEPT).toContain(".png");
    expect(RECOGNITION_ACCEPT).toContain(".tiff");
    expect(RECOGNITION_ACCEPT).toContain(".pdf");
    expect(RECOGNITION_ACCEPT).toContain(".docx");
    expect(RECOGNITION_ACCEPT).not.toContain(".txt");
    // 助手附件三类都收
    expect(ASSISTANT_ACCEPT).toContain(".txt");
    expect(ASSISTANT_ACCEPT).toContain(".pdf");
  });
});

describe("canPreviewImage", () => {
  it("keeps TIFF out of the preview", () => {
    expect(canPreviewImage("image/png")).toBe(true);
    expect(canPreviewImage("image/bmp")).toBe(true);
    expect(canPreviewImage("image/tiff")).toBe(false);
  });
});

describe("clipboardImages", () => {
  function clipboardOf(items: Array<{ kind: string; type: string; file?: File }>) {
    return {
      items: items.map((item) => ({
        kind: item.kind,
        type: item.type,
        getAsFile: () => item.file ?? null,
      })),
    } as unknown as DataTransfer;
  }

  it("只取图片，文本条目一律略过", () => {
    const image = fileOf("shot.png", "image/png");
    const files = clipboardImages(
      clipboardOf([
        { kind: "string", type: "text/plain" },
        { kind: "file", type: "image/png", file: image },
        { kind: "file", type: "application/pdf", file: fileOf("x.pdf", "application/pdf") },
      ]),
    );

    expect(files.map((file) => file.name)).toEqual(["shot.png"]);
  });

  it("给没有文件名的 blob 补一个能过 classifyAttachment 的名字", () => {
    // 有些截图工具给的 blob 没有名字，而类型判定是按扩展名来做的。
    const nameless = new File([new Uint8Array(8)], "", { type: "image/png" });

    const files = clipboardImages(
      clipboardOf([
        { kind: "file", type: "image/png", file: nameless },
        { kind: "file", type: "image/webp", file: new File([], "", { type: "image/webp" }) },
      ]),
    );

    expect(files.map((file) => file.name)).toEqual(["clipboard-1.png", "clipboard-2.webp"]);
    expect(classifyAttachment(files[0])).toEqual({ kind: "image", mimeType: "image/png" });
  });

  it("没有图片、或根本没有剪贴板数据时返回空数组", () => {
    expect(clipboardImages(null)).toEqual([]);
    expect(clipboardImages(clipboardOf([{ kind: "string", type: "text/plain" }]))).toEqual([]);
  });
});

describe("limits", () => {
  it("matches the backend contract", () => {
    // 这些值必须与 backend/app/services/attachments.py 一致
    expect(MAX_ATTACHMENT_COUNT).toBe(4);
    expect(MAX_ATTACHMENT_BYTES).toBe(2 * 1024 * 1024);
    expect(MAX_TOTAL_ATTACHMENT_BYTES).toBe(5 * 1024 * 1024);
    // base64 会把体积放大约三分之一，合计上限必须留在后端 8 MB 请求体之内
    expect((MAX_TOTAL_ATTACHMENT_BYTES * 4) / 3).toBeLessThan(8 * 1024 * 1024);
  });
});
