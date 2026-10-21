// SPDX-License-Identifier: Apache-2.0
//
// 草稿（浏览器）侧的「正文占了多高」测量：`frontend/src/utils/resumeLayoutMeasure.ts`
// 里 `measureResumeLayout()` 的**逐行镜像**。
//
// 为什么要镜像而不是"用差不多的算法再量一遍"：
// `backend/tests/test_cross_engine_height.py` 要回答的是"同一个文档，浏览器排队的高度
// 与服务端 PDF 引擎排队的高度是否一致"。如果两侧的测量口径本身不同（比如一边算容器
// 的 padding、一边不算），那量出来的差就分不清是**排版真的不同**还是**尺子不同**。
// 所以这里不引入任何"改进"，只做翻译：TS 改一行，这里必须跟着改一行；反过来也一样。
//
// 口径要点（与 TS 一一对应，改动前先读 TS 的注释）：
//   1. 先把 body 的 transform 摘掉再量——`getBoundingClientRect()` 返回变换后的坐标，
//      而 `getComputedStyle().paddingTop` 返回未变换的值，混用会算出离谱的高度；
//   2. 内容区顶边 = body 顶边 + padding-top；一页可用高度 = (body 高 - 上下 padding) / 页数；
//   3. 只计「有直接文本节点」或 IMG/SVG/CANVAS/TABLE 且可见（display/visibility/position）
//      且宽高 > 0 的元素——空容器不算正文（否则只有下边距的空 div 会凭空占一行）；
//   4. 内容底边取所有被计元素 `bottom + margin-bottom` 的最大值。
//
// 调用方式：`page.evaluate(f"({source})({page_limit})")`，返回 `{usedHeight, pageContentHeight}`
// 或 `null`（body 不可用 / 内容区高度非正）。

(pageLimit) => {
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
    const pageContentHeight = totalContentHeight / pageLimit;

    const mediaTags = new Set(["IMG", "SVG", "CANVAS", "TABLE"]);

    const hasDirectText = (element) => {
      for (const node of Array.from(element.childNodes)) {
        if (node.nodeType === Node.TEXT_NODE && (node.textContent ?? "").trim()) return true;
      }
      return false;
    };

    const isCounted = (element) => {
      const elementStyle = window.getComputedStyle(element);
      if (elementStyle.display === "none" || elementStyle.visibility === "hidden") return false;
      if (elementStyle.position === "fixed") return false;
      const elementRect = element.getBoundingClientRect();
      if (elementRect.width <= 0 || elementRect.height <= 0) return false;
      return hasDirectText(element) || mediaTags.has(element.tagName);
    };

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
    };
  } finally {
    body.style.transform = previousTransform;
  }
}
