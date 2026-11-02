// SPDX-License-Identifier: Apache-2.0
/**
 * 在预览的 iframe 里量出「正文实际占了多高」。
 *
 * **为什么不用 `scrollHeight`**：它把 `padding-bottom` 之外的空白、以及被撑开的容器
 * 都算进去，量出来的"内容高度"偏大；而我们要的是"正文最后一行离内容区顶边有多远"，
 * 好和"一页的可用高度"相除。所以做法是：拿 body 的固定高度减上下 padding 得到可用高度，
 * 再取最后一个**可见正文元素**的底边（含它的下外边距）减去内容顶边。
 *
 * 另外两个坑：
 * - 调用方可能给 body 加过 `transform: scale()` 把内容压进页面。`getBoundingClientRect`
 *   返回的是**变换后**的坐标，而 `getComputedStyle().paddingTop` 返回的是**未变换**的值，
 *   两者混用会算出离谱的结果。这里自己把 transform 摘掉、量完再还原。
 * - 只认"带直接文本"或媒体元素，空容器不算正文——否则一个只有下边距的空 div 会被当成
 *   占了一行，让本来就空的版面显得更满。
 */

import { t } from "../i18n";

export interface LayoutMeasure {
  /** 正文最后一行底边到内容区顶边的距离。 */
  usedHeight: number;
  /** 一页里正文可用的高度（页高减上下页边距）。 */
  pageContentHeight: number;
  pageLimit: number;
}

const MEDIA_TAGS = new Set(["IMG", "SVG", "CANVAS", "TABLE"]);

/**
 * 一页纸的物理高度（mm）。与模板里的 `body { height: {{ page_limit * 297 }}mm }` 同一个值。
 *
 * **为什么要单独量它，而不是"总高 ÷ 页数"**：总高由服务端按 `document_mode` 夹紧后的页数
 * 决定（`resume` 最多 3 页 / `long_cv` 最多 10 页）。一旦请求没带模式、或 HTML 还是上一次
 * 的，`总高 ÷ 用户选的页数` 就变成了"3 页总高 ÷ 10"，分母缩到 3/10——7 页内容会被算成
 * 「约需 21 页」（本批问题 11）。量一页的物理高度只依赖 `mm→px`，与服务端夹紧无关。
 */
const PAGE_HEIGHT_MM = 297;

/** 探针标记：测试用它把 `getComputedStyle` 里的高度单独打桩。 */
const PAGE_PROBE_ATTR = "resumePageProbe";

/**
 * 在**同一个 iframe 的 body 里**量一页纸有多高（px）。
 *
 * 必须在 iframe 内量：`padding` 与 `mm→px` 都由它自己的文档决定，父页面量出来的不能用。
 * 探针必须 `visibility: hidden; position: absolute; height: 297mm; width: 0`——
 * `display: none` 不参与布局，量不到；`visibility: hidden` 仍参与布局，高度可读。
 */
function probePageHeightPx(body: HTMLElement): number {
  const probe = body.ownerDocument.createElement("div");
  probe.setAttribute("aria-hidden", "true");
  probe.dataset[PAGE_PROBE_ATTR] = "1";
  probe.style.cssText = [
    "position: absolute",
    "top: 0",
    "left: 0",
    "width: 0",
    `height: ${PAGE_HEIGHT_MM}mm`,
    "visibility: hidden",
    "pointer-events: none",
    "margin: 0",
    "padding: 0",
    "border: 0",
  ].join("; ");
  body.appendChild(probe);
  try {
    const rectHeight = probe.getBoundingClientRect().height;
    if (rectHeight > 0) return rectHeight;
    // jsdom / 尚未参与布局时退到 computed height（Chrome 会把 mm 解析成 px）。
    const computedHeight = Number.parseFloat(window.getComputedStyle(probe).height);
    return Number.isFinite(computedHeight) && computedHeight > 0 ? computedHeight : 0;
  } finally {
    probe.remove();
  }
}

/** 只在开发态提示一次：避免每次编辑都刷一条同样的警告。 */
let pageRatioWarned = false;

function hasDirectText(element: Element): boolean {
  for (const node of Array.from(element.childNodes)) {
    if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim()) return true;
  }
  return false;
}

function isCounted(element: Element): boolean {
  const style = window.getComputedStyle(element);
  if (style.display === "none" || style.visibility === "hidden") return false;
  if (style.position === "fixed") return false;
  const rect = element.getBoundingClientRect();
  if (rect.width <= 0 || rect.height <= 0) return false;
  return hasDirectText(element) || MEDIA_TAGS.has(element.tagName);
}

/** 量一页的版面。``pageLimit`` 是用户选的页数，body 的总高度是它的整数倍。 */
export function measureResumeLayout(document: Document, pageLimit: number): LayoutMeasure | null {
  const body = document.body;
  if (!body || pageLimit < 1) return null;

  const previousTransform = body.style.transform;
  body.style.transform = "none";
  try {
    const style = window.getComputedStyle(body);
    const rect = body.getBoundingClientRect();
    const paddingTop = Number.parseFloat(style.paddingTop) || 0;
    const paddingBottom = Number.parseFloat(style.paddingBottom) || 0;

    const contentTop = rect.top + paddingTop;
    const totalContentHeight = rect.height - paddingTop - paddingBottom;
    if (!(totalContentHeight > 0)) return null;
    // ① 单页可用高度 = 一页物理高度 − 上下页边距。这是唯一正确的分母：
    //    "总高 ÷ 页数"只在服务端真的按这个页数排过时才成立（见 PAGE_HEIGHT_MM 的说明）。
    const pageHeightPx = probePageHeightPx(body);
    const singlePageContentHeight = pageHeightPx - paddingTop - paddingBottom;
    const pageContentHeight =
      singlePageContentHeight > 0 ? singlePageContentHeight : totalContentHeight / pageLimit;

    // ② 兜底可诊断（问题 11 · P1）：body 高度反推出的页数与本页页数不一致，说明 HTML 与
    //    `page_limit` 不是同一版（请求漏了 `document_mode`、或拿到的是上一版的 html）。
    //    此时上面的分母仍是实测单页高度，页数不会因此放大；这条只在开发态提示一次。
    //    文案走 `t()`（`pagination.measure.pageRatioWarn`）：本文件属于"中文棘轮"的
    //    零基线文件，任何中文字面量都会让守卫变红。
    if (pageHeightPx > 0 && !pageRatioWarned) {
      const serverPages = Math.round(rect.height / pageHeightPx);
      if (serverPages > 0 && serverPages !== pageLimit) {
        pageRatioWarned = true;
        if (import.meta.env?.DEV) {
          console.warn(t("pagination.measure.pageRatioWarn", { serverPages, limit: pageLimit }));
        }
      }
    }

    let lastBottom = contentTop;
    for (const element of Array.from(body.querySelectorAll("*"))) {
      if (!isCounted(element)) continue;
      const elementRect = element.getBoundingClientRect();
      const marginBottom = Number.parseFloat(window.getComputedStyle(element).marginBottom) || 0;
      lastBottom = Math.max(lastBottom, elementRect.bottom + marginBottom);
    }

    return {
      usedHeight: Math.max(0, lastBottom - contentTop),
      pageContentHeight,
      pageLimit,
    };
  } finally {
    body.style.transform = previousTransform;
  }
}

/**
 * 按实测高度算出"内容约需几页"。
 *
 * 这是 `backend/app/services/resume_layout.py::derive_pages` 里 `pages_needed` 的前端镜像：
 * 纯算术、同一套 `ceil(used_height / page_content_height)` 口径，只是不做网络往返——
 * 浏览器里量到的才是 HTML 预览真实要用的页数。HTML 预览路径拿不到 `X-Resume-Pages` 头
 * （那个头只在 PDF 导出时由服务端写），所以这里不能依赖它，只能靠浏览器自己量。
 */
export function pagesNeededFor(measure: LayoutMeasure): number {
  if (measure.pageContentHeight <= 0) return Math.max(1, measure.pageLimit);
  return Math.max(1, Math.ceil(measure.usedHeight / measure.pageContentHeight));
}

/**
 * 内容超出所选页数多少高度（与 `pageContentHeight` 同单位）。
 *
 * 返回 0 表示放得下；大于 0 表示"还多出这么多"。界面据此把"超出了多少"讲清楚，
 * 而不是只甩一句"放不下"。
 */
export function overflowHeightFor(measure: LayoutMeasure): number {
  return Math.max(0, measure.usedHeight - measure.pageContentHeight * measure.pageLimit);
}
