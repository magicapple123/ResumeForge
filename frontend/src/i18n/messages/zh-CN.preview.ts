// SPDX-License-Identifier: Apache-2.0
/**
 * 简历预览：缩放条与工具栏（预览口径切换、精确模式说明）上的文案。
 *
 * 为什么单开一份：缩放条从 `ResumePreview.tsx` 拆出来之后，那几句中文跟着换了文件，
 * `cjkRatchet` 的逐文件口径会把它判成"新写的硬编码中文"。这些确实是界面文案，
 * 迁到语言包才是正确出路（顺带让它们可翻译），不必加行内豁免。
 * 2026-10-27 起工具栏（`ResumePreviewToolbar.tsx`）剩下的口径切换文案也收进这里。
 * 2026-10-28 起，精确预览面板、草稿画布与几何层（溢出量说明）的文案也收进本文件。
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
  /** 纸面比相框宽（放大 / 触到可读下限）时，缩放条给出的可见状态（Q21）。 */
  "preview.zoom.scrollHint": "纸面比相框宽：可以左右拖动查看",
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
    "这一版由导出引擎排版，与下载到的 PDF 完全一致；缩放用纸面下方的放大 / 缩小按钮（Ctrl+滚轮也可以）",

  // ── 精确预览面板（ExactPreviewPanel）──────────────────────────
  /** 请求失败／服务端报错共用的标题。 */
  "preview.exact.errorTitle": "精确预览生成失败",
  /** 报错正文：草稿侧不受影响，并给出最可能的原因（缺中文字体）。 */
  "preview.exact.errorHint":
    "草稿预览不受影响，切换回「草稿」即可继续编辑。导出 PDF 很可能是同一个原因（最常见的是本机缺少中文字体）。",
  /** 服务端排版期间的占位说明。 */
  "preview.exact.typesetting": "正在按导出引擎排版…",
  /** 内嵌 PDF 的 iframe 标题（读屏用）。 */
  "preview.exact.frameTitle": "简历精确预览（导出 PDF）",
  /** 透明预加载层的 iframe 标题（读屏隐藏，仅调试与测试可辨识）。 */
  "preview.exact.pendingFrameTitle": "正在加载的精确预览",
  /** 环境里没有内置 PDF 查看器时的标题。 */
  "preview.exact.noViewerTitle": "当前环境没有内置 PDF 查看器",
  /** 环境里没有内置 PDF 查看器时的正文：文件已排好，给出去系统阅读器打开的出路。 */
  "preview.exact.noViewerBody":
    "PDF 已经按导出引擎排好了，但这里没法直接嵌在页面里显示。点下面的按钮用系统的 PDF 阅读器打开——内容与点「导出」下载到的完全一样。",
  /** 内嵌查看器 8 秒内没加载出来时的标题（Q18 兜底：不留空白）。 */
  "preview.exact.loadTimeoutTitle": "内嵌预览加载超时",
  /** 超时兜底正文：文件已排好，给出路而不是只报错。 */
  "preview.exact.loadTimeoutBody":
    "PDF 已经排好，但查看器没有在预期时间内就绪。可以先在新标签页打开这份预览，或切到草稿再切回精确重试一次。",
  /** 用系统 PDF 阅读器打开预览的按钮。 */
  "preview.exact.openInSystemViewer": "用系统阅读器打开",
  /** 精确预览的溢出说明（整句；待清单外消费者改用它，见 config.ts 的说明）。 */
  "preview.exact.overflowNote":
    "字号、行距、页边距都按你设定的值原样渲染，不会自动缩小；超出上限的部分不会显示——先收紧排版或增加页数才能看全。",

  // ── 草稿画布（ResumePreviewCanvas）────────────────────────────
  /** 警告条标题：AI 生成的内容需要人工核对。 */
  "preview.canvas.warningsTitle": "发现以下内容需要人工核对（可能存在 AI 虚构）",
  /** 溢出正文：先声明不自动缩字号，再拼上超出量与分页口径说明。 */
  "preview.canvas.overflowBody":
    "字号、行距、页边距都按你设定的值原样渲染，不会自动缩小；{amount}{note}",
  /** 1 页上限时，超出内容被裁掉的说明。 */
  "preview.canvas.note.overflow": "超出上限的部分不会显示——先收紧排版或增加页数才能看全。",
  /** 多页视图的近似分页说明。 */
  "preview.canvas.note.approximate":
    "多页视图为「按 A4 高度切分的近似分页」，真实分页以「浏览器打印 / 下载 PDF」为准。",
  /** 单页 iframe 的标题。 */
  "preview.canvas.frameTitle": "简历预览",
  /** 多页时第 N 页 iframe 的标题。 */
  "preview.canvas.frameTitlePage": "简历预览 第 {page} 页",
  /** 纸面右下角的页码标注。 */
  "preview.canvas.pageLabel": "第 {page} 页 / 共 {total} 页（近似）",

  // ── 几何层产生的溢出量说明（geometry.ts）──────────────────────
  /** 超出一页以内：按百分比给出。 */
  "preview.geometry.overflowPercent": "正文还多出约 {percent}% 的一页高度。",
  /** 超过一页：按页数给出（一位小数）。 */
  "preview.geometry.overflowPages": "正文还多出约 {pages} 页的高度。",
  /** 还没量到内容高度时的说明。 */
  "preview.geometry.overflowUnknown": "暂时量不到精确的超出量。",
} as const;

export default preview;
