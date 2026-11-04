// SPDX-License-Identifier: Apache-2.0
/**
 * 页眉「照片 chip」与「照片裁剪」的组件行为（#25 / 任务 6）。
 *
 * 覆盖：缩略图渲染、更换 / 裁剪 / 移除三动作、无照片时的禁用入口、
 * 裁剪写 photo_crop（非破坏）、恢复原图、移除时清裁剪、缩略图按取景显示。
 *
 * 从 DocumentEditor.header.test.tsx 拆出（2026-11-04，按 500 行预算拆分）：用例与
 * 断言原样搬迁，渲染辅助与照片夹具见 src/test/documentEditorHeaderHarness.tsx。
 *
 * 断言文案一律走 `t()`：中文 ByText 会撞 cjkRatchet 的 tests 口径。
 */
import { fireEvent, screen, within } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import { t } from "../../i18n";
import { makeDocument } from "../../features/resume-document/documentFixtures";
import { photoSha256 } from "../../features/resume-proview/photoCrop";
import type { ResumeDocument } from "../../types/resumeDocument";
import {
  PHOTO,
  cropOf,
  croppedConfig,
  headerChip,
  lastDocument,
  lastLayout,
  mainButton,
  renderEditor,
  renderWithLayout,
  withPhoto,
} from "../../test/documentEditorHeaderHarness";

/**
 * 任务 6：裁剪弹窗需要原图像素尺寸（`usePhotoDimensions` 用 `new Image()` 解码，jsdom 不会
 * 解码任何图片）。默认仍是 `null`（保持既有用例里「正在读取照片尺寸…」那条），需要几何的
 * 用例自己设 `photoState.dims`。
 *
 * vitest 的 mock 注册是文件级的，所以声明留在本文件（同 trackerPageHarness 的约定）。
 */
const photoState = vi.hoisted(() => ({
  dims: null as { width: number; height: number } | null,
}));

vi.mock("../../features/resume-proview/usePhotoDimensions", () => ({
  usePhotoDimensions: () => photoState.dims,
}));

describe("DocumentEditor · 照片 chip（#25）", () => {
  it("照片渲染成缩略图，不把 base64 铺成文本", () => {
    const { container } = renderEditor(withPhoto());
    const chip = headerChip("document.headerField.photo");
    const image = within(chip).getByRole("img", { name: t("document.photo.thumbnail") });
    expect(image).toHaveAttribute("src", PHOTO);
    expect(chip.textContent ?? "").not.toContain("data:image");
    expect(container.textContent ?? "").not.toContain("base64");
  });

  it("展开态给出更换 / 裁剪 / 移除三个动作，裁剪能打开弹窗", async () => {
    renderEditor(withPhoto());
    fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
    expect(
      screen.getByRole("button", { name: new RegExp(t("document.photo.replace")) }),
    ).toBeInTheDocument();
    const crop = screen.getByRole("button", { name: new RegExp(t("document.photo.crop")) });
    expect(
      screen.getByRole("button", { name: new RegExp(t("document.photo.remove")) }),
    ).toBeInTheDocument();
    fireEvent.click(crop);
    expect(await screen.findByText(t("document.photo.cropTitle"))).toBeInTheDocument();
    expect(screen.getByText(t("proview.photo.hint"))).toBeInTheDocument();
    // 图片尺寸还没读出来时给可读的占位（而不是一个空框 / 一张坏图）。
    expect(screen.getByText(t("document.photo.cropLoading"))).toBeInTheDocument();
  });

  it("移除照片把值清空（字段本身保留）", () => {
    const { onChange } = renderEditor(withPhoto());
    fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("document.photo.remove")) }));
    const photo = lastDocument(onChange).header.items.find((item) => item.key === "photo");
    expect(photo?.value).toBe("");
  });

  it("没有照片时裁剪入口存在但不可用（不留死按钮陷阱）", () => {
    const base = makeDocument();
    const document: ResumeDocument = {
      ...base,
      header: {
        ...base.header,
        items: [
          ...base.header.items,
          {
            kind: "field",
            id: "ob_head0004",
            key: "photo",
            label: "",
            value: "",
            placement: "photo",
            format: "text",
          },
        ],
      },
    };
    renderEditor(document);
    fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
    const crop = screen.getByRole("button", { name: new RegExp(t("document.photo.crop")) });
    expect(crop).toBeDisabled();
    expect(screen.getByText(t("document.photo.empty"))).toBeInTheDocument();
  });
});

// ===== 任务 6：照片裁剪改成非破坏（写 photo_crop，不动 item.value） =====

describe("DocumentEditor · 照片裁剪非破坏（任务 6）", () => {
  it("应用裁剪写进 format_config.photo_crop，页眉照片值一个字节都不变", async () => {
    photoState.dims = { width: 1200, height: 1600 };
    try {
      const { onChange, onLayoutChange } = renderWithLayout(withPhoto());
      fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
      fireEvent.click(screen.getByRole("button", { name: new RegExp(t("document.photo.crop")) }));
      fireEvent.click(await screen.findByRole("button", { name: t("document.photo.cropApply") }));

      // 照片值没被改：`onChange` 一次都不该因为裁剪而触发。
      expect(onChange).not.toHaveBeenCalled();
      // 哈希必须对应**原图**（后端用它对照片做失效判据）。
      expect(cropOf(lastLayout(onLayoutChange))?.source.sha256).toBe(photoSha256(PHOTO));
    } finally {
      photoState.dims = null;
    }
  });

  it("「恢复原图」删掉 photo_crop 域", async () => {
    photoState.dims = { width: 1200, height: 1600 };
    try {
      const { onLayoutChange } = renderWithLayout(withPhoto(), croppedConfig());
      fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
      fireEvent.click(screen.getByRole("button", { name: new RegExp(t("document.photo.crop")) }));
      fireEvent.click(await screen.findByRole("button", { name: t("proview.photo.reset") }));

      expect(cropOf(lastLayout(onLayoutChange))).toBeNull();
    } finally {
      photoState.dims = null;
    }
  });

  it("移除照片的同时清掉指向旧图的裁剪参数", () => {
    const { onChange, onLayoutChange } = renderWithLayout(withPhoto(), croppedConfig());
    fireEvent.doubleClick(mainButton(headerChip("document.headerField.photo")));
    fireEvent.click(screen.getByRole("button", { name: new RegExp(t("document.photo.remove")) }));

    const photo = lastDocument(onChange).header.items.find((item) => item.key === "photo");
    expect(photo?.value).toBe("");
    expect(cropOf(lastLayout(onLayoutChange))).toBeNull();
  });

  it("页眉 chip 的缩略图按裁剪参数显示取景（不再是整张原图）", () => {
    renderWithLayout(withPhoto(), croppedConfig({ x: 0.25, y: 0.25, w: 0.5, h: 0.5 }));
    const chip = headerChip("document.headerField.photo");
    const thumb = chip.querySelector(".rf-crop-thumb") as HTMLElement | null;
    expect(thumb).not.toBeNull();
    // 取景是 1200×1600 原图的中间一半 → 600×800，外层盒子比例 0.75。
    expect(thumb?.style.aspectRatio).toContain("0.75");
    // 内层 img 放大 2 倍并左/上各偏移 50%：这就是"只看中间那 1/4"。
    const img = thumb?.querySelector("img") as HTMLImageElement | null;
    expect(img?.style.width).toBe("200%");
    expect(img?.style.left).toBe("-50%");
  });
});
