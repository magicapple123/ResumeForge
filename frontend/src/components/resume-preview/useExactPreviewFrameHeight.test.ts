// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览的**高度算术**（2026-11-06 用户截图：上限 2/3 页、内容 1 页时中间空一大截灰）。
 *
 * 为什么单独测纯函数而不是渲染后量像素：jsdom 量不到宽度（`ResizeObserverMock` 只占位、
 * 不投递回调），渲染出来的 `frameHeight` 永远是"退回宿主 height"那条分支——按宽度定高
 * 的算术在组件测试里根本走不到。把这套算术抽成 `exactPreviewFrameHeight()` 之后，
 * 页高、页间距、两种兜底都能直接断言。
 *
 * 三条必须成立的性质：
 * 1. 单页高只由**宽度**决定（A4 比例），不写死 1123——中栏分隔条可拖，宽度随时在变；
 * 2. `pages>1` 时相邻两页之间留一道 `FRAME_PAGE_GAP_PX`（查看器自己的页间距）；
 * 3. 量不到宽度（`width <= 0`）/ 还没有结果（`pages <= 0`）时退回宿主给的 `height`，
 *    **绝不产出 0 高相框**。
 */
import { describe, expect, it } from "vitest";
import { A4_HEIGHT_PX, A4_WIDTH_PX } from "./config";
import {
  FRAME_PAGE_GAP_PX,
  exactPreviewFrameHeight,
  exactPreviewPageHeight,
} from "./useExactPreviewFrameHeight";

describe("精确预览 · 相框高度算术", () => {
  it("单页高 = 宽度 × A4 高宽比（A4 @96dpi 的 794 → 1123）", () => {
    expect(exactPreviewPageHeight(A4_WIDTH_PX)).toBe(A4_HEIGHT_PX);
    // 中栏更窄时页高跟着缩：900 × 297/210 ≈ 1272.9 → 1273。
    expect(exactPreviewPageHeight(900)).toBe(1273);
  });

  it("页数 × 单页高 + 页间距：1 页不额外加间距，3 页加两道", () => {
    const pageHeight = exactPreviewPageHeight(A4_WIDTH_PX);
    expect(exactPreviewFrameHeight(A4_WIDTH_PX, 1, 600)).toBe(pageHeight);
    expect(exactPreviewFrameHeight(A4_WIDTH_PX, 2, 600)).toBe(pageHeight * 2 + FRAME_PAGE_GAP_PX);
    expect(exactPreviewFrameHeight(A4_WIDTH_PX, 3, 600)).toBe(
      pageHeight * 3 + FRAME_PAGE_GAP_PX * 2,
    );
  });

  it("量不到宽度 / 还没有结果时退回宿主给的 height，绝不产出 0 高", () => {
    // jsdom、首次布局之前、面板在 hidden 容器里（草稿模式）都会走到 width = 0。
    expect(exactPreviewFrameHeight(0, 1, 600)).toBe(600);
    expect(exactPreviewFrameHeight(-1, 3, 480)).toBe(480);
    // 还没有任何结果：显示的是加载占位，高度不该跳。
    expect(exactPreviewFrameHeight(A4_WIDTH_PX, 0, 600)).toBe(600);
    // 任何输入都不该得到 0。
    expect(exactPreviewFrameHeight(0, 0, 1)).toBe(1);
  });
});
