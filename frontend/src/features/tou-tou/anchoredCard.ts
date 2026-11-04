// SPDX-License-Identifier: Apache-2.0
/**
 * 球旁浮卡的视口夹取（问题 8-A）。
 *
 * 缺陷的根：`.tt-card` 的定位是**写死的右对齐 CSS**（`right: 0`，卡右缘贴 64px 壳的右缘），
 * 于是代码里藏着一个假设——"球永远在右下角"。球能拖到任意边，假设不成立：球贴左时整卡
 * 向左越界，标题被裁成「…改资料？」。同一个壳里因此存在两套定位哲学：大卡（助手卡 /
 * 剪贴板卡）算坐标（`useTouTouCardDrag` 的 `clampCardPosition`），小卡靠 CSS。
 *
 * 这里把"算坐标"这一半抽成纯函数，好让夹取规则可单测；DOM 那半边（量尺寸、写内联样式）
 * 在 `useTouTouAnchoredCard` 里。**不要**把夹取写成 `transform: translateX(...)`——
 * `.tt-card` 的入场动画 `tt-card-in` 本身就是 transform，两者会互相覆盖。
 */

/** 卡片与视口边缘之间至少要留出的间距（与悬浮球拖拽的 8px 一致）。 */
export const ANCHORED_CARD_MARGIN = 8;

/** 卡片与球之间留的横向间隙，只用于小贴士贴在球的左右两侧时。 */
export const ANCHORED_TIP_GAP = 12;

/**
 * 尾巴三角形的半宽：`right` 要让尾巴**中心**对准球心，所以从"卡右缘到球心"的距离里
 * 退掉半个宽度（与 `.tt-card-tail` 的 `border-left/right: 7px` 同源）。
 */
const TAIL_HALF_WIDTH = 7;

/** 卡片该从哪一侧长出来（决定 `transform-origin` 的水平分量）。 */
export type AnchoredCardAlign = "left" | "right";

/** 小贴士当前贴在球的哪一边（决定它摆在球的左右还是上下）。 */
export type AnchoredTipSide = "left" | "right" | "top" | "bottom";

export interface ClampAnchoredCardInput {
  /** 球（= 壳）左缘的**视口**坐标。 */
  orbLeft: number;
  /** 球直径（窄屏 CSS 会降到 56）。 */
  orbSize: number;
  /** 卡片实测宽度（`width: max-content` + `max-width: min(240px, 100vw - 32px)`）。 */
  cardWidth: number;
  /** 视口宽度（`window.innerWidth`）。 */
  viewportWidth: number;
  /** 与视口边缘的最小间距，默认 8。 */
  margin?: number;
}

export interface AnchoredCardPlacement {
  /** 卡片左缘的**视口**坐标。 */
  left: number;
  /** 尾巴的 `right` 偏移（相对卡片右缘），使尾巴中心始终对准球心。 */
  tailRight: number;
  /** 卡片相对球的方位：入场缩放从贴球的那一侧长出来。 */
  align: AnchoredCardAlign;
}

/** 把数值夹进 `[min, max]`；`min > max` 时以 `min` 为准（极窄视口下的兜底）。 */
function clamp(value: number, min: number, max: number): number {
  return Math.min(Math.max(value, min), max);
}

/**
 * 算出球旁卡片在视口里的存活位置。
 *
 * 规则（按优先级）：
 * 1. **优先右对齐**——卡片右缘贴球右缘。球在右下角（默认位置）时这一支命中，
 *    结果与原来的 CSS 逐像素一致。
 * 2. 右对齐会越过左边界（球被拖到左边）→ 改**左对齐**，卡左缘贴球左缘。
 * 3. 两侧都不够（视口比卡片还窄）→ 把右对齐的结果夹回 `[margin, viewportWidth - margin]`。
 *    `.tt-card` 的 `max-width: min(240px, 100vw - 32px)` 保证这一支一定有解。
 *
 * 尾巴的 `right` 由"卡右缘 ↔ 球心"的真实距离推出，并夹在 `[margin, cardWidth - margin]`
 * 之间——卡片被夹到视口里时球心可能落在卡片之外（球跑到了卡片左侧很远），
 * 不夹就会把三角画到卡片外面去。
 */
export function clampAnchoredCard(input: ClampAnchoredCardInput): AnchoredCardPlacement {
  const margin = input.margin ?? ANCHORED_CARD_MARGIN;
  const cardWidth = Math.max(0, input.cardWidth);
  const maxLeft = Math.max(margin, input.viewportWidth - margin - cardWidth);
  const orbCenter = input.orbLeft + input.orbSize / 2;

  // 右对齐：卡右缘贴球右缘。左对齐：卡左缘贴球左缘。
  const rightAligned = input.orbLeft + input.orbSize - cardWidth;
  const leftAligned = input.orbLeft;

  let left: number;
  if (rightAligned >= margin) {
    left = rightAligned;
  } else if (leftAligned + cardWidth <= input.viewportWidth - margin) {
    left = leftAligned;
  } else {
    left = clamp(rightAligned, margin, maxLeft);
  }
  left = clamp(left, margin, maxLeft);

  // 尾巴对准球心：从卡右缘往左量到球心，再退掉半个三角宽。
  const tailRight = clamp(
    left + cardWidth - orbCenter - TAIL_HALF_WIDTH,
    margin,
    Math.max(margin, cardWidth - margin),
  );

  // 缩放原点取"离球更近的那一侧"：球在卡片右半边就 100%，在左半边就 0%。
  const align: AnchoredCardAlign = orbCenter >= left + cardWidth / 2 ? "right" : "left";

  return { align, left, tailRight };
}

export interface ClampTipLeftInput {
  orbLeft: number;
  orbSize: number;
  /** 小贴士实测宽度。 */
  cardWidth: number;
  viewportWidth: number;
  side: AnchoredTipSide;
  margin?: number;
  gap?: number;
}

/**
 * 算出小贴士（`.tt-tip`）的夹取左缘。
 *
 * 与卡片不同，小贴士贴着球的**左边或右边**时可以横向排开（CSS 的 `is-edge-left` /
 * `is-edge-right` 就是这么摆的），贴着球的上下两边时才是水平居中对齐。三种摆法都可能
 * 撞出视口（`max-width: 280px` 在 360 视口上很容易越界），所以统一算一个 `left` 再夹。
 *
 * 返回**视口**坐标，调用方换算成相对壳的 px 写进内联样式。
 */
export function clampTipLeft(input: ClampTipLeftInput): number {
  const margin = input.margin ?? ANCHORED_CARD_MARGIN;
  const gap = input.gap ?? ANCHORED_TIP_GAP;
  const cardWidth = Math.max(0, input.cardWidth);
  const maxLeft = Math.max(margin, input.viewportWidth - margin - cardWidth);
  const orbCenter = input.orbLeft + input.orbSize / 2;

  let preferred: number;
  if (input.side === "left") {
    // 球贴左 → 气泡挂在球的右侧。
    preferred = input.orbLeft + input.orbSize + gap;
  } else if (input.side === "right") {
    // 球贴右 → 气泡挂在球的左侧。
    preferred = input.orbLeft - cardWidth - gap;
  } else {
    // 球贴顶 / 贴底 → 气泡水平居中在球上（原来的 `left: 50%; translateX(-50%)`）。
    preferred = orbCenter - cardWidth / 2;
  }
  return clamp(preferred, margin, maxLeft);
}
