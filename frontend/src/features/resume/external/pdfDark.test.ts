// SPDX-License-Identifier: Apache-2.0
/**
 * 暗色纸面配色（R12 / R22）的纯函数：滤镜参数是这套逻辑唯一的"魔法值"，
 * 抽出来钉住，组件里就只剩"按结果画"。
 *
 * 三件事必须成立：
 * 1. 浅色下不反色、白底（与改之前一致）；
 * 2. 暗色文字页反色，但底色用**反算色** `#e1e1e1`（反色后落成 #1e1e1e 炭灰），
 *    并且要开"照片层"把照片恢复原色；
 * 3. 扫描件不反色（整页就是一张图），只压暗。
 */
import { describe, expect, it } from "vitest";
import {
  DARK_PAPER_HEX,
  LIGHT_PAPER_HEX,
  PDF_DARK_FILTER,
  SCAN_DIM_BRIGHTNESS,
  isScannedOriginal,
  pdfPaintPlan,
} from "./pdfDark";

describe("pdfPaintPlan", () => {
  it("浅色：不反色、白底、不叠 CSS 滤镜、不画照片层", () => {
    expect(pdfPaintPlan(false, false)).toEqual({
      invert: false,
      background: LIGHT_PAPER_HEX,
      canvasFilter: "none",
      imagesOverlay: false,
    });
    // 扫描件在浅色下同样不做事：压暗只在暗色里需要。
    expect(pdfPaintPlan(false, true).canvasFilter).toBe("none");
  });

  it("暗色文字页：反色 + 反算色纸底 + 开照片层", () => {
    const plan = pdfPaintPlan(true, false);
    expect(plan.invert).toBe(true);
    expect(plan.background).toBe(DARK_PAPER_HEX);
    expect(plan.canvasFilter).toBe("none");
    // 照片被反了色，必须用"只画图片"的图层盖回去（R22：照片保持原色）。
    expect(plan.imagesOverlay).toBe(true);
  });

  it("暗色扫描件：整页不反色，只叠 brightness(.84)", () => {
    const plan = pdfPaintPlan(true, true);
    expect(plan.invert).toBe(false);
    expect(plan.background).toBe(LIGHT_PAPER_HEX);
    expect(plan.canvasFilter).toBe(`brightness(${SCAN_DIM_BRIGHTNESS})`);
    expect(plan.imagesOverlay).toBe(false);
  });

  it("滤镜串与内部简历同一组参数", () => {
    expect(PDF_DARK_FILTER).toBe("invert(1) hue-rotate(180deg)");
    expect(SCAN_DIM_BRIGHTNESS).toBeLessThan(1);
  });

  it("扫描件判定看有没有文字层", () => {
    expect(isScannedOriginal(false)).toBe(true);
    expect(isScannedOriginal(true)).toBe(false);
  });
});
