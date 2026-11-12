// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台照片裁剪弹窗 · 四边可拖的裁剪框（2026-11 #18）。
 *
 * 守住的三条：
 * 1. 8 个手柄都在、可聚焦（`role="slider"`），整幅时右边手柄报 100%；
 * 2. 换比例后「应用裁剪」产出的矩形按该比例居中（1:1 on 3:4 原图 → w=1, h=0.75）；
 * 3. 换照片（`source.sha256` 不一致）时旧裁剪失效，回到整幅（验收 6）。
 *
 * 拖动/键盘的几何由 `cropGeometry` 与 `photoCrop.test.ts` 的纯函数守，这里只测接线。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { t } from "../../../i18n";
import { buildPhotoSource, createRectCropParams, type PhotoCropParams } from "../preview/photoCrop";
import PhotoCropDialog from "./PhotoCropDialog";

// jsdom 不解码图片，`usePhotoDimensions` 永远拿不到尺寸；这里直接给尺寸。
vi.mock("../preview/usePhotoDimensions", () => ({
  usePhotoDimensions: () => ({ width: 1200, height: 1600 }),
}));

const PHOTO = "data:image/png;base64,iVBORw0KGgo=";
const SOURCE = buildPhotoSource(PHOTO, 1200, 1600);
const noop = () => undefined;

function renderDialog(props: Partial<Parameters<typeof PhotoCropDialog>[0]> = {}) {
  const base = {
    open: true,
    photo: PHOTO,
    initialCrop: null as PhotoCropParams | null,
    onClose: noop,
    onApply: noop,
    onNotice: noop,
  };
  return render(<PhotoCropDialog {...base} {...props} />);
}

afterEach(cleanup);

describe("PhotoCropDialog · 四边可拖的裁剪框（#18）", () => {
  it("默认整幅：8 个手柄可聚焦，四边/四角都有名字", () => {
    renderDialog();
    const handles = screen.getAllByRole("slider");
    expect(handles).toHaveLength(8);
    for (const key of ["n", "s", "e", "w", "nw", "ne", "sw", "se"] as const) {
      expect(screen.getByRole("slider", { name: t(`proview.photo.handle.${key}`) })).toBeEnabled();
    }
    // 整幅时右边手柄的位置就是 100%。
    expect(screen.getByRole("slider", { name: t("proview.photo.handle.e") })).toHaveAttribute(
      "aria-valuenow",
      "100",
    );
    expect(screen.getByRole("button", { name: t("proview.photo.reset") })).toBeEnabled();
    expect(screen.getByRole("button", { name: t("document.photo.cropApply") })).toBeEnabled();
  });

  it("选 1:1 后应用：矩形按 3:4 原图居中裁成正方形", () => {
    const onApply = vi.fn();
    renderDialog({ onApply });
    fireEvent.click(screen.getByRole("radio", { name: t("proview.photo.aspect.square") }));
    fireEvent.click(screen.getByRole("button", { name: t("document.photo.cropApply") }));
    expect(onApply).toHaveBeenCalledTimes(1);
    const params = onApply.mock.calls[0][0] as PhotoCropParams;
    expect(params.version).toBe(1);
    expect(params.aspect).toBe("1:1");
    expect(params.rect.w).toBe(1);
    expect(params.rect.h).toBeCloseTo(0.75, 4);
    expect(params.rect.x).toBe(0);
    expect(params.rect.y).toBeCloseTo(0.125, 4);
  });

  it("已保存参数：再打开原样还原，直接应用矩形不变", () => {
    const onApply = vi.fn();
    const saved = createRectCropParams(SOURCE, { x: 0.2, y: 0.1, w: 0.5, h: 0.4 }, "free");
    renderDialog({ onApply, initialCrop: saved });
    expect(screen.getByRole("slider", { name: t("proview.photo.handle.w") })).toHaveAttribute(
      "aria-valuenow",
      "20",
    );
    fireEvent.click(screen.getByRole("button", { name: t("document.photo.cropApply") }));
    const params = onApply.mock.calls[0][0] as PhotoCropParams;
    expect(params.rect).toEqual({ x: 0.2, y: 0.1, w: 0.5, h: 0.4 });
  });

  it("「恢复原图」回传 null（原图不动，参数删掉）", () => {
    const onApply = vi.fn();
    const saved = createRectCropParams(SOURCE, { x: 0.2, y: 0.1, w: 0.5, h: 0.4 }, "free");
    renderDialog({ onApply, initialCrop: saved });
    fireEvent.click(screen.getByRole("button", { name: t("proview.photo.reset") }));
    expect(onApply).toHaveBeenCalledWith(null);
  });

  it("换照片后旧裁剪失效：sha 不一致就回到整幅（验收 6）", () => {
    const onApply = vi.fn();
    const stale = createRectCropParams(
      { sha256: "b".repeat(64), width: 1200, height: 1600 },
      { x: 0.2, y: 0.1, w: 0.5, h: 0.4 },
      "free",
    );
    renderDialog({ onApply, initialCrop: stale });
    expect(screen.getByRole("slider", { name: t("proview.photo.handle.w") })).toHaveAttribute(
      "aria-valuenow",
      "0",
    );
    fireEvent.click(screen.getByRole("button", { name: t("document.photo.cropApply") }));
    const params = onApply.mock.calls[0][0] as PhotoCropParams;
    expect(params.rect).toEqual({ x: 0, y: 0, w: 1, h: 1 });
    expect(params.aspect).toBe("free");
  });
});
