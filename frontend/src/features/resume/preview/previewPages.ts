// SPDX-License-Identifier: Apache-2.0
/**
 * 精确预览的**逐页位图**：类型、地址拼装与高度算式（P3-2）。
 *
 * 精确预览此前把导出 PDF 塞进 `<iframe>` 交给浏览器内置查看器。产物确实与导出逐字节
 * 相同，但查看器是**别人的文档**：它自己画两条无用滚动条（右侧竖向、底部横向）、在纸边
 * 画一圈深色描边，那 56px 的工具栏还让纸列恒比相框高出一截——这些外层 CSS 全都够不到。
 * 无头 Chromium 下更糟：查看器根本不出图，截图链与 CI 一直是盲区。
 *
 * 现在服务端把每一页渲染成 WebP，前端只做 `<img>`：页间距、高度、缩放全部由我们自己算，
 * 于是滚动条、描边、工具栏一次消失，headless 也能截出完整页面。
 *
 * 本模块只放**纯函数与类型**（无 DOM、无请求），所以高度算式可以脱离浏览器单测。
 */

/** 一页位图的**像素**尺寸。不假设 A4：真实比例以服务端渲染结果为准。 */
export interface PreviewPageImage {
  /** 0 起始的页序号（与导出 PDF 的页序一致）。 */
  index: number;
  /** 位图宽（px）。 */
  width: number;
  /** 位图高（px）。 */
  height: number;
}

/** 一次「这一版排出来的图」：token + 逐页尺寸 + 与 PDF 预览同一套页数结论。 */
export interface PreviewPagesMeta {
  /** 内容寻址的令牌：图片地址由它拼出来（同一份字节 + 同一宽高桶 → 同一个 token）。 */
  token: string;
  pages: PreviewPageImage[];
  /** 按当前版式**真实需要**几页（未截断）；`null` = 后端没回，界面要说"可能不是你的字号"。 */
  pagesNeeded: number | null;
  overflow: boolean;
}

/**
 * 面板手上的一份"已经拿到的这一版"：元数据 + 它按哪组参数排的。
 *
 * `key` 是面板的 `formatKey`（内容签名 + 整组版式参数 + 宽高桶）。切回同一组参数时
 * 据此判定"已经有图了"，不必再问服务端一次。
 */
export interface PreviewShot extends PreviewPagesMeta {
  key: string;
}

/** 一页位图的地址。token 内容寻址 → 可以长缓存（服务端回 `immutable`）。 */
export function previewPageImageUrl(resumeId: number, token: string, index: number): string {
  return `/api/resumes/${resumeId}/preview-pages/${token}/${index}.webp`;
}

/**
 * 「在新标签打开」的地址：与位图**同一份字节**的 PDF（服务端直接读缓存目录，不重排）。
 *
 * 图片化之后页面上没有可打开的 blob 了，这个出口必须换成服务端的 GET 地址，
 * 否则"在新标签打开"会变成打不开的死链。
 */
export function previewPdfUrl(resumeId: number, token: string): string {
  return `/api/resumes/${resumeId}/preview-pages/${token}/document.pdf`;
}

/**
 * 单页在屏幕上的高度：**按位图自己的宽高比**折算，不套 A4 常数。
 *
 * 用真实比例而不是 297/210：《导出》按模板自己的页面尺寸排，将来若支持 Letter 或自定义
 * 纸张，写死 A4 就会让相框高度与实际纸面差一截（末页下沿被裁）。
 *
 * @param page 服务端给的位图尺寸。
 * @param cssWidth 这一页在屏幕上的 CSS 宽度（相框宽 × 缩放，已取整）。
 */
export function previewPageHeight(page: PreviewPageImage, cssWidth: number): number {
  if (page.width <= 0 || cssWidth <= 0) return 0;
  return Math.round((page.height / page.width) * cssWidth);
}

/**
 * 整叠纸的高度 = 所有页高之和 + 页间距 × (页数 − 1)。
 *
 * 这就是相框该有的**全部**高度：旧实现要额外加 `VIEWER_CHROME_PX = 56`，因为查看器的
 * 工具栏吃掉了 iframe 的可视高度。工具栏随查看器一起消失之后，那 56px 也就没有来源了——
 * 留着它反而会在最后一页下面多出一条空白（正是本次要根治的现象之一）。
 */
export function previewPagesHeight(
  pages: PreviewPageImage[],
  cssWidth: number,
  gap: number,
): number {
  if (pages.length === 0 || cssWidth <= 0) return 0;
  const total = pages.reduce((sum, page) => sum + previewPageHeight(page, cssWidth), 0);
  return total + Math.max(0, pages.length - 1) * gap;
}

/**
 * 宽度桶的桶宽（px）。**必须与后端 `WIDTH_BUCKET_PX` 同值，改一处必须改另一处**。
 *
 * - 后端：`backend/app/services/resume/preview_pages.py::WIDTH_BUCKET_PX`；
 * - 前端：下面的 `previewWidthBucket`。
 *
 * 需求 #23 的 R2 就是这两处曾经不一致（后端 16 / 前端 128）：前端以为"没变"、根本没发
 * 请求，后端其实已经被另一条路径按新宽度整版重渲过一次。改这个常数时要一起看两侧注释。
 */
export const PREVIEW_WIDTH_BUCKET_PX = 64;

/**
 * 请求用的宽度桶：**64px 一档**（`0` 表示还没量到，由调用方回落到 A4 宽）。
 *
 * 返回的是**桶序号**而不是像素宽：它只进 `formatKey`，用来判"这一版是不是同一档"。
 *
 * ## 为什么前端用 `round`、后端用 `ceil`（**不要改成同一个函数**）
 *
 * 两者职责不同，边界因此不必逐值相同：
 *
 * - 后端 `ceil` 是**分辨率承诺**：按 960 桶渲出来的位图，对 900–960 里任何一个宽度都
 *   ≥ 实际所需像素，所以永远不欠采样。这条必须保守，不能有"差一点点"。
 * - 前端 `round` 只决定**要不要重发请求**，取的是"离哪个桶更近"：991 仍算 15 档、992 才
 *   跳到 16 档。于是相框宽在桶顶附近（960 → 961）抖动时**不会**触发重渲——后端那时确实
 *   已经换到 1024 桶了，但前端还拿着 960 的图，最多差 1/960 的像素密度，肉眼不可见。
 *
 * 反过来做（前端也 `ceil`）会让"960 → 961"立刻重渲一整版 1024 的位图，为一个像素付
 * 一百多毫秒；而把后端改成 `round` 则会出现**欠采样**（990 被算进 960 桶，图比需要的窄）。
 * 两种改法都更差，所以这里刻意保留差异：**同桶宽、不同取整、职责不同**。
 */
export function previewWidthBucket(width: number): number {
  if (!(width > 0)) return 0;
  return Math.round(width / PREVIEW_WIDTH_BUCKET_PX);
}
