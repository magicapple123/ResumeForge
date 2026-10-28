// SPDX-License-Identifier: Apache-2.0
/**
 * 附件预览弹层的三种形态：图片看大图、文档看提取出的文本、什么都没有时明确告知。
 *
 * 之所以要三种都钉住：后端对 `data_url` 只收**图片** data URL，文档在库里只有
 * `text`（提取出的文本层）。所以"文档点开是空的"不是小概率事件——每种形态都得有
 * 一条自己的渲染路径，不能让用户点开看到一个空白弹层。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { MaterialFile } from "../../types";
import { t } from "../../i18n";
import { AttachmentPreviewModal } from "./AttachmentPreviewModal";

function makeFile(overrides: Partial<MaterialFile> = {}): MaterialFile {
  return {
    name: "attachment.bin",
    mime_type: "",
    size_bytes: 1024,
    text: "",
    data_url: "",
    ...overrides,
  };
}

function renderModal(file: MaterialFile | null) {
  return render(
    <AntdApp>
      <AttachmentPreviewModal file={file} onClose={vi.fn()} />
    </AntdApp>,
  );
}

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("AttachmentPreviewModal", () => {
  it("图片（有 data_url）→ 弹层里是大图，标题是文件名", async () => {
    renderModal(
      makeFile({
        name: "certificate.png",
        mime_type: "image/png",
        data_url: "data:image/png;base64,iVBORw0KGgo=",
      }),
    );

    const image = await screen.findByRole("img", { name: "certificate.png" });
    expect(image).toBeInTheDocument();
    // 标题用的是文件名。
    expect(screen.getAllByText("certificate.png").length).toBeGreaterThan(0);
    // 图片不会出现"这是提取文本"的说明。
    expect(screen.queryByText(t("materials.attachments.previewTextNote"))).toBeNull();
  });

  it("文档（只有 text）→ 展示提取出的全文 + 说明这不是原件排版", async () => {
    const extracted = "第一段经历\n第二段经历\nGPA 3.8";
    renderModal(makeFile({ name: "resume.pdf", mime_type: "application/pdf", text: extracted }));

    expect(await screen.findByText(t("materials.attachments.previewTextNote"))).toBeInTheDocument();
    // 换行必须保留（white-space: pre-wrap），否则整份提取文本会挤成一行。
    // 用 DOM 查询而不是中文 `*ByText`：测试里的中文断言同样计入存量棘轮。
    expect(document.querySelector(".material-preview-text")?.textContent).toBe(extracted);
  });

  it("既没图片也没文本 → 明确告知没有可预览的内容", async () => {
    renderModal(
      makeFile({
        name: "empty.docx",
        mime_type: "application/vnd.openxmlformats-officedocument.wordprocessingml.document",
        text: "",
      }),
    );

    expect(await screen.findByText(t("materials.attachments.previewEmpty"))).toBeInTheDocument();
    expect(screen.queryByText(t("materials.attachments.previewTextNote"))).toBeNull();
  });

  it("file 为 null 时不渲染内容（弹层关闭）", () => {
    renderModal(null);

    expect(screen.queryByText(t("materials.attachments.previewEmpty"))).toBeNull();
    expect(screen.queryByRole("img")).toBeNull();
  });
});
