// SPDX-License-Identifier: Apache-2.0
/**
 * 当前环境能不能**内嵌**显示 PDF。
 *
 * `navigator.pdfViewerEnabled` 是 Chromium 96+ 的标准信号：Electron 在
 * `webPreferences.plugins=false`（**默认值**）时为 `false`，某些精简版 Chromium 也是。
 * 那种环境下 `<iframe src="blob:…pdf">` 只会留一块空白——用户完全不知道发生了什么，
 * 所以宁可直接说清楚并给一条"在新标签打开"的出口。
 *
 * 读不到（老浏览器 / 非 Chromium）时按"可以"处理：宁可让查看器自己决定，也不要把
 * 本来能用的环境误判成不能用。
 *
 * 单独成模块的理由：这是**环境能力探测**，与 `ExactPreviewPanel` 的请求 / 双缓冲 /
 * 去抖逻辑没有关系；那个组件贴着单文件预算，而这段带着解释是最适合搬走的一块。
 */
export function canShowPdfInline(): boolean {
  if (typeof navigator === "undefined") return true;
  return (navigator as Navigator & { pdfViewerEnabled?: boolean }).pdfViewerEnabled !== false;
}

/** 模块级求值一次即可：`pdfViewerEnabled` 在同一次页面生命周期里不会变。 */
export const INLINE_PDF_OK = canShowPdfInline();

/**
 * 把 PDF 的 blob URL 钉成"按宽度铺满"（`#zoom=page-width`），并关掉查看器自带的两条外壳。
 *
 * 为什么 `zoom=page-width` 是**相框高度契约的一部分**：`ExactPreviewPanel` 按 A4 比例算出
 * "页数 × 单页高"的相框高度（见 `useExactPreviewFrameHeight`）。这个算式只在查看器
 * **按宽度缩放**时成立；若查看器按"整页可见"渲染（默认 `fit page`），页面会比相框窄一截、
 * 上下各留一条灰边，我们算好的高度就白算了——空白纸与最后一页之间又会重新出现那道缝。
 * 所以这里**不加** `view=FitH`：它与 `zoom=page-width` 是同一件事的两种写法，
 * 两个一起出现时哪个生效取决于查看器实现，等于把高度契约交给运气。
 *
 * `toolbar=0&navpanes=0` 是另一条（2026-11）：内嵌的 PDF 查看器会画自己的工具栏与侧栏，
 * 在 A4 相框里那就是"纸的上方多出一条灰带"，而工具条上的缩放/翻页与本人的缩放条
 * 是两套语义（一套管查看器、一套管纸）。关掉之后这块就只剩纸。
 *
 * 契约的边界：`#zoom=page-width` 是 Chromium 内置 PDF 查看器（Electron 用的就是它）与
 * Firefox 都认的参数。**换查看器 / 换浏览器（尤其 macOS 的预览内核、移动端）时要复核**：
 * 不认这个 fragment 的实现会忽略它（退回默认缩放），界面不会坏，但"空白纸紧接最后一页"
 * 的观感会退化。
 *
 * 拼接方式：fragment 不影响 blob 的解析（浏览器只按 URL 主体取资源），所以直接拼在末尾；
 * 若调用方已带了 hash（例如调用点自己加了参数），用 `&` 接上去而不是再写一个 `#`。
 */
export function withPageWidthZoom(url: string): string {
  const params = "zoom=page-width&toolbar=0&navpanes=0";
  const separator = url.includes("#") ? "&" : "#";
  return `${url}${separator}${params}`;
}

/**
 * 按**数值百分比**重新生成一个 PDF 的 URL（2026-10-29 实测结论）。
 *
 * Chrome 只认 `#zoom=<百分比>`，**不认** `#zoom=page-width`（那是 PDF.js 的写法）——
 * 认不出的参数会被忽略，页面退回查看器默认缩放。而且要**换一个新 URL**：同一个 PDF 只改
 * hash 属于同文档导航，查看器不会重新读参数。所以这里用同一份字节再造一个 objectURL。
 *
 * @param shot 面板手上那一份（字节 + 现有 URL）
 * @param pct 目标百分比；`null` = 不缩放，直接用原 URL
 */
export function zoomedPdfUrl(shot: { url: string; blob: Blob }, pct: number | null): string {
  if (pct === null) return shot.url;
  // `toolbar=0&navpanes=0` 一并带上：Chrome 的 iframe 会忽略它们（仍画自己的工具栏），
  // 但 Electron / 旧版内核认——用户那边一直是靠它们把查看器外壳藏掉的。
  return `${URL.createObjectURL(shot.blob)}#zoom=${pct}&toolbar=0&navpanes=0`;
}
