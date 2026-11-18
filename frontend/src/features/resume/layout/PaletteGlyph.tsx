// SPDX-License-Identifier: Apache-2.0
/**
 * 「颜色」按钮的自绘调色板图标（I-10）。
 *
 * ## 为什么不用 antd 图标
 *
 * 工具条是 `B / Тт / 颜色 / 链接` 四个按钮，原来颜色用的是 `FontColorsOutlined`——一个
 * 「A + 下方一条与文字等宽的横杠」。在这条**没有下划线按钮**的工具条里，那条横杠会被读成
 * 下划线，用户点开才发现是取色面板。`@ant-design/icons` 里没有调色板：
 * `BgColorsOutlined` 是 A + 油漆桶（读作背景色）、`HighlightOutlined` 是荧光笔（读作高亮）、
 * `FormatPainterOutlined` 是格式刷。**换回任何一个 antd 图标都会复现这处误读**。
 *
 * ## 三条硬约束
 *
 * 1. `width/height="1em"`：跟着按钮字号缩放，写死 16px 会在不同 `size` 的按钮里错位；
 * 2. 全部 `currentColor`：浅色/深色主题下自动跟随，写死色值会固定成其中一个主题的黑；
 * 3. `aria-hidden`：按钮的无障碍名来自 `aria-label`，图标本身不该被读出来。
 *
 * 描边取 1.2（16 网格上的中间值）：1 太细，比 B / Тт 的视觉重量轻一档；1.5 以上又会显得
 * 比 antd 图标粗。中间那一格小圆点用 `fill`，是调色板与"色块网格"的区别所在。
 */
export default function PaletteGlyph() {
  return (
    <svg
      viewBox="0 0 16 16"
      width="1em"
      height="1em"
      fill="none"
      stroke="currentColor"
      strokeWidth="1.2"
      strokeLinecap="round"
      strokeLinejoin="round"
      aria-hidden="true"
      focusable="false"
    >
      {/* 调色板轮廓：左上留出拇指孔所在的缺口 */}
      <path d="M8 2.2a5.8 5.8 0 1 0 0 11.6c.9 0 1.3-.6 1.3-1.2 0-.9-.7-1.2-.7-1.9 0-.6.5-1 1.2-1h1.3c1.4 0 2.4-.9 2.4-2.4C13.5 4.6 11.1 2.2 8 2.2Z" />
      {/* 三个颜料点（12 点 / 3 点 / 7 点方向），fill 让它们在缩小时仍可辨 */}
      <circle cx="5.9" cy="5.6" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="10.2" cy="6.1" r="0.9" fill="currentColor" stroke="none" />
      <circle cx="6.1" cy="9.6" r="0.9" fill="currentColor" stroke="none" />
    </svg>
  );
}
