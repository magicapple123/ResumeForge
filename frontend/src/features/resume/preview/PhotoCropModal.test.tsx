// SPDX-License-Identifier: Apache-2.0
/**
 * 照片裁剪弹窗（D09 / #18）：非破坏参数 + 四边可拖的裁剪框。
 *
 * 与制作台那张 `PhotoCropDialog` 的区别：这里多「移除照片」与"按纸面宽度算清晰度"，
 * 所以单独守一遍；裁剪框本身的几何由 `cropGeometry` / `photoCrop.test.ts` 守。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { buildPhotoSource, createRectCropParams, type PhotoCropParams } from "./photoCrop";
import PhotoCropModal from "./PhotoCropModal";

// jsdom 不解码图片：直接给尺寸，让裁剪几何与清晰度提示可确定。
vi.mock("./usePhotoDimensions", () => ({
  usePhotoDimensions: () => ({ width: 1200, height: 1600 }),
}));

const PHOTO = "data:image/png;base64,AAAA";
/** 与 `PHOTO` 同指纹的来源：换照片失效判据靠它，测试不能编一个假 sha。 */
const SOURCE = buildPhotoSource(PHOTO, 1200, 1600);

function renderModal(props: Partial<Parameters<typeof PhotoCropModal>[0]> = {}) {
  const base = {
    open: true,
    onClose: vi.fn(),
    photo: PHOTO,
    initialCrop: null as PhotoCropParams | null,
    onApply: vi.fn(),
  };
  return {
    ...render(
      <AntdApp>
        <PhotoCropModal {...base} {...props} />
      </AntdApp>,
    ),
    ...base,
    ...props,
  };
}

afterEach(() => {
  cleanup();
  localStorage.clear();
  sessionStorage.clear();
});

describe("照片非破坏裁剪（D09 / #18）", () => {
  it("打开显示原因片尺寸与「不会被覆盖」承诺；裁剪框 8 个手柄可操作", () => {
    renderModal();
    expect(screen.getByText(t("proview.photo.title"))).toBeInTheDocument();
    expect(
      screen.getByText(t("proview.photo.source", { width: 1200, height: 1600 })),
    ).toBeInTheDocument();
    expect(screen.getByText(t("proview.photo.hint"))).toBeInTheDocument();
    expect(screen.getByRole("img", { name: t("proview.photo.previewAlt") })).toBeInTheDocument();
    expect(
      screen.getByRole("radio", { name: t("proview.photo.aspect.original") }),
    ).toBeInTheDocument();
    expect(screen.getAllByRole("slider")).toHaveLength(8);
    expect(screen.getByText(t("proview.photo.boxHint"))).toBeInTheDocument();
  });

  it("应用裁剪：回传归一化参数（原图引用由 source 指纹表达，不是重编码图）", () => {
    const onApply = vi.fn();
    const onClose = vi.fn();
    renderModal({ onApply, onClose });
    fireEvent.click(screen.getByRole("button", { name: t("proview.photo.apply") }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const params = onApply.mock.calls[0][0];
    expect(params.version).toBe(1);
    expect(params.aspect).toBe("free");
    expect(params.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(params.source).toMatchObject({ width: 1200, height: 1600 });
    expect(params.source.sha256).toMatch(/^[0-9a-f]{64}$/);
    expect(onClose).toHaveBeenCalledTimes(1);
  });

  it("比例锁定：选 1:1 后参数矩形按 3:4 原图居中裁成正方形", () => {
    const onApply = vi.fn();
    renderModal({ onApply });
    fireEvent.click(screen.getByRole("radio", { name: t("proview.photo.aspect.square") }));
    fireEvent.click(screen.getByRole("button", { name: t("proview.photo.apply") }));
    const params = onApply.mock.calls[0][0];
    expect(params.aspect).toBe("1:1");
    expect(params.rect.w).toBe(1);
    expect(params.rect.h).toBeCloseTo(0.75, 4);
    expect(params.rect.y).toBeCloseTo(0.125, 4);
  });

  it("有已保存参数时「恢复原图」可用并回传 null；没有时不可用", () => {
    const onApply = vi.fn();
    renderModal({ onApply, initialCrop: null });
    expect(screen.getByRole("button", { name: t("proview.photo.reset") })).toBeDisabled();
    cleanup();
    const saved = createRectCropParams(SOURCE, { x: 0.2, y: 0.1, w: 0.5, h: 0.4 }, "free");
    renderModal({ onApply, initialCrop: saved });
    // 可恢复：重新打开时裁剪框回到保存时的左缘 20%。
    expect(screen.getByRole("slider", { name: t("proview.photo.handle.w") })).toHaveAttribute(
      "aria-valuenow",
      "20",
    );
    fireEvent.click(screen.getByRole("button", { name: t("proview.photo.reset") }));
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("清晰度提示：纸面 300mm 宽时提示可能发虚（只提示，不阻止保存）", () => {
    renderModal({ printedWidthMm: 300 });
    expect(
      screen.getByText(t("proview.photo.clarity.warn", { width: 1200, height: 1600 })),
    ).toBeInTheDocument();
    expect(screen.getByRole("button", { name: t("proview.photo.apply") })).toBeEnabled();
  });

  it("移除照片是独立危险动作，就地确认后走宿主回调", () => {
    const onRemove = vi.fn();
    renderModal({ onRemove });
    fireEvent.click(screen.getByRole("button", { name: t("proview.photo.remove") }));
    expect(screen.getByText(t("proview.photo.removeBody"))).toBeInTheDocument();
    // Popconfirm 的确认按钮与 footer 那颗同名：最后出现的那一颗才是卡片里的确认。
    const confirmButtons = screen.getAllByRole("button", {
      name: t("proview.photo.removeConfirm"),
    });
    fireEvent.click(confirmButtons[confirmButtons.length - 1]);
    expect(onRemove).toHaveBeenCalledTimes(1);
  });
});
