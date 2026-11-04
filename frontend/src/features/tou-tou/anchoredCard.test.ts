// SPDX-License-Identifier: Apache-2.0
/**
 * 球旁浮卡的夹取算术（问题 8-A）。
 *
 * jsdom 不做布局，`getBoundingClientRect` 全 0，所以"卡片有没有越界"这件事只能在
 * 纯函数这一层断言。这里覆盖规格给的三组变量（球在左 / 居中 / 靠右 × 卡宽 120 / 240
 * × 视口 360 / 1280），并额外钉住几个手算过的具体数字——它们同时是"球在右下角时
 * 与旧 CSS 逐像素一致"的证据。
 */
import { describe, expect, it } from "vitest";
import { clampAnchoredCard, clampTipLeft, type AnchoredTipSide } from "./anchoredCard";

/** 球直径：与 `.tt-shell` 的 `--tt-size` 一致（≤767px 时 CSS 会降到 56）。 */
const ORB = 64;
/** 视口最小间距。 */
const MARGIN = 8;

const VIEWPORTS = [360, 1280];
const CARD_WIDTHS = [120, 240];

/** 球在三个位置上的左缘坐标：贴左 24 / 居中 / 贴右 24。 */
function orbLefts(viewportWidth: number): Record<string, number> {
  return {
    center: (viewportWidth - ORB) / 2,
    left: 24,
    right: viewportWidth - 24 - ORB,
  };
}

interface Case {
  cardWidth: number;
  orbLeft: number;
  position: string;
  viewportWidth: number;
}

const CASES: Case[] = VIEWPORTS.flatMap((viewportWidth) =>
  Object.entries(orbLefts(viewportWidth)).flatMap(([position, orbLeft]) =>
    CARD_WIDTHS.map((cardWidth) => ({ cardWidth, orbLeft, position, viewportWidth })),
  ),
);

describe("clampAnchoredCard：任何位置都不越出视口", () => {
  it.each(CASES)(
    "视口 $viewportWidth / 球 $position（x=$orbLeft）/ 卡宽 $cardWidth",
    ({ cardWidth, orbLeft, viewportWidth }) => {
      const { left } = clampAnchoredCard({ cardWidth, orbLeft, orbSize: ORB, viewportWidth });

      // 规格的两条硬断言。
      expect(left).toBeGreaterThanOrEqual(MARGIN);
      expect(left + cardWidth).toBeLessThanOrEqual(viewportWidth - MARGIN);
    },
  );
});

describe("clampAnchoredCard：尾巴对准球心且留在卡片内", () => {
  it.each(CASES)(
    "视口 $viewportWidth / 球 $position / 卡宽 $cardWidth",
    ({ cardWidth, orbLeft, viewportWidth }) => {
      const { tailRight } = clampAnchoredCard({ cardWidth, orbLeft, orbSize: ORB, viewportWidth });

      expect(tailRight).toBeGreaterThanOrEqual(MARGIN);
      expect(tailRight).toBeLessThanOrEqual(cardWidth - MARGIN);
    },
  );
});

describe("clampAnchoredCard：具体数字（球在右下角时与旧 CSS 一致）", () => {
  it("球贴右（默认位置）：卡右缘贴球右缘，尾巴偏移仍是 --tt-size / 2 - 7 = 25", () => {
    // 视口 1280：球左缘 1280 - 24 - 64 = 1192。旧 CSS 是 right: 0 → 卡右缘 1256。
    const placement = clampAnchoredCard({
      cardWidth: 240,
      orbLeft: 1192,
      orbSize: ORB,
      viewportWidth: 1280,
    });

    expect(placement.left).toBe(1016);
    expect(placement.tailRight).toBe(25);
    expect(placement.align).toBe("right");
  });

  it("球贴左（x=24）：卡片改左对齐贴住球左缘，尾巴仍指向球心（卡宽 240 → 201）", () => {
    const placement = clampAnchoredCard({
      cardWidth: 240,
      orbLeft: 24,
      orbSize: ORB,
      viewportWidth: 1280,
    });

    // 右对齐要 left = 24 + 64 - 240 = -152（越界）→ 改左对齐 24。
    expect(placement.left).toBe(24);
    // 卡右缘 264 距球心 56 有 208，退掉半个三角宽 → 201。
    expect(placement.tailRight).toBe(201);
    expect(placement.align).toBe("left");
  });

  it("球贴左、窄卡（120）：尾巴随卡片变窄跟着收，仍对准球心", () => {
    const placement = clampAnchoredCard({
      cardWidth: 120,
      orbLeft: 24,
      orbSize: ORB,
      viewportWidth: 1280,
    });

    expect(placement.left).toBe(24);
    expect(placement.tailRight).toBe(81);
    expect(placement.align).toBe("left");
  });

  it("球居中（1280 视口）：右对齐够用，尾巴落回 25", () => {
    const placement = clampAnchoredCard({
      cardWidth: 240,
      orbLeft: 608,
      orbSize: ORB,
      viewportWidth: 1280,
    });

    expect(placement.left).toBe(432);
    expect(placement.tailRight).toBe(25);
    expect(placement.align).toBe("right");
  });

  it("两侧都不够（360 视口 + 240 卡 + 球居中）：夹进视口，tailRight 仍在界内", () => {
    // 视口 360：球左缘 (360 - 64) / 2 = 148。右对齐 -28（越界），左对齐 388（也越界）。
    const placement = clampAnchoredCard({
      cardWidth: 240,
      orbLeft: 148,
      orbSize: ORB,
      viewportWidth: 360,
    });

    expect(placement.left).toBe(MARGIN);
    expect(placement.left + 240).toBeLessThanOrEqual(360 - MARGIN);
    expect(placement.tailRight).toBe(61);
  });

  it("窗口从 1280 缩到 360：同一张卡被重新夹回视口内", () => {
    const wide = clampAnchoredCard({
      cardWidth: 240,
      orbLeft: 1192,
      orbSize: ORB,
      viewportWidth: 1280,
    });
    const narrow = clampAnchoredCard({
      cardWidth: 240,
      orbLeft: 24,
      orbSize: ORB,
      viewportWidth: 360,
    });

    expect(wide.left).toBe(1016);
    expect(narrow.left).toBe(24);
    expect(narrow.left + 240).toBeLessThanOrEqual(360 - MARGIN);
    // 窄屏球会缩到 56，同样不能越界。
    const smallOrb = clampAnchoredCard({
      cardWidth: 240,
      orbLeft: 16,
      orbSize: 56,
      viewportWidth: 360,
    });
    expect(smallOrb.left).toBe(16);
    expect(smallOrb.left + 240).toBeLessThanOrEqual(360 - MARGIN);
  });

  it("卡宽超过视口时仍有解（max-width 兜底），left 不小于 8", () => {
    const placement = clampAnchoredCard({
      cardWidth: 400,
      orbLeft: 20,
      orbSize: ORB,
      viewportWidth: 360,
    });

    expect(placement.left).toBe(MARGIN);
  });

  it("margin 可覆盖：传 16 时左右各留 16", () => {
    const placement = clampAnchoredCard({
      cardWidth: 240,
      margin: 16,
      orbLeft: 24,
      orbSize: ORB,
      viewportWidth: 360,
    });

    expect(placement.left).toBeGreaterThanOrEqual(16);
    expect(placement.left + 240).toBeLessThanOrEqual(360 - 16);
  });
});

describe("clampTipLeft：小贴士（.tt-tip）的三种摆法都夹在视口里", () => {
  const SIDES: AnchoredTipSide[] = ["left", "right", "top", "bottom"];

  it.each(
    VIEWPORTS.flatMap((viewportWidth) =>
      Object.entries(orbLefts(viewportWidth)).flatMap(([position, orbLeft]) =>
        SIDES.map((side) => ({ orbLeft, position, side, viewportWidth })),
      ),
    ),
  )("视口 $viewportWidth / 球 $position / 贴边 $side", ({ orbLeft, side, viewportWidth }) => {
    const cardWidth = 280;
    const left = clampTipLeft({ cardWidth, orbLeft, orbSize: ORB, side, viewportWidth });

    expect(left).toBeGreaterThanOrEqual(MARGIN);
    expect(left + cardWidth).toBeLessThanOrEqual(viewportWidth - MARGIN);
  });

  it("球在中间、气泡贴上下边：水平居中在球上", () => {
    // 球心 180，气泡 280 → 40。360 视口的上限是 84，装得下。
    expect(
      clampTipLeft({
        cardWidth: 280,
        orbLeft: 148,
        orbSize: ORB,
        side: "bottom",
        viewportWidth: 360,
      }),
    ).toBe(40);
    expect(
      clampTipLeft({
        cardWidth: 280,
        orbLeft: 608,
        orbSize: ORB,
        side: "top",
        viewportWidth: 1280,
      }),
    ).toBe(500);
  });

  it("球贴左 / 贴右：气泡挂在球旁边，被视口挤回来时仍留 8px", () => {
    // 贴左：球右缘 88 + 12 = 100，但 100 + 280 = 380 > 352 → 夹到 72。
    expect(
      clampTipLeft({ cardWidth: 280, orbLeft: 24, orbSize: ORB, side: "left", viewportWidth: 360 }),
    ).toBe(72);
    // 贴右：球左缘 272 - 280 - 12 = -20 → 夹到 8。
    expect(
      clampTipLeft({
        cardWidth: 280,
        orbLeft: 272,
        orbSize: ORB,
        side: "right",
        viewportWidth: 360,
      }),
    ).toBe(MARGIN);
  });
});
