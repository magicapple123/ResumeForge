// SPDX-License-Identifier: Apache-2.0
/**
 * 浮层落点纯函数（DF-3 的抽出口）。四种形态各钉一条：
 * 下方优先、下方放不下翻上（底边贴锚点）、左右夹取、上下都放不下时的夹取兜底。
 *
 * 投投浮条（`selectionMenuPosition`）与行内格式右键菜单共用这一份，
 * 参数差异只在 `gap` / `margin` / `alignX`。
 */
import { describe, expect, it } from "vitest";
import { anchoredPlacement, triggerTargetOffset, type PlacementRect } from "./anchoredPlacement";

const VIEWPORT = { width: 1_200, height: 800 };

function point(x: number, y: number): PlacementRect {
  return { top: y, left: x, right: x, bottom: y, width: 0, height: 0 };
}

function rect(top: number, left: number, width: number, height: number): PlacementRect {
  return { top, left, right: left + width, bottom: top + height, width, height };
}

describe("anchoredPlacement", () => {
  it("下方放得下：左上角贴光标 + gap（右键菜单形态）", () => {
    const placement = anchoredPlacement(
      point(100, 100),
      VIEWPORT,
      { width: 220, height: 280 },
      {
        gap: 4,
        alignX: "start",
      },
    );
    expect(placement).toEqual({ top: 104, left: 100, side: "below" });
  });

  it("下方放不下：翻到上方，底边贴光标 - gap", () => {
    const placement = anchoredPlacement(
      point(100, 700),
      VIEWPORT,
      { width: 220, height: 280 },
      {
        gap: 4,
        alignX: "start",
      },
    );
    expect(placement.side).toBe("above");
    expect(placement.top + 280).toBe(696);
    expect(placement.left).toBe(100);
  });

  it("右侧贴边：左移夹进视口，不溢出", () => {
    const placement = anchoredPlacement(
      point(1_150, 100),
      VIEWPORT,
      { width: 220, height: 280 },
      { gap: 4, alignX: "start" },
    );
    expect(placement.left).toBe(1_200 - 220);
  });

  it("左侧贴边：不出现负坐标", () => {
    const placement = anchoredPlacement(
      point(-20, 100),
      VIEWPORT,
      { width: 220, height: 280 },
      {
        gap: 4,
        alignX: "start",
      },
    );
    expect(placement.left).toBe(0);
  });

  it("上下都放不下（浮层比视口高）：留在下方并夹进视口", () => {
    const placement = anchoredPlacement(
      point(100, 400),
      { width: 1_200, height: 600 },
      { width: 220, height: 700 },
      { gap: 4, alignX: "start", margin: 8 },
    );
    expect(placement.side).toBe("below");
    expect(placement.top).toBe(8);
  });

  it("划词浮条形态：中心对齐 + 8px 间距 + 8px 视口边距", () => {
    const placement = anchoredPlacement(
      rect(100, 400, 100, 20),
      VIEWPORT,
      { width: 320, height: 44 },
      { gap: 8, margin: 8 },
    );
    expect(placement.side).toBe("below");
    expect(placement.top).toBe(128);
    expect(placement.left + 160).toBe(450);
  });
});

describe("triggerTargetOffset", () => {
  // rc-trigger 会把 targetOffset **从目标矩形里减去**；这条用"宿主 - 偏移 = 落点"
  // 的不变式钉住符号。2026-11-18 实机复核发现旧实现写成了"落点 - 宿主"，
  // 结果菜单位置以宿主为轴镜像偏移（点得越靠右，菜单越往左飘）。
  it("宿主减去偏移后正好落在目标点", () => {
    const host = { left: 466, top: 334 };
    const placement = { left: 509, top: 363 };
    const offset = triggerTargetOffset(host, placement);
    expect(offset).toEqual([-43, -29]);
    expect({ left: host.left - offset[0], top: host.top - offset[1] }).toEqual(placement);
  });
});
