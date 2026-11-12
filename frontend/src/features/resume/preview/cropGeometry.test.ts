// SPDX-License-Identifier: Apache-2.0
/**
 * 裁剪框的**纯几何**回归（2026-11 #18）。
 *
 * 这组断言对应清单「验收」1/2/4：
 * 1. 拖一条边只有那条边动（允许变形），松手夹回比例（夹取在 `photoCrop.ts`）；
 * 2. 按住 Ctrl 拖动全程保持比例，松手不跳；
 * 3. 方向键 1% / Shift 5%，且与鼠标共用同一套夹取。
 *
 * 另外守 `fitContain` / `normalizePoint`：显示区是 `object-fit: contain`，指针坐标
 * 必须先减掉 letterbox，否则拖到边缘时框会与手指错位——这是最容易被漏测的一处。
 */
import { describe, expect, it } from "vitest";
import {
  CROP_HANDLES,
  arrowDelta,
  cropBoxPercent,
  fitContain,
  handleCursor,
  handleDirection,
  maskBoxes,
  normalizePoint,
  normalizedDelta,
  nudgeCropRect,
  resizeCropRect,
} from "./cropGeometry";
import { fitCropRectToAspect } from "./photoCrop";

const SOURCE_SQUARE = { sha256: "a".repeat(64), width: 1000, height: 1000 };
const SOURCE_PORTRAIT = { sha256: "b".repeat(64), width: 900, height: 1200 };

const OPTS = { minSize: 0.1, lockAspect: false };

describe("fitContain / normalizePoint（letterbox 换算）", () => {
  it("容器比图胖时左右留白，图片居中", () => {
    const box = fitContain({ width: 400, height: 400 }, { width: 200, height: 400 });
    expect(box).toEqual({ left: 100, top: 0, width: 200, height: 400 });
  });

  it("指针落在图片正中 → 0.5/0.5（先减容器位置再减留白）", () => {
    const stage = { left: 50, top: 20, width: 400, height: 400 };
    const image = fitContain({ width: 400, height: 400 }, { width: 200, height: 400 });
    expect(normalizePoint(50 + 100 + 100, 20 + 200, stage, image)).toEqual({ x: 0.5, y: 0.5 });
  });

  it("指针在留白里 → 夹到 0（不出现负坐标）", () => {
    const stage = { left: 0, top: 0, width: 400, height: 400 };
    const image = fitContain({ width: 400, height: 400 }, { width: 200, height: 400 });
    expect(normalizePoint(10, 200, stage, image)).toEqual({ x: 0, y: 0.5 });
  });

  it("位移按图片实际显示宽度折算（不是容器宽度）", () => {
    const image = { left: 100, top: 0, width: 200, height: 400 };
    expect(normalizedDelta(130, 0, 100, 0, image)).toEqual({ x: 0.15, y: 0 });
  });
});

describe("resizeCropRect（拖动中允许变形）", () => {
  it("拖右边：只有 w 变，左缘与高度不动", () => {
    const next = resizeCropRect(
      { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
      {
        handle: "e",
        delta: { x: 0.1, y: 0.3 },
        ...OPTS,
      },
    );
    expect(next).toEqual({ x: 0.1, y: 0.2, w: 0.6, h: 0.4 });
  });

  it("拖上边：y 变、h 变小，w 与 x 不动", () => {
    const next = resizeCropRect(
      { x: 0.1, y: 0.2, w: 0.5, h: 0.4 },
      {
        handle: "n",
        delta: { x: 0.3, y: 0.1 },
        ...OPTS,
      },
    );
    expect(next.w).toBe(0.5);
    expect(next.x).toBe(0.1);
    expect(next.y).toBeCloseTo(0.3, 4);
    expect(next.h).toBeCloseTo(0.3, 4);
  });

  it("拖角：两条轴一起变（自由变形）", () => {
    const next = resizeCropRect(
      { x: 0.1, y: 0.1, w: 0.4, h: 0.4 },
      {
        handle: "se",
        delta: { x: 0.2, y: 0.1 },
        ...OPTS,
      },
    );
    expect(next.w).toBeCloseTo(0.6, 4);
    expect(next.h).toBeCloseTo(0.5, 4);
  });

  it("最小边长兜底：往内拖过头也只到 minSize", () => {
    const next = resizeCropRect(
      { x: 0.1, y: 0.1, w: 0.5, h: 0.5 },
      {
        handle: "e",
        delta: { x: -1, y: 0 },
        ...OPTS,
      },
    );
    expect(next.w).toBe(0.1);
  });
});

describe("Ctrl 等比（lockAspect）", () => {
  it("拖右边时高度同比例放大，w/h 保持拖动开始时的比值", () => {
    const start = { x: 0.25, y: 0.25, w: 0.5, h: 0.5 };
    const next = resizeCropRect(start, {
      handle: "e",
      delta: { x: 0.1, y: 0 },
      minSize: 0.1,
      lockAspect: true,
    });
    expect(next.w).toBeCloseTo(0.6, 4);
    expect(next.h).toBeCloseTo(0.6, 4);
    expect(next.w / next.h).toBeCloseTo(start.w / start.h, 6);
    // 垂直方向以中心为锚：上下各长 0.05。
    expect(next.y).toBeCloseTo(0.2, 4);
  });

  it("放大到边界就停住，不会越界（比例仍成立）", () => {
    const next = resizeCropRect(
      { x: 0, y: 0, w: 0.5, h: 0.5 },
      {
        handle: "se",
        delta: { x: 2, y: 2 },
        minSize: 0.1,
        lockAspect: true,
      },
    );
    expect(next.x).toBeGreaterThanOrEqual(0);
    expect(next.y).toBeGreaterThanOrEqual(0);
    expect(next.x + next.w).toBeLessThanOrEqual(1.0001);
    expect(next.y + next.h).toBeLessThanOrEqual(1.0001);
    expect(next.w / next.h).toBeCloseTo(1, 4);
  });
});

describe("松手夹回比例（中心锚点）", () => {
  it("free 只夹边界，不改比例", () => {
    const next = fitCropRectToAspect({ x: -0.1, y: 0.1, w: 0.6, h: 0.3 }, "free", SOURCE_SQUARE);
    expect(next).toEqual({ x: 0, y: 0.1, w: 0.6, h: 0.3 });
  });

  it("1:1 时把 0.6×0.3 夹成正方形，中心尽量不动", () => {
    const next = fitCropRectToAspect({ x: 0.2, y: 0.35, w: 0.6, h: 0.3 }, "1:1", SOURCE_SQUARE);
    expect(next.w / next.h).toBeCloseTo(1, 4);
    // 中心：原 (0.5, 0.5)；夹取后仍应落在原中心附近（允许边界夹取造成的偏移）。
    expect(next.x + next.w / 2).toBeCloseTo(0.5, 2);
    expect(next.y + next.h / 2).toBeCloseTo(0.5, 2);
  });

  it("3:4 竖图锁 3:4 时矩形铺满原图比例（w=1, h=1）", () => {
    const next = fitCropRectToAspect({ x: 0, y: 0, w: 1, h: 1 }, "3:4", SOURCE_PORTRAIT);
    expect(next.w).toBeCloseTo(1, 4);
    expect(next.h).toBeCloseTo(1, 4);
  });
});

describe("键盘微调（1% / Shift 5%）", () => {
  it("右边按 → 每次 1%，Shift 是 5%", () => {
    const one = nudgeCropRect({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, "e", "ArrowRight", 0.01, {
      minSize: 0.1,
      lockAspect: false,
    });
    expect(one.w).toBeCloseTo(0.51, 4);
    const fast = nudgeCropRect({ x: 0.1, y: 0.1, w: 0.5, h: 0.5 }, "e", "ArrowRight", 0.05, {
      minSize: 0.1,
      lockAspect: false,
    });
    expect(fast.w).toBeCloseTo(0.55, 4);
  });

  it("上边按 ← 不适用（该轴不动）→ 矩形原样返回", () => {
    const rect = { x: 0.1, y: 0.1, w: 0.5, h: 0.5 };
    expect(arrowDelta("n", "ArrowLeft", 0.01)).toBeNull();
    expect(nudgeCropRect(rect, "n", "ArrowLeft", 0.01, { minSize: 0.1, lockAspect: false })).toBe(
      rect,
    );
  });

  it("左缘按 ← 是往外拉（x 变小、w 变大）", () => {
    const next = nudgeCropRect({ x: 0.2, y: 0.1, w: 0.5, h: 0.5 }, "w", "ArrowLeft", 0.01, {
      minSize: 0.1,
      lockAspect: false,
    });
    expect(next.x).toBeCloseTo(0.19, 4);
    expect(next.w).toBeCloseTo(0.51, 4);
  });
});

describe("渲染辅助量", () => {
  it("8 个手柄方向与光标各自成立", () => {
    expect(CROP_HANDLES).toHaveLength(8);
    expect(handleDirection("n")).toEqual({ x: 0, y: -1 });
    expect(handleDirection("se")).toEqual({ x: 1, y: 1 });
    expect(handleCursor("n")).toBe("ns-resize");
    expect(handleCursor("e")).toBe("ew-resize");
    expect(handleCursor("nw")).toBe("nwse-resize");
    expect(handleCursor("ne")).toBe("nesw-resize");
  });

  it("框外遮罩是四块，合起来刚好铺满且不盖住框", () => {
    const box = { left: 10, top: 20, width: 50, height: 40 };
    const masks = maskBoxes(box);
    expect(masks).toHaveLength(4);
    expect(masks[0]).toEqual({ left: 0, top: 0, width: 100, height: 20 });
    expect(masks[1]).toEqual({ left: 0, top: 60, width: 100, height: 40 });
    expect(masks[2]).toEqual({ left: 0, top: 20, width: 10, height: 40 });
    expect(masks[3]).toEqual({ left: 60, top: 20, width: 40, height: 40 });
  });

  it("百分比定位把图片留白算进去（contain 的 letterbox）", () => {
    const image = { left: 100, top: 0, width: 200, height: 400 };
    const percent = cropBoxPercent(
      { x: 0.5, y: 0.5, w: 0.5, h: 0.5 },
      { width: 400, height: 400 },
      image,
    );
    expect(percent).toEqual({ left: 50, top: 50, width: 25, height: 50 });
  });
});
