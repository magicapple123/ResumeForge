// SPDX-License-Identifier: Apache-2.0
/**
 * 简历预览：缩放条上的文案（2026-10-23 从 `PreviewZoomBar.tsx` 的内联中文迁出）。
 *
 * 为什么单开一份：缩放条从 `ResumePreview.tsx` 拆出来之后，那几句中文跟着换了文件，
 * `cjkRatchet` 的逐文件口径会把它判成"新写的硬编码中文"。这些确实是界面文案，
 * 迁到语言包才是正确出路（顺带让它们可翻译），不必加行内豁免。
 */
const preview = {
  /** 缩小按钮的 Tooltip。 */
  "preview.zoom.out": "缩小预览",
  /** 放大按钮的 Tooltip。 */
  "preview.zoom.in": "放大预览",
  /** 「适应页面」按钮的 Tooltip（含"重置"的解释）。 */
  "preview.zoom.fit": "适应页面（重置缩放）",
  /** 「适应页面」按钮的无障碍名（比 Tooltip 短，读屏不念括号）。 */
  "preview.zoom.reset": "适应页面",
  /** 缩放条尾部的快捷键提示。 */
  "preview.zoom.hint": "按住 Ctrl 滚滚轮可缩放",
} as const;

export default preview;
