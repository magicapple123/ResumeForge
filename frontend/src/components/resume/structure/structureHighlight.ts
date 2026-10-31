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

/** 高亮声明：底色 + 描边；两个强度值改这一处即可。 */
export const STRUCTURE_HIGHLIGHT_DECLARATION =
  "background: color-mix(in srgb, currentColor 14%, transparent); " +
  "box-shadow: 0 0 0 1px color-mix(in srgb, currentColor 45%, transparent); " +
  "border-radius: 2px";

/** 高亮目标：精确路径或前缀（条目级 = 该条目下所有字段）。 */
export interface HighlightTarget {
  path: string;
  prefix: boolean;
}

/**
 * 路径字符白名单：v2 路径只由 key / id 组成（`[A-Za-z0-9_-]`），板块 key 允许 `custom:` 前缀。
 * 其它字符一律跳过而不是转义——路径来自我们自己的结构，出现非法字符说明调用方传错了，
 * 静默生成一条匹配不到的选择器只会掩盖问题。
 */
const SAFE_PATH = /^[A-Za-z0-9_:.-]+$/;

/** 生成注入 iframe 的 CSS 文本；没有目标时返回空串（调用方据此清除旧样式）。 */
export function buildStructureHighlightCss(
  targets: readonly HighlightTarget[],
  declaration: string = STRUCTURE_HIGHLIGHT_DECLARATION,
): string {
  const rules: string[] = [];
  for (const target of targets) {
    if (!SAFE_PATH.test(target.path)) continue;
    const selector = target.prefix
      ? `[data-resume-path^="${target.path}."]`
      : `[data-resume-path="${target.path}"]`;
    rules.push(`${selector} { ${declaration}; }`);
  }
  return rules.join("\n");
}

/** 一个树节点的纸面高亮目标：字段精确匹配，条目/板块用前缀，分组展开成它下面每个字段。 */
export function highlightTargetsForNode(
  node: StructureViewNode | null | undefined,
): HighlightTarget[] {
  if (!node) return [];
  const single = (prefix: boolean): HighlightTarget[] =>
    node.path ? [{ path: node.path, prefix }] : [];
  if (node.kind === "item" || node.kind === "header-entry") return single(false);
  if (node.kind === "entry") return single(true);
  if (node.kind === "section") return single(true);
  // 分组节点没有自己的纸面 DOM：把它下面的每个字段都点亮（组内字段通常在同一行/同一块）。
  const targets: HighlightTarget[] = [];
  const walk = (current: StructureViewNode) => {
    if ((current.kind === "item" || current.kind === "header-entry") && current.path) {
      targets.push({ path: current.path, prefix: false });
    }
    for (const child of current.children ?? []) walk(child);
  };
  walk(node);
  return targets;
}

/** 只有路径（编辑器 hover / 纸面点击）时的高亮目标：item 精确、条目/板块用前缀。 */
export function highlightTargetsForPath(path: string | null | undefined): HighlightTarget[] {
  if (!path) return [];
  const parts = path.split(".");
  if (parts[0] === "header") return [{ path, prefix: false }];
  if (parts.length >= 3) return [{ path, prefix: false }];
  return [{ path, prefix: true }];
}

/** 一个 iframe 文档里写/更新高亮样式；`css` 为空时删除。 */
export function applyStructureHighlightToDocument(
  doc: Document | null | undefined,
  css: string,
): void {
  if (!doc) return;
  const root = doc.head ?? doc.documentElement;
  if (!root) return;
  let style = doc.getElementById(STRUCTURE_HIGHLIGHT_STYLE_ID) as HTMLStyleElement | null;
  if (!css) {
    style?.remove();
    return;
  }
  if (!style) {
    style = doc.createElement("style");
    style.id = STRUCTURE_HIGHLIGHT_STYLE_ID;
    root.appendChild(style);
  }
  if (style.textContent !== css) style.textContent = css;
}

function framesOf(host: HTMLElement): HTMLIFrameElement[] {
  return Array.from(host.querySelectorAll<HTMLIFrameElement>("iframe"));
}

/** 给容器内所有预览 iframe 应用高亮（`css` 为空 = 清除）。可在非 React 单测里直接调用。 */
export function paintStructureHighlight(host: HTMLElement | null | undefined, css: string): void {
  if (!host) return;
  for (const frame of framesOf(host)) applyStructureHighlightToDocument(frame.contentDocument, css);
}

/** 清除容器内所有预览 iframe 的高亮样式。 */
export function clearStructureHighlight(host: HTMLElement | null | undefined): void {
  paintStructureHighlight(host, "");
}

/** 把纸面上某个 `data-resume-path` 滚进可视区（显式定位用）；返回是否命中。 */
export function revealPathInDocument(doc: Document | null | undefined, path: string): boolean {
  if (!doc || !path) return false;
  const safe = path.replace(/"/g, "");
  const node =
    doc.querySelector<HTMLElement>(`[data-resume-path="${safe}"]`) ??
    doc.querySelector<HTMLElement>(`[data-resume-path^="${safe}."]`);
  if (!node) return false;
  const view = doc.defaultView;
  if (view && typeof view.scrollTo === "function") {
    const rect = node.getBoundingClientRect();
    // 多页预览的每个 iframe 都是同一份 HTML、只是滚到自己的那一列。若目标不在**本帧当前
    // 可见列**里（rect 在视口左侧/右侧），绝不能 scrollIntoView：那会把这一页横向滚到
    // 另一页的列上，纸面只剩一条竖排文字（结构页点条目时看到的就是这个）。
    if (rect.right <= 0 || rect.left >= view.innerWidth) return false;
    const targetTop = view.scrollY + rect.top + rect.height / 2 - view.innerHeight / 2;
    // 只动纵向，不动横向；左列/右列由 `ResumePreview` 的分页逻辑自己维护。
    view.scrollTo({ top: Math.max(0, targetTop), behavior: "smooth" });
    return true;
  }
  if (typeof node.scrollIntoView !== "function") return false;
  node.scrollIntoView({ block: "center", behavior: "smooth" });
  return true;
}

/** 把定位请求应用到容器内所有 iframe（返回是否至少一帧命中）。 */
export function revealPathInHost(host: HTMLElement | null | undefined, path: string): boolean {
  if (!host) return false;
  let revealed = false;
  for (const frame of framesOf(host)) {
    if (revealPathInDocument(frame.contentDocument, path)) revealed = true;
  }
  return revealed;
}

const RETRY_LIMIT = 60;

export interface CanvasHighlightOptions {
  targets: readonly HighlightTarget[];
  /** 画布容器节点（推荐：制作台用 ref 回调 + state 持有它）。 */
  container?: HTMLElement | null;
  /** 兼容传 ref 的宿主；容器晚于首次渲染就绪时会有界重试。 */
  containerRef?: RefObject<HTMLElement | null>;
  /** 显式"定位"请求：只在用户点定位时把纸面元素滚进可视区；普通选中只换高亮。 */
  reveal?: { path: string; nonce: number } | null;
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
}: CanvasHighlightOptions): void {
  const css = useMemo(() => buildStructureHighlightCss(targets), [targets]);

  useEffect(() => {
    const resolve = (): HTMLElement | null => container ?? containerRef?.current ?? null;
    let raf = 0;
    let tries = 0;
    let teardown: (() => void) | null = null;

    const attach = (host: HTMLElement) => {
      const apply = () => paintStructureHighlight(host, css);
      apply();
      // iframe 的 load 不冒泡：捕获阶段才能在容器上统一收到。
      host.addEventListener("load", apply, true);
      const observer = typeof MutationObserver !== "undefined" ? new MutationObserver(apply) : null;
      observer?.observe(host, { childList: true, subtree: true });
      teardown = () => {
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
      // 组件卸载后纸面不该继续亮着。
      clearStructureHighlight(resolve());
    };
  }, [container, containerRef, css]);

  const revealNonce = reveal?.nonce ?? 0;
  const revealPath = reveal?.path ?? "";
  useEffect(() => {
    if (!revealNonce || !revealPath) return;
    const host = container ?? containerRef?.current ?? null;
    revealPathInHost(host, revealPath);
  }, [container, containerRef, revealNonce, revealPath]);
}
