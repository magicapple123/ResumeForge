// SPDX-License-Identifier: Apache-2.0
/**
 * 资料箱编辑弹窗：附件上传合并成一个「添加附件」+ 多格式分派 + 批量上限（第 23+24 条）。
 *
 * 重点钉住：
 * 1. 只有一个入口、一份 accept（含 pdf/docx，不含 .doc），不再有「添加图片 / 添加文本文件」；
 * 2. 一次多选时串行上传，第 5 张图片 / 第 11 个附件被拦下（闭包旧值会让全部通过）；
 * 3. .doc 在选文件那一刻就被拒并提示另存为 .docx；
 * 4. 扫描件警告常驻显示，但仍允许加入。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { MaterialAttachment } from "../../types";
import { MATERIAL_ATTACHMENT_ACCEPT } from "../../utils/attachments";
import { t } from "../../i18n";
import MaterialFormModal from "./MaterialFormModal";

const upload = vi.hoisted(() => vi.fn());
vi.mock("../../api/material", () => ({ uploadMaterialAttachment: upload }));

let nextId = 1;

function fileOf(name: string, type: string, content = "x"): File {
  return new File([content], name, { type });
}

function responseFor(file: File): MaterialAttachment {
  const suffix = file.name.split(".").pop()?.toLowerCase() ?? "";
  const isImage = ["png", "jpg", "jpeg", "webp"].includes(suffix);
  return {
    file_id: nextId++,
    name: file.name,
    mime_type: isImage ? "image/png" : "text/plain",
    size_bytes: file.size,
    text: isImage ? "" : "extracted text " + file.name,
    data_url: isImage ? "data:image/png;base64,AAAA" : "",
    warnings: [],
  };
}

function renderModal(props: Partial<React.ComponentProps<typeof MaterialFormModal>> = {}) {
  const onCancel = vi.fn();
  const onSubmit = vi.fn();
  const view = render(
    <AntdApp>
      <MaterialFormModal
        open
        material={null}
        categories={["Certificates"]}
        submitting={false}
        onCancel={onCancel}
        onSubmit={onSubmit}
        {...props}
      />
    </AntdApp>,
  );
  return { ...view, onCancel, onSubmit };
}

/** 弹窗渲染在 body 的 portal 里，不能只在 render 的 container 上找。 */
function fileInput(): HTMLInputElement {
  const input = document.querySelector('input[type="file"]');
  if (!(input instanceof HTMLInputElement)) throw new Error("upload input not found");
  return input;
}

beforeEach(() => {
  nextId = 1;
  upload.mockReset().mockImplementation(async (file: File) => responseFor(file));
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("MaterialFormModal attachments", () => {
  it("has a single add-attachment entry whose accept is the shared material whitelist", () => {
    renderModal();

    expect(
      screen.getAllByRole("button", { name: t("materialForm.action.addAttachment") }),
    ).toHaveLength(1);

    const accept = fileInput().getAttribute("accept") ?? "";
    expect(accept).toBe(MATERIAL_ATTACHMENT_ACCEPT);
    // 反证（清单 §24.6）：accept 必须含 pdf/docx，且不把旧版 .doc 当成支持项。
    expect(accept.split(",")).toContain(".pdf");
    expect(accept.split(",")).toContain(".docx");
    expect(accept.split(",")).not.toContain(".doc");
    // 拖拽区与按钮共用同一份 accept：只有一个上传入口，不存在两套白名单。
    expect(document.querySelectorAll(".file-drop-zone")).toHaveLength(1);
  });

  it("uploads image and text files from one multiple selection through the same endpoint", async () => {
    renderModal();
    fireEvent.change(fileInput(), {
      target: {
        files: [fileOf("screenshot.png", "image/png"), fileOf("review.md", "text/markdown")],
      },
    });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(2));
    expect(upload.mock.calls.map((call) => (call[0] as File).name)).toEqual([
      "screenshot.png",
      "review.md",
    ]);
    expect(await screen.findByText("screenshot.png")).toBeInTheDocument();
    expect(screen.getByText("review.md")).toBeInTheDocument();
  });

  it("rejects .doc at selection time with the save-as-docx hint", async () => {
    renderModal();
    fireEvent.change(fileInput(), {
      target: { files: [fileOf("legacy.doc", "application/msword")] },
    });

    expect(await screen.findByText(t("materialForm.error.legacyDoc"))).toBeInTheDocument();
    expect(upload).not.toHaveBeenCalled();
  });

  it("blocks the 5th image even when five are selected at once (serial queue, not stale closure)", async () => {
    renderModal();
    const images = Array.from({ length: 5 }, (_, index) =>
      fileOf("img-" + index + ".png", "image/png"),
    );
    fireEvent.change(fileInput(), { target: { files: images } });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(4));
    expect(
      await screen.findByText(t("materialForm.error.maxImages", { count: 4 })),
    ).toBeInTheDocument();
  });

  it("blocks the 11th attachment and keeps ten", async () => {
    renderModal();
    const files = Array.from({ length: 11 }, (_, index) =>
      fileOf("file-" + index + ".txt", "text/plain"),
    );
    fireEvent.change(fileInput(), { target: { files } });

    await waitFor(() => expect(upload).toHaveBeenCalledTimes(10));
    expect(
      await screen.findByText(t("materialForm.error.maxFiles", { count: 10 })),
    ).toBeInTheDocument();
  });

  it("shows extraction warnings persistently but still adds the attachment", async () => {
    upload.mockImplementation(async (file: File) => ({
      ...responseFor(file),
      warnings: ["scanned-pdf-has-no-text-layer"],
    }));
    renderModal();
    fireEvent.change(fileInput(), {
      target: { files: [fileOf("scanned.pdf", "application/pdf")] },
    });

    expect(await screen.findByText(t("materialForm.warning.attachmentTitle"))).toBeInTheDocument();
    expect(screen.getByText("scanned.pdf")).toBeInTheDocument();
  });

  it("dispatches dropped files and explains a dropped .doc specifically", async () => {
    renderModal();
    const zone = document.querySelector(".file-drop-zone");
    if (!zone) throw new Error("drop zone not found");

    fireEvent.drop(zone, {
      dataTransfer: { files: [fileOf("dropped.txt", "text/plain")], types: ["Files"] },
    });
    await waitFor(() => expect(upload).toHaveBeenCalledTimes(1));
    expect(await screen.findByText("dropped.txt")).toBeInTheDocument();

    fireEvent.drop(zone, {
      dataTransfer: { files: [fileOf("dropped.doc", "application/msword")], types: ["Files"] },
    });
    expect(await screen.findByText(t("materialForm.error.legacyDoc"))).toBeInTheDocument();
    expect(upload).toHaveBeenCalledTimes(1);
  });

  it("removes an added attachment from the list", async () => {
    renderModal();
    fireEvent.change(fileInput(), {
      target: { files: [fileOf("removable.txt", "text/plain")] },
    });

    const remove = await screen.findByRole("button", {
      name: t("materialForm.aria.removeFile", { name: "removable.txt" }),
    });
    fireEvent.click(remove);
    await waitFor(() => expect(screen.queryByText("removable.txt")).toBeNull());
  });
});
