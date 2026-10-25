// SPDX-License-Identifier: Apache-2.0
/**
 * 分区拖拽会话（从 useProfileSectionReorder 拆出，F6 行数预算）：
 * 指针状态、几何缓存、实时换位、自动滚动与松手收尾。
 *
 * ## 零 `elementFromPoint`
 * 拖动激活时一次性缓存各分区高度（与当前顺序对齐），pointermove 里用「指针行程制」
 * 直接算插入位；几何只负责 clamp 与前缀和。
 *
 * ## 拖动中实时重排 + 跟手走 ref
 * 目标 index 变化就立即 splice 进顺序；被拖分区的 `transform` 直改 DOM，不经 setState，
 * 指针移动本身不引发 React 渲染。顺序存外部 store（见 sectionOrderStore）。
 *
 * ## 拖动期折叠全部分区
 * 激活时先记被拖卡视口上缘 → flushSync 折叠全部卡片 → 补偿 scrollTop → 重设抓取偏移
 * → 按紧凑高度采集几何。松手在同一 flushSync 里恢复展开并逐帧补偿位移，最后把视角
 * 滚回被拖卡片居中。细节见 profileCompactDrag.ts / dragAutoScroll.ts。
 */
import { flushSync } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  SECTION_DRAG_THRESHOLD_PX,
  type ProfileSectionKey,
} from "../../components/profile/ProfileSectionConfig";
import {
  applyScrollShift,
  canScrollTowards,
  clampDesiredTop,
  dragTranslate,
  layoutTop,
  resolveTargetIndex,
  swapLatchOpen,
  TRAVEL_STEP_PX,
  type DragStackGeometry,
} from "../../components/profile/dragReorder";
import {
  compensateReleaseShift,
  createEdgeAutoScroller,
  disableScrollAnchoring,
  layoutTopWithoutTransform,
  resolveScrollParent,
  type EdgeAutoScroller,
} from "../../components/profile/dragAutoScroll";
import {
  centerElementInContainer,
  resolveCompactGrabOffset,
  switchToCompactLayout,
} from "./profileCompactDrag";
import { captureSectionGeometry } from "./profileSectionGeometry";
import { stepSectionOrder } from "./profileSectionMove";
import { commitLiveSwap } from "./profileSwapCommit";
import type { ProfileSectionOrderStore } from "./sectionOrderStore";

interface Options {
  store: ProfileSectionOrderStore;
  editing: boolean;
  saving: boolean;
  photoReading: boolean;
}

/** `basic_info` 固定首位：分区目标插入位的下限。 */
const SECTION_MIN_INDEX = 1;

export interface ProfileSectionDragSession {
  sectionReorderMode: boolean;
  setSectionReorderMode: (value: boolean) => void;
  resetSectionReorder: (nextOrder?: ProfileSectionKey[]) => void;
  handleSectionPointerDown: (
    event: ReactPointerEvent<HTMLButtonElement>,
    sectionKey: ProfileSectionKey,
  ) => void;
  moveSectionByOffset: (sectionKey: ProfileSectionKey, offset: -1 | 1) => void;
}

export function useProfileSectionDragSession({
  store,
  editing,
  saving,
  photoReading,
}: Options): ProfileSectionDragSession {
  // 排序模式仍保留一份 state：页头按钮（全部展开/收起）与 CSS 类要看它。
  const [sectionReorderMode, setSectionReorderModeState] = useState(false);
  /** 正在拖动的分区；null 表示无拖动。仅作为 document 监听的挂载开关使用。 */
  const [draggingSection, setDraggingSection] = useState<ProfileSectionKey | null>(null);

  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const lastPointerYRef = useRef(0);
  const dragActivatedRef = useRef(false);
  const geometryRef = useRef<DragStackGeometry | null>(null);
  const grabOffsetRef = useRef(0);
  const draggedHeightRef = useRef(0);
  const lastDesiredTopRef = useRef(0);
  const directionRef = useRef<1 | -1>(1);
  const travelAnchorRef = useRef(0);
  const draggedElRef = useRef<HTMLElement | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const autoScrollerRef = useRef<EdgeAutoScroller | null>(null);
  const restoreScrollAnchorRef = useRef<(() => void) | null>(null);

  const applyReorderMode = useCallback(
    (value: boolean) => {
      if (value) store.setReordering(true);
      else store.endDrag();
      setSectionReorderModeState(value);
    },
    [store],
  );

  /** 激活：一次 notify 同时打开 reordering / 被拖分区标记 / 全部折叠（避免多帧不一致）。 */
  const beginSectionDrag = useCallback(
    (sectionKey: ProfileSectionKey) => {
      store.beginDrag(sectionKey);
      setSectionReorderModeState(true);
    },
    [store],
  );

  const clearDragState = useCallback(() => {
    pointerStartRef.current = null;
    lastPointerYRef.current = 0;
    dragActivatedRef.current = false;
    geometryRef.current = null;
    grabOffsetRef.current = 0;
    draggedHeightRef.current = 0;
    lastDesiredTopRef.current = 0;
    directionRef.current = 1;
    travelAnchorRef.current = 0;
    const element = draggedElRef.current;
    if (element) {
      element.style.transform = "";
      element.classList.remove("is-dragging");
      draggedElRef.current = null;
    }
    setDraggingSection(null);
  }, []);

  const resetSectionReorder = useCallback(
    (nextOrder?: ProfileSectionKey[]) => {
      if (nextOrder) store.commitOrder(nextOrder);
      applyReorderMode(false);
      clearDragState();
    },
    [applyReorderMode, clearDragState, store],
  );

  const handleSectionPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, sectionKey: ProfileSectionKey) => {
      if (!editing || saving || photoReading || sectionKey === "basic_info") return;
      event.preventDefault();
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      lastPointerYRef.current = event.clientY;
      dragActivatedRef.current = false;
      draggedElRef.current = event.currentTarget.closest<HTMLElement>("[data-profile-section-key]");
      setDraggingSection(sectionKey);
    },
    [editing, photoReading, saving],
  );

  const applyLiveReorder = (sourceIndex: number, targetIndex: number) => {
    const geometry = geometryRef.current;
    if (!geometry) return;
    commitLiveSwap({
      store,
      geometry,
      draggedElement: draggedElRef.current,
      sourceIndex,
      targetIndex,
    });
  };

  const captureGeometry = (sectionKey: ProfileSectionKey): boolean => {
    const captured = captureSectionGeometry({
      sectionKey,
      order: store.getOrder(),
      pointerStartY: pointerStartRef.current?.y ?? null,
    });
    if (captured === null) return false;
    geometryRef.current = captured.geometry;
    grabOffsetRef.current = captured.grabOffset;
    draggedHeightRef.current = captured.draggedHeight;
    lastDesiredTopRef.current = captured.draggedTop;
    directionRef.current = 1;
    travelAnchorRef.current = captured.draggedTop;
    draggedElRef.current = captured.element;
    return true;
  };

  useEffect(() => {
    if (!draggingSection) return;
    const draggedKey = draggingSection;

    /** 按指针 y 同步「插入位 + transform」：自动滚动、外部滚动、pointermove 三处共用。 */
    function syncDrag(pointerY: number) {
      const geometry = geometryRef.current;
      const element = draggedElRef.current;
      if (!geometry || !element) return;
      const order = store.getOrder();
      const sourceIndex = order.indexOf(draggedKey);
      if (sourceIndex < 0) return;
      const height = draggedHeightRef.current;
      const desiredTop = clampDesiredTop(geometry, height, pointerY - grabOffsetRef.current);
      const delta = desiredTop - lastDesiredTopRef.current;
      if (delta > 0.5) directionRef.current = 1;
      else if (delta < -0.5) directionRef.current = -1;
      lastDesiredTopRef.current = desiredTop;
      const targetIndex = resolveTargetIndex(
        geometry.heights.length - 1,
        sourceIndex,
        desiredTop,
        travelAnchorRef.current,
        SECTION_MIN_INDEX,
      );
      if (targetIndex !== sourceIndex && swapLatchOpen(travelAnchorRef.current, desiredTop)) {
        travelAnchorRef.current = desiredTop;
        applyLiveReorder(sourceIndex, targetIndex);
      } else if (
        targetIndex === sourceIndex &&
        Math.abs(desiredTop - travelAnchorRef.current) >= TRAVEL_STEP_PX
      ) {
        // 钳制 pinned：锚点跟到当前位置，防止贴边滚动积累「行程债」（回拖要先还债）。
        travelAnchorRef.current = desiredTop;
      }
      const current = geometryRef.current;
      if (!current) return;
      const currentIndex = store.getOrder().indexOf(draggedKey);
      if (currentIndex < 0) return;
      element.style.transform = `translateY(${dragTranslate(
        desiredTop,
        layoutTop(current, currentIndex),
      )}px)`;
    }

    /** 结算一次滚动：几何总是平移；行程锚点只在自动滚动 tick 里平移（防 anchoring 环路）。 */
    function applyScrollDelta(delta: number, source: "auto" | "external") {
      if (delta === 0) return;
      const geometry = geometryRef.current;
      if (!geometry) return;
      const shifted = applyScrollShift(geometry, travelAnchorRef.current, delta, source);
      geometryRef.current = shifted.geometry;
      travelAnchorRef.current = shifted.lastSwapTop;
      lastScrollTopRef.current += delta;
      syncDrag(lastPointerYRef.current);
    }

    function handleContainerScroll() {
      const container = scrollContainerRef.current;
      if (!container) return;
      applyScrollDelta(container.scrollTop - lastScrollTopRef.current, "external");
    }

    function startAutoScroll() {
      const container = resolveScrollParent(draggedElRef.current);
      if (!container) return;
      scrollContainerRef.current = container;
      lastScrollTopRef.current = container.scrollTop;
      restoreScrollAnchorRef.current = disableScrollAnchoring(container);
      container.addEventListener("scroll", handleContainerScroll, { passive: true });
      autoScrollerRef.current = createEdgeAutoScroller({
        container,
        onTick: (delta) => applyScrollDelta(delta, "auto"),
        canScroll: (delta) => {
          const geometry = geometryRef.current;
          if (!geometry) return false;
          return canScrollTowards(
            geometry,
            draggedHeightRef.current,
            lastPointerYRef.current - grabOffsetRef.current,
            delta,
          );
        },
      });
    }

    const handlePointerMove = (event: globalThis.PointerEvent) => {
      event.preventDefault();
      const start = pointerStartRef.current;
      if (!start) return;
      lastPointerYRef.current = event.clientY;
      if (!dragActivatedRef.current) {
        const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
        if (distance < SECTION_DRAG_THRESHOLD_PX) return;
        switchToCompactLayout({
          element: draggedElRef.current,
          enterCompactLayout: () => flushSync(() => beginSectionDrag(draggedKey)),
          resolveContainer: resolveScrollParent,
        });
        if (!captureGeometry(draggedKey)) {
          flushSync(() => applyReorderMode(false));
          return;
        }
        const regrabbed = resolveCompactGrabOffset(
          start.y,
          lastDesiredTopRef.current,
          draggedHeightRef.current,
        );
        if (regrabbed !== null) grabOffsetRef.current = regrabbed;
        dragActivatedRef.current = true;
        startAutoScroll();
      }
      syncDrag(event.clientY);
      autoScrollerRef.current?.update(event.clientY);
    };

    const finishSectionDrag = (event: globalThis.PointerEvent) => {
      event.preventDefault();
      autoScrollerRef.current?.stop();
      autoScrollerRef.current = null;
      const element = draggedElRef.current;
      const container = scrollContainerRef.current;
      const activated = dragActivatedRef.current;
      const beforeLayoutTop = element ? layoutTopWithoutTransform(element) : null;
      const restoreAnchor = restoreScrollAnchorRef.current;
      restoreScrollAnchorRef.current = null;
      flushSync(() => {
        applyReorderMode(false);
        clearDragState();
      });
      const afterRestore = () => {
        restoreAnchor?.();
        if (activated && element?.isConnected) centerElementInContainer(element, container);
      };
      if (element && container && beforeLayoutTop !== null) {
        compensateReleaseShift(element, container, beforeLayoutTop, afterRestore);
      } else {
        afterRestore();
      }
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", finishSectionDrag);
    document.addEventListener("pointercancel", finishSectionDrag);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishSectionDrag);
      document.removeEventListener("pointercancel", finishSectionDrag);
      autoScrollerRef.current?.stop();
      autoScrollerRef.current = null;
      const container = scrollContainerRef.current;
      if (container) container.removeEventListener("scroll", handleContainerScroll);
      scrollContainerRef.current = null;
      restoreScrollAnchorRef.current?.();
      restoreScrollAnchorRef.current = null;
      store.setCompact(false);
    };
    // applyLiveReorder / captureGeometry 只经 ref 与稳定 store 起作用，不进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingSection, beginSectionDrag, applyReorderMode, clearDragState, store]);

  const moveSectionByOffset = useCallback(
    (sectionKey: ProfileSectionKey, offset: -1 | 1) => stepSectionOrder(store, sectionKey, offset),
    [store],
  );

  return {
    sectionReorderMode,
    setSectionReorderMode: applyReorderMode,
    resetSectionReorder,
    handleSectionPointerDown,
    moveSectionByOffset,
  };
}
