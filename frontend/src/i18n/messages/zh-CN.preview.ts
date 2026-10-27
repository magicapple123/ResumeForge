// SPDX-License-Identifier: Apache-2.0
/**
 * 简历预览：缩放条与工具栏（预览口径切换、精确模式说明）上的文案。
 *
 * 为什么单开一份：缩放条从 `ResumePreview.tsx` 拆出来之后，那几句中文跟着换了文件，
 * `cjkRatchet` 的逐文件口径会把它判成"新写的硬编码中文"。这些确实是界面文案，
 * 迁到语言包才是正确出路（顺带让它们可翻译），不必加行内豁免。
 * 2026-10-27 起工具栏（`ResumePreviewToolbar.tsx`）剩下的口径切换文案也收进这里。
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

  /** 预览口径（草稿 / 精确）切换的无障碍名。 */
  "preview.mode.ariaLabel": "预览口径",
  /** 草稿档：按浏览器排版实时显示。 */
  "preview.mode.draft": "草稿",
  /** 草稿档 Tooltip：讲清"这是什么、什么时候用"（编辑时用这一档）。 */
  "preview.mode.draft.hint": "按浏览器排版实时显示，编辑时用这个",
  /** 精确档：服务端 PDF，与导出逐点相同。 */
  "preview.mode.exact": "精确",
  /** 精确档 Tooltip：讲清它与下载到的文件完全一致。 */
  "preview.mode.exact.hint": "按导出引擎排出的真实 PDF 显示，与下载到的文件完全一致",
  /** 精确模式下，度量控件下方那行常驻说明（缩放交给 PDF 查看器）——2026-10 从工具栏迁出。 */
  "preview.exact.note":
    "这一版由导出引擎排版，与下载到的 PDF 完全一致；缩放用 PDF 查看器自带的 Ctrl+滚轮",
} as const;

export default preview;
