// SPDX-License-Identifier: Apache-2.0
/**
 * Reveal helpers for the structure highlight: scroll a paper element into view.
 * Split out of `./structureHighlight.ts` to keep both files under the line budget;
 * pure move, no behaviour change. Re-exported from the original module so callers
 * keep importing from there.
 */

export function framesOf(host: HTMLElement): HTMLIFrameElement[] {
  return Array.from(host.querySelectorAll<HTMLIFrameElement>("iframe"));
}

/**
 * 把纸面上某个 `data-resume-path` 滚进**它所在 iframe** 的可视区；返回是否命中。
 *
 * 只服务"iframe 自己就能纵向滚"的布局（单页超长 / 旧版式）。草稿制作台的纸面不是这种结构
 * （帧内没有滚动量，滚的是外层相框），那种情况由 `revealPathInHost` 处理。
 *
 * 三条约束（都是实测踩出来的）：
 * 1. 只动纵向。多页预览的每个 iframe 都装同一份 HTML、各自滚到自己那一列；`scrollIntoView`
 *    会连横向一起滚，于是这一页被横移到另一页的列上，纸面只剩一条竖排文字；
 * 2. 目标不在本帧可见列里（rect 完全在视口左侧/右侧）不算命中，换下一帧试；
 * 3. **已经在视口中部 1/3 内就不滚**：用户点它的时候它就在眼前，再滚一次只会把纸面挪走
 *    （这张表的中栏 chip 尤其明显——点一下整页往下跳）。
 */
export function revealPathInDocument(doc: Document | null | undefined, path: string): boolean {
  if (!doc || !path) return false;
  const node = findPathNode(doc, path.replace(/"/g, ""));
  if (!node) return false;
  const view = doc.defaultView;
  if (view && typeof view.scrollTo === "function") {
    const rect = node.getBoundingClientRect();
    // 多页预览的每个 iframe 都是同一份 HTML、只是滚到自己的那一列。若目标不在**本帧当前
    // 可见列**里（rect 在视口左侧/右侧），绝不能 scrollIntoView：那会把这一页横向滚到
    // 另一页的列上，纸面只剩一条竖排文字（结构页点条目时看到的就是这个）。
    if (rect.right <= 0 || rect.left >= view.innerWidth) return false;
    // 已在视口中部 1/3 内：命中但不动（见上面第 3 条）。
    const centerY = rect.top + rect.height / 2;
    if (centerY >= view.innerHeight / 3 && centerY <= (view.innerHeight * 2) / 3) return true;
    const targetTop = view.scrollY + centerY - view.innerHeight / 2;
    // 只动纵向，不动横向；左列/右列由 `ResumePreview` 的分页逻辑自己维护。
    view.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    return true;
  }
  if (typeof node.scrollIntoView !== "function") return false;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}

/** 按路径找纸面元素：精确命中优先，找不到时退到前缀（条目/板块）。 */
function findPathNode(doc: Document | null | undefined, safePath: string): HTMLElement | null {
  if (!doc) return null;
  return (
    doc.querySelector<HTMLElement>(`[data-resume-path="${safePath}"]`) ??
    doc.querySelector<HTMLElement>(`[data-resume-path^="${safePath}."]`)
  );
}

/** 从某个节点往上找真正能纵向滚的那一层（内容确实超出）。 */
function nearestVerticalScroller(start: Element | null): HTMLElement | null {
  let current = start?.parentElement ?? null;
  while (current) {
    const overflowY = window.getComputedStyle(current).overflowY;
    const scrollable =
      (overflowY === "auto" || overflowY === "scroll") &&
      current.scrollHeight > current.clientHeight + 1;
    if (scrollable) return current;
    current = current.parentElement;
  }
  return null;
}

/**
 * 把定位请求应用到容器内所有 iframe（返回是否至少一帧命中）。
 *
 * ## 为什么不能只滚 iframe 自己
 *
 * 草稿纸面是「每个 iframe 一张 A4、外面相框缩放」的结构（2026-11-02 实测：iframe 元素
 * 437×618，而它内部文档高 1123、clientHeight 也是 1123——**帧内根本没有纵向滚动量**）。
 * 用户能上下滚的是外层 `.resume-preview-body`（实测 scrollHeight 1872 / clientHeight 598）。
 * 所以只调 `view.scrollTo` 等于什么都没做，这正是"左栏/中栏选中时纸面不定位"的直接原因。
 *
 * 因此这里按**外层滚动容器**的坐标系定位：目标在帧内的位置 × 相框缩放比 + 帧在内容里的偏移，
 * 换成内容坐标后居中。全程只写 `scrollTop`，不碰 `scrollLeft`——多页/多列时横向位置由分页
 * 逻辑维护，横移一下就会只看到另一列的一条竖排文字。
 */
export function revealPathInHost(host: HTMLElement | null | undefined, path: string): boolean {
  if (!host || !path) return false;
  const safe = path.replace(/"/g, "");
  let revealed = false;
  for (const frame of framesOf(host)) {
    const doc = frame.contentDocument;
    const node = findPathNode(doc, safe);
    if (!node) continue;
    const view = doc?.defaultView ?? null;
    const rect = node.getBoundingClientRect();
    // 目标不在本帧当前可见列（rect 在视口左侧/右侧）：这一页不该动，交给下一页的 iframe。
    if (view && (rect.right <= 0 || rect.left >= view.innerWidth)) continue;
    revealed = true;
    // 帧内还能纵向滚的布局（单页超长 / 旧版式）：先把帧内滚到位，外层再兜一层。
    if (view && typeof view.scrollTo === "function" && doc) {
      const inner = doc.documentElement;
      if (inner && inner.scrollHeight > inner.clientHeight + 1) {
        revealPathInDocument(doc, safe);
        continue;
      }
    }
    const scroller = nearestVerticalScroller(frame);
    if (!scroller) continue;
    const frameRect = frame.getBoundingClientRect();
    const scale = frame.clientHeight > 0 ? frameRect.height / frame.clientHeight : 1;
    const scrollerRect = scroller.getBoundingClientRect();
    // 内容坐标：目标中心在纸面可视区（外层滚动容器）里的位置。
    const center =
      scroller.scrollTop +
      (frameRect.top - scrollerRect.top) +
      (rect.top + rect.height / 2) * scale;
    const scrollTop = scroller.scrollTop;
    const middleTop = scrollTop + scroller.clientHeight / 3;
    const middleBottom = scrollTop + (scroller.clientHeight * 2) / 3;
    // 已经在可视区中部 1/3 内：命中但不动（用户点的东西本来就在眼前）。
    if (center >= middleTop && center <= middleBottom) continue;
    const maxTop = Math.max(0, scroller.scrollHeight - scroller.clientHeight);
    const target = Math.max(0, Math.min(center - scroller.clientHeight / 2, maxTop));
    if (typeof scroller.scrollTo === "function") {
      scroller.scrollTo({ top: target, behavior: "smooth" });
    } else {
      scroller.scrollTop = target;
    }
  }
  return revealed;
}
