// SPDX-License-Identifier: Apache-2.0
/**
 * 「结构面板 / 编辑器 hover → 右栏纸面高亮」的纯计算与注入。
 *
 * 纸面是后端模板渲染的 HTML（v2 planner 给每处文本打 `data-resume-path`），所以高亮不需要
 * 重渲染：只要按路径选择器往 iframe 的 `<head>` 注入一条样式。与旧大纲高亮（
 * `features/resume-outline/highlight.ts`）的区别只有路径规则——v2 路径的板块 key 可能是
 * `custom:<uuid>`、对象 id 含 `-`，旧的 `SAFE_PATH` 会把这些路径判成非法而静默不亮。
 *
 * 颜色全部从 `currentColor` 派生：iframe 里没有应用的 `--rf-*` token，写进去只会得到透明背景。
 */
import { useEffect, useMemo } from "react";
import type { RefObject } from "react";
import type { StructureViewNode } from "./structureView";

/** 注入到每个 iframe 的 `<style>` 的 id（与旧大纲高亮分开，两套可以同时存在）。 */
export const STRUCTURE_HIGHLIGHT_STYLE_ID = "rf-structure-highlight";

/**
 * R-14：选中与悬停分两档视觉。悬停是"你指的那一行"，选中是"你落下的那一行"——
 * 同一强度会让用户在纸面上分不清"刚点的"和"鼠标扫过的"。
 *
 * 两档必须用**不同的 style id**：同一 id 谁后写谁覆盖，悬停扫过就会把选中态擦成 1px。
 */
export const STRUCTURE_HIGHLIGHT_SELECTED_STYLE_ID = "rf-structure-highlight-selected";

/** 高亮声明：底色 + 描边；悬停档（14% / 1px）。 */
export const STRUCTURE_HIGHLIGHT_DECLARATION =
  "background: color-mix(in srgb, currentColor 14%, transparent); " +
  "box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 45%, transparent); " +
  "border-radius: 2px";

/** 选中档（20% / 2px）：明显重于悬停，但不至于盖住正文。 */
export const STRUCTURE_HIGHLIGHT_SELECTED_DECLARATION =
  "background: color-mix(in srgb, currentColor 20%, transparent); " +
  "box-shadow: 0 0 0 2px color-mix(in srgb, currentColor 60%, transparent); " +
  "border-radius: 2px";

/**
 * 容器档（条目 / 板块）：**整块只画一个外框**，不再逐个字段涂色（问题 7）。
 *
 * 两个约束来自实测：
 * 1. 必须足够淡（≤5% 底、1px 边）——容器套着字段，选中板块 + 悬停其中一个条目时两层会叠色；
 * 2. 圆角 4px 与纸面里的块状元素同档，2px 会在细边框上显得发毛。
 */
export const STRUCTURE_HIGHLIGHT_CONTAINER_DECLARATION =
  "background: color-mix(in srgb, currentColor 4%, transparent); " +
  "box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 40%, transparent); " +
  "border-radius: 4px";

/** 悬停容器档：比选中再低一档（R-14「悬停 ≠ 选中」在容器级同样成立）。 */
export const STRUCTURE_HIGHLIGHT_CONTAINER_HOVER_DECLARATION =
  "background: color-mix(in srgb, currentColor 2.5%, transparent); " +
  "box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 24%, transparent); " +
  "border-radius: 4px";

/**
 * 高亮目标：**选中对象的粒度**决定画在哪个容器上（问题 7 方案 A）。
 *
 * - `item`：字段 / 页眉字段，照旧画在 `[data-resume-path]` 叶子上（20% + 2px 本来就是为它设计的）；
 * - `entry`：条目，画在 `.entry[data-object-id]` 这个整条外框上；
 * - `section`：板块，画在 `.section[data-section]` 整块外框上。
 *
 * 以前只有一种表达方式（叶子 + 前缀匹配），于是"选一整块"被画成"几十个字段各自高亮"，
 * 整段像贴满灰色小方块。
 */
export type HighlightKind = "item" | "entry" | "section";

export interface HighlightTarget {
  path: string;
  kind: HighlightKind;
}

/** 一套高亮的两档声明：叶子（字段）与容器（条目/板块）。 */
export interface HighlightPaint {
  item: string;
  container: string;
}

/** 悬停档。 */
export const STRUCTURE_HIGHLIGHT_PAINT_HOVER: HighlightPaint = {
  item: STRUCTURE_HIGHLIGHT_DECLARATION,
  container: STRUCTURE_HIGHLIGHT_CONTAINER_HOVER_DECLARATION,
};

/** 选中档。 */
export const STRUCTURE_HIGHLIGHT_PAINT_SELECTED: HighlightPaint = {
  item: STRUCTURE_HIGHLIGHT_SELECTED_DECLARATION,
  container: STRUCTURE_HIGHLIGHT_CONTAINER_DECLARATION,
};

/**
 * 路径字符白名单：v2 路径只由 key / id 组成（`[A-Za-z0-9_-]`），板块 key 允许 `custom:` 前缀。
 * 其它字符一律跳过而不是转义——路径来自我们自己的结构，出现非法字符说明调用方传错了，
 * 静默生成一条匹配不到的选择器只会掩盖问题。
 */
const SAFE_PATH = /^[A-Za-z0-9_:.-]+$/;

/**
 * 目标 → 纸面选择器。
 *
 * - 叶子：`[data-resume-path="…"]`（纸面每个字段都有）；
 * - 条目：`.entry[data-object-id="…"]`——对象 id 是路径第二段，纸面里条目元素只带对象 id，
 *   不带板块 key（同一 id 在全文档唯一，所以不需要前缀匹配）；
 * - 板块：`.section[data-section="…"]`——板块 key 是路径第一段。
 *
 * 纸面模板契约见 `backend/app/templates/_resume_document.j2`（9 套模板共用这一份）。
 */
export function highlightSelector(target: HighlightTarget): string | null {
  if (!SAFE_PATH.test(target.path)) return null;
  if (target.kind === "item") return `[data-resume-path="${target.path}"]`;
  const parts = target.path.split(".");
  if (target.kind === "entry") {
    const objectId = parts[1];
    return objectId ? `.entry[data-object-id="${objectId}"]` : null;
  }
  const sectionKey = parts[0];
  return sectionKey ? `.section[data-section="${sectionKey}"]` : null;
}

/** 生成注入 iframe 的 CSS 文本；没有目标时返回空串（调用方据此清除旧样式）。 */
export function buildStructureHighlightCss(
  targets: readonly HighlightTarget[],
  paint: HighlightPaint = STRUCTURE_HIGHLIGHT_PAINT_HOVER,
): string {
  const rules: string[] = [];
  for (const target of targets) {
    const selector = highlightSelector(target);
    if (!selector) continue;
    const declaration = target.kind === "item" ? paint.item : paint.container;
    rules.push(`${selector} { ${declaration}; }`);
  }
  return rules.join("\n");
}

/** 一个树节点的纸面高亮目标：按节点粒度选容器，分组展开成它下面每个字段。 */
export function highlightTargetsForNode(
  node: StructureViewNode | null | undefined,
): HighlightTarget[] {
  if (!node) return [];
  const single = (kind: HighlightKind): HighlightTarget[] =>
    node.path ? [{ path: node.path, kind }] : [];
  if (node.kind === "item" || node.kind === "header-entry") return single("item");
  if (node.kind === "entry") return single("entry");
  if (node.kind === "section") return single("section");
  // 分组节点没有自己的纸面 DOM：把它下面的每个字段都点亮（组内字段通常在同一行/同一块）。
  const targets: HighlightTarget[] = [];
  const walk = (current: StructureViewNode) => {
    if ((current.kind === "item" || current.kind === "header-entry") && current.path) {
      targets.push({ path: current.path, kind: "item" });
    }
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return targets;
}

/**
 * 只有路径（编辑器 hover / 纸面点击）时的高亮目标：按路径段数判粒度。
 *
 * `header.*` 是页眉字段（纸面没有容器，保持叶子）；1 段 = 板块，2 段 = 条目，≥3 段 = 字段。
 */
export function highlightTargetsForPath(path: string | null | undefined): HighlightTarget[] {
  if (!path) return [];
  const parts = path.split(".");
  if (parts[0] === "header") return [{ path, kind: "item" }];
  if (parts.length >= 3) return [{ path, kind: "item" }];
  if (parts.length === 2) return [{ path, kind: "entry" }];
  return [{ path, kind: "section" }];
}

/** 一个 iframe 文档里写/更新高亮样式；`css` 为空时删除。 */
export function applyStructureHighlightToDocument(
  doc: Document | null | undefined,
  css: string,
  styleId: string = STRUCTURE_HIGHLIGHT_STYLE_ID,
): void {
  if (!doc) return;
  const root = doc.head ?? doc.documentElement;
  if (!root) return;
  let style = doc.getElementById(styleId) as HTMLStyleElement | null;
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = doc.createElement("style");
    style.id = styleId;
    root.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

function framesOf(host: HTMLElement): HTMLIFrameElement[] {
  return Array.from(host.querySelectorAll<HTMLIFrameElement>("iframe"));
}

/**
 * iframe 是否与容器视口相交（R-30）。
 *
 * 纸面是多页 iframe 并排/堆叠，一次高亮要往 **每个** iframe 的 head 写 `<style>`；
 * 190 个字段选中时那是十几帧同时重排。只画当前看得到的页，滚动时再补一次。
 * 判定用容器自身矩形 + 1px 容差：完全在容器外（上一屏/下一屏）才算不可见。
 */
function frameIsVisible(host: HTMLElement, frame: HTMLIFrameElement): boolean {
  const box = frame.getBoundingClientRect();
  if (box.width < 1 || box.height < 1) return false;
  const hostBox = host.getBoundingClientRect();
  return box.bottom > hostBox.top - 1 && box.top < hostBox.bottom + 1;
}

/**
 * 给容器内的预览 iframe 应用高亮（`css` 为空 = 清除）。可在非 React 单测里直接调用。
 *
 * @param visibleOnly 只画当前可见页（勾选/悬停这种高频路径用）；清除时不要传——
 *   否则滚出视口的那几页会留着上一版高亮。
 */
export function paintStructureHighlight(
  host: HTMLElement | null | undefined,
  css: string,
  styleId: string = STRUCTURE_HIGHLIGHT_STYLE_ID,
  visibleOnly = false,
): void {
  if (!host) return;
  for (const frame of framesOf(host)) {
    if (visibleOnly && !frameIsVisible(host, frame)) continue;
    applyStructureHighlightToDocument(frame.contentDocument, css, styleId);
  }
}

/** 清除容器内所有预览 iframe 的高亮样式。 */
export function clearStructureHighlight(
  host: HTMLElement | null | undefined,
  styleId: string = STRUCTURE_HIGHLIGHT_STYLE_ID,
): void {
  paintStructureHighlight(host, "", styleId);
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

const RETRY_LIMIT = 60;

/**
 * 定位（reveal）的重试与重放节奏。
 *
 * 点树/ chip 的那一刻，iframe 里可能还是**上一版 HTML**（实时预览正在重排），`querySelector`
 * 找不到目标就返回 false；600ms 后 iframe 重载好了，可如果只按 nonce 跑一次，这次定位就永久
 * 丢了。所以失败要有界重试，成功之后短时间内 iframe 若再重载（"选完立刻改一个字触发重排"）
 * 还要重放一次——重排完成后纸面仍停在选中项。
 */
const REVEAL_RETRY_ATTEMPTS = 3;
export const REVEAL_RETRY_MS = 200;
/** 定位成功后的重放窗口：这段时间里 iframe 重载会再定位一次，之后不再打扰用户。 */
export const REVEAL_REPLAY_WINDOW_MS = 5000;

export interface CanvasHighlightOptions {
  targets: readonly HighlightTarget[];
  /** 画布容器节点（推荐：制作台用 ref 回调 + state 持有它）。 */
  container?: HTMLElement | null;
  /** 兼容传 ref 的宿主；容器晚于首次渲染就绪时会有界重试。 */
  containerRef?: RefObject<HTMLElement | null>;
  /** 显式"定位"请求：只在用户点定位时把纸面元素滚进可视区；普通选中只换高亮。 */
  reveal?: { path: string; nonce: number } | null;
  /** 样式 `<style>` 的 id：选中与悬停必须分开，否则后写的一方会覆盖另一方（R-14）。 */
  styleId?: string;
  /** 高亮的**两档**声明（叶子 / 容器）；缺省 = 悬停档。 */
  paint?: HighlightPaint;
}

/**
 * 把当前高亮目标画到右栏纸面：iframe 会随实时预览重载，所以在容器上挂捕获阶段的
 * `load` 监听 + `MutationObserver` 兜住新插入的 iframe；容器晚到一帧时有界重试。
 */
export function useCanvasPathHighlight({
  targets,
  container,
  containerRef,
  reveal,
  styleId = STRUCTURE_HIGHLIGHT_STYLE_ID,
  paint = STRUCTURE_HIGHLIGHT_PAINT_HOVER,
}: CanvasHighlightOptions): void {
  const css = useMemo(() => buildStructureHighlightCss(targets, paint), [paint, targets]);

  useEffect(() => {
    const resolve = (): HTMLElement | null => container ?? containerRef?.current ?? null;
    let raf = 0;
    let tries = 0;
    let teardown: (() => void) | null = null;

    const attach = (host: HTMLElement) => {
      // R-30：高频路径（选中/悬停/iframe 重载）只画可见页；滚动时按帧补齐。
      const apply = () => paintStructureHighlight(host, css, styleId, true);
      apply();
      let scrollRaf = 0;
      const onScroll = () => {
        if (scrollRaf) return;
        scrollRaf = requestAnimationFrame(() => {
          scrollRaf = 0;
          apply();
        });
      };
      // 滚动发生在弹窗正文（.ant-modal-body）上，不在 host 自己身上：用 document 捕获阶段收。
      document.addEventListener("scroll", onScroll, true);
      // iframe 的 load 不冒泡：捕获阶段才能在容器上统一收到。
      host.addEventListener("load", apply, true);
      const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(apply) : null;
      observer?.observe(host, { childList: true, subtree: true });
      teardown = () => {
        if (scrollRaf) cancelAnimationFrame(scrollRaf);
        document.removeEventListener("scroll", onScroll, true);
        host.removeEventListener("load", apply, true);
        observer?.disconnect();
      };
    };

    const start = () => {
      const host = resolve();
      if (host) {
        attach(host);
        return;
      }
      if (tries < RETRY_LIMIT && typeof requestAnimationFrame === "function") {
        tries += 1;
        raf = requestAnimationFrame(start);
      }
    };
    start();

    return () => {
      if (raf) cancelAnimationFrame(raf);
      teardown?.();
      // 组件卸载后纸面不该继续亮着（只清自己这一档，另一档由它自己的 hook 负责）。
      clearStructureHighlight(resolve(), styleId);
    };
  }, [container, containerRef, css, styleId]);

  const revealNonce = reveal?.nonce ?? 0;
  const revealPath = reveal?.path ?? "";
  useEffect(() => {
    if (!revealNonce || !revealPath) return;
    const host = container ?? containerRef?.current ?? null;
    if (!host) return;
    let cancelled = false;
    let timer = 0;
    /** 最近一次定位成功的时刻；0 = 还没成功过。 */
    let landedAt = 0;

    const attempt = (retriesLeft: number) => {
      if (cancelled) return;
      if (revealPathInHost(host, revealPath)) {
        landedAt = Date.now();
        return;
      }
      if (retriesLeft <= 0) return;
      timer = window.setTimeout(() => attempt(retriesLeft - 1), REVEAL_RETRY_MS);
    };

    // iframe 重载后重放：命中过才限时重放，没命中就继续按重试节奏走。
    const onLoad = () => {
      if (cancelled) return;
      if (landedAt && Date.now() - landedAt > REVEAL_REPLAY_WINDOW_MS) return;
      attempt(REVEAL_RETRY_ATTEMPTS);
    };

    attempt(REVEAL_RETRY_ATTEMPTS);
    // iframe 的 load 不冒泡：捕获阶段才能在容器上统一收到（与高亮那条链路同一手法）。
    host.addEventListener("load", onLoad, true);
    return () => {
      cancelled = true;
      if (timer) window.clearTimeout(timer);
      host.removeEventListener("load", onLoad, true);
    };
  }, [container, containerRef, revealNonce, revealPath]);
}
