// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲搜索的**状态与滚动记忆**（D01）：查询态、命中下标、"定位前位置"的保存/恢复。
 *
 * 与 `OutlinePanel` 分开的原因：面板已经在管树渲染/行内容/属性区，再把"搜索 + 滚动 +
 * 画布显式定位"塞进去会超出行数预算，也难单独测试。这里不 import 组件，只依赖纯模块：
 * 搜索计算在 `features/resume-outline/search.ts`，滚动读写在 `scrollMemory.ts`。
 *
 * 选择语义仍归 `useOutlineCore`：本 hook 只回答"要选哪一条 / 要滚到哪里"，调用方负责
 * 真正 `select` 与展开祖先（展开状态在 core 里）。
 */
import { useCallback, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ResumeContent } from "../../../types/resume";
import type { OutlineModel } from "../../../features/resume-outline/model";
import {
  nextMatchIndex,
  searchOutline,
  type OutlineSearchMatch,
  type OutlineSearchResult,
} from "../../../features/resume-outline/search";
import {
  createScrollMemory,
  rememberElementScroll,
  rememberFrameScrolls,
  restoreElementScroll,
  restoreFrameScrolls,
  scrollTreeKeyIntoView,
  type FrameScrollSnapshot,
  type ScrollMemory,
} from "../../../features/resume-outline/scrollMemory";

// 滚动记忆的键固定为两个：进入搜索前、跳转前。
const BEFORE_SEARCH = "tree:before-search";
const BEFORE_JUMP = "tree:before-jump";

export interface OutlineSearchStateOptions {
  /** 未过滤的完整大纲模型（搜索基于它，而不是上一轮过滤结果）。 */
  model: OutlineModel;
  baseContent: ResumeContent | null;
  treeRef: RefObject<HTMLElement | null>;
  canvasContainer?: HTMLElement | null;
  canvasContainerRef?: RefObject<HTMLElement | null>;
  /** 板块标题的界面文案（标题是 i18n key；搜索必须按用户看到的文字匹配）。 */
  sectionLabel: (section: OutlineModel["sections"][number]) => string;
}

export interface OutlineSearchState {
  query: string;
  setQuery: (value: string) => void;
  result: OutlineSearchResult;
  /** 当前命中下标（-1 = 未进入命中导航）。 */
  activeIndex: number;
  step: (delta: number) => OutlineSearchMatch | null;
  /** 当前（或第一条）命中；没有命中返回 null。 */
  currentMatch: () => OutlineSearchMatch | null;
  /** Esc / 清除：清空查询并把树滚回进入搜索前的位置。 */
  clear: () => void;
  /** 搜索框首次聚焦：记下树的当前滚动位置。 */
  rememberBeforeSearch: () => void;
  /** 取消跳过又回来时：把"定位前的位置"记下来（供恢复按钮用）。 */
  rememberBeforeJump: () => void;
  /** 需要恢复（有记住的位置）。 */
  canRestore: boolean;
  /** 恢复树与画布的滚动位置。 */
  restore: () => boolean;
  /** 显式定位：记下当前位置并请求画布把目标滚进可视区。 */
  requestReveal: (path: string | null) => void;
  /** 传给 `useOutlineCanvasHighlight` 的显式定位请求。 */
  reveal: { path: string; nonce: number } | null;
  /** 把命中的树行滚进可视区（展开由调用方先做）。 */
  scrollMatchIntoView: (match: OutlineSearchMatch) => void;
  /** 挂到树容器的 onScroll：持续记录"用户最后停在树的哪里"。 */
  onTreeScroll: () => void;
}

export function useOutlineSearch({
  model,
  baseContent,
  treeRef,
  canvasContainer,
  canvasContainerRef,
  sectionLabel,
}: OutlineSearchStateOptions): OutlineSearchState {
  const [query, setQueryState] = useState("");
  const [activeIndex, setActiveIndex] = useState(-1);
  const [canRestore, setCanRestore] = useState(false);
  const [reveal, setReveal] = useState<{ path: string; nonce: number } | null>(null);
  const memoryRef = useRef<ScrollMemory>(createScrollMemory());
  const frameSnapshotRef = useRef<FrameScrollSnapshot[]>([]);
  const lastTreeScrollRef = useRef(0);
  const revealNonceRef = useRef(0);

  const result = useMemo(
    () => searchOutline(model, baseContent, query, { sectionLabel }),
    [baseContent, model, query, sectionLabel],
  );

  const treeElement = useCallback(() => treeRef.current, [treeRef]);
  const canvasHost = useCallback(
    () => canvasContainer ?? canvasContainerRef?.current ?? null,
    [canvasContainer, canvasContainerRef],
  );
  const rememberTree = useCallback(() => {
    const top = treeElement()?.scrollTop;
    if (typeof top === "number") lastTreeScrollRef.current = top;
  }, [treeElement]);

  const setQuery = useCallback((value: string) => {
    setQueryState(value);
    setActiveIndex(-1);
  }, []);

  const rememberBeforeSearch = useCallback(() => {
    if (!memoryRef.current.has(BEFORE_SEARCH)) {
      rememberElementScroll(memoryRef.current, BEFORE_SEARCH, treeElement());
    }
  }, [treeElement]);

  const step = useCallback(
    (delta: number): OutlineSearchMatch | null => {
      const total = result.matches.length;
      if (total === 0) return null;
      const next = nextMatchIndex(activeIndex, delta, total);
      setActiveIndex(next);
      return result.matches[next] ?? null;
    },
    [activeIndex, result.matches],
  );

  const currentMatch = useCallback((): OutlineSearchMatch | null => {
    if (result.matches.length === 0) return null;
    return result.matches[Math.max(0, activeIndex)] ?? result.matches[0];
  }, [activeIndex, result.matches]);

  const clear = useCallback(() => {
    setQueryState("");
    setActiveIndex(-1);
    // 恢复"进入搜索前"的位置；没有记忆时（首次搜索没滚动）什么都不做。
    if (restoreElementScroll(memoryRef.current, BEFORE_SEARCH, treeElement())) {
      memoryRef.current.forget(BEFORE_SEARCH);
    }
  }, [treeElement]);

  const rememberBeforeJump = useCallback(() => {
    rememberElementScroll(memoryRef.current, BEFORE_JUMP, treeElement());
    frameSnapshotRef.current = rememberFrameScrolls(canvasHost());
    setCanRestore(true);
  }, [canvasHost, treeElement]);

  const restore = useCallback((): boolean => {
    const treeRestored = restoreElementScroll(memoryRef.current, BEFORE_JUMP, treeElement());
    const framesRestored = restoreFrameScrolls(canvasHost(), frameSnapshotRef.current);
    memoryRef.current.forget(BEFORE_JUMP);
    frameSnapshotRef.current = [];
    setCanRestore(false);
    return treeRestored || framesRestored;
  }, [canvasHost, treeElement]);

  const requestReveal = useCallback(
    (path: string | null) => {
      rememberBeforeJump();
      if (!path) return;
      revealNonceRef.current += 1;
      setReveal({ path, nonce: revealNonceRef.current });
    },
    [rememberBeforeJump],
  );

  const scrollMatchIntoView = useCallback(
    (match: OutlineSearchMatch) => {
      // jsdom 没有 scrollIntoView；真实浏览器里这一步只滚树容器，不动页面。
      scrollTreeKeyIntoView(treeElement(), match.treeKey);
    },
    [treeElement],
  );

  // 记录用户在大纲树里的滚动位置（画布反向选中跳进大纲时用它当"之前的位置"）。
  const onTreeScroll = useCallback(() => {
    rememberTree();
  }, [rememberTree]);

  return {
    query,
    setQuery,
    result,
    activeIndex,
    step,
    currentMatch,
    clear,
    rememberBeforeSearch,
    rememberBeforeJump,
    canRestore,
    restore,
    requestReveal,
    reveal,
    scrollMatchIntoView,
    onTreeScroll,
  };
}
