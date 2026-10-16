/** 资料分区排序状态与指针拖拽行为（T05 重写；order 外部 store 化）。
 *
 * 与旧实现的三点差别：
 * 1. **零 `elementFromPoint`**：拖动激活时一次性缓存各分区高度（与当前顺序对齐），
 *    pointermove 里用「指针 y + 高度前缀和」直接算插入位，不碰 DOM 命中测试。
 * 2. **拖动中实时重排**：目标 index 变化就立即 splice 进顺序（含高度数组同步），
 *    不等 pointerup；松手只做清理，顺序已经是最终态。
 * 3. **跟手视觉走 ref**：被拖分区用 `style.transform = translateY(...)` 直改，
 *    不经 setState——指针移动本身不再引发任何 React 渲染。
 *
 * ## 为什么顺序不走页面级 React state（用户实测拖拽仍卡顿的根因）
 *
 * 旧实现里 `sectionOrder` 是页面级 state：每次实时 splice 都让 ProfilePage 重渲 →
 * `resumeContent` / `workspaceTabs` 两个 useMemo 的 `sectionOrder` 依赖失效 → antd
 * `Form` 元素被重建 → Form 重渲换新 context → 包住的 67 个 Form.Item（含 12 个年月日
 * 三连选、每个约 140 项年份选项）**全量**跟着重渲。ProfilePage.tsx 顶部注释里实测过
 * 单次就是 170ms（开发构建）——拖一次跨越三个分区就是连续三次百毫秒级卡顿，这与
 * memo 链路无关（memo 挡不住 context 变更），是用户「仍然觉得卡」的直接来源。
 *
 * 现在顺序住在下面的外部 store 里（模块级工厂 + useState 持有单例，不用 ref：
 * React Compiler 禁止渲染期读 ref）：拖拽中的每次 splice 只重渲订阅它的
 * `ProfileSectionStack`（分区壳 memo 化，只有 order 变化的壳重渲），Form 子树整块跳过。
 * 页面级消费者（提交时读顺序）经 `getSectionOrder()` 在事件时刻取最新值，不经渲染。
 */

import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
import {
  DEFAULT_SECTION_ORDER,
  SECTION_DRAG_THRESHOLD_PX,
  type ProfileSectionKey,
} from "../../components/profile/ProfileSectionConfig";

interface Options {
  editing: boolean;
  saving: boolean;
  photoReading: boolean;
}

/** 拖动激活时一次性缓存的几何信息（视口坐标）。 */
interface DragGeometry {
  /** 分区栈顶部（首个分区上缘）。 */
  stackTop: number;
  /** 分区栈底部（最后一个分区下缘）。 */
  stackBottom: number;
  /** 相邻分区间距（CSS gap），jsdom/无布局时自然为 0。 */
  gap: number;
  /** 被拖分区平移的上下限（相对其初始位置）。 */
  minTranslate: number;
  maxTranslate: number;
}

/** store 快照：顺序 + 是否处于排序模式（排序模式也要绕开 Form 链，理由同上）。 */
export interface ProfileSectionOrderSnapshot {
  sectionOrder: ProfileSectionKey[];
  reordering: boolean;
}

/** `useSyncExternalStore` 协议：快照引用只在 commit 时更换，两次 commit 间恒定。 */
export interface ProfileSectionOrderStore {
  subscribe: (listener: () => void) => () => void;
  getSnapshot: () => ProfileSectionOrderSnapshot;
  /** 事件时刻读最新顺序（提交/解析等不经渲染的消费口）。 */
  getOrder: () => ProfileSectionKey[];
  isReordering: () => boolean;
  /** 整体换序（拖拽实时 splice 与加载资料写入共用此出口）。 */
  commitOrder: (next: ProfileSectionKey[]) => void;
  setReordering: (value: boolean) => void;
}

/**
 * 顺序 store 的模块级工厂：普通闭包变量 + 监听器集合，不走 React ref/state。
 * `getSnapshot` 返回缓存快照（只在 commit 时换新对象），满足 useSyncExternalStore
 * 的引用稳定性要求；编译器视角这是纯外部可变量，正是该协议的标准形态。
 */
function createSectionOrderStore(): ProfileSectionOrderStore {
  let order: ProfileSectionKey[] = DEFAULT_SECTION_ORDER;
  let reordering = false;
  let snapshot: ProfileSectionOrderSnapshot = { sectionOrder: order, reordering };
  const listeners = new Set<() => void>();
  const notify = () => {
    snapshot = { sectionOrder: order, reordering };
    listeners.forEach((listener) => listener());
  };
  return {
    subscribe(listener) {
      listeners.add(listener);
      return () => {
        listeners.delete(listener);
      };
    },
    getSnapshot: () => snapshot,
    getOrder: () => order,
    isReordering: () => reordering,
    /** 顺序写入的唯一出口：先同步换变量（事件回调立刻可读），再广播订阅者。 */
    commitOrder(next) {
      if (next === order) return;
      order = next;
      notify();
    },
    setReordering(value) {
      if (value === reordering) return;
      reordering = value;
      notify();
    },
  };
}

/**
 * 实时重排（splice）后被拖项布局位置的位移：新布局 top − 旧布局 top（栈顶相对坐标）。
 *
 * CSS `order` 变化的瞬间，flex 会把被拖项的盒子**重新摆位**——它从第 3 位换到第 5 位，
 * 盒子位置瞬间下移若干像素；而 `translateY` 是相对自身盒子的偏移，不补偿这个跳变的
 * 话，视觉位置 = 新布局位置 + 旧偏移 ≠ 鼠标位置，卡片会「甩出」鼠标。
 *
 * 布局 top 的算法与渲染一致：flex column 里第 index 个盒子前有 index 个
 * 「高度 + gap」的前缀。``heights``/``gap`` 必须与 splice **前**的顺序对齐（被拖项
 * 自身高度不变，其余项相对位置也不变，所以前缀和用旧序即可算出新旧两个位置）。
 * 返回值应累加进拖拽中的 transform 补偿：`translateY = 指针位移 − 累计布局位移`。
 *
 * 抽成纯函数是为了可单测——jsdom 验证不了视觉连续性，但这段几何是纯算术。
 */
export function draggedLayoutShift(
  heights: number[],
  gap: number,
  sourceIndex: number,
  targetIndex: number,
): number {
  const lastIndex = heights.length - 1;
  if (sourceIndex < 0 || sourceIndex > lastIndex || targetIndex < 0 || targetIndex > lastIndex) {
    return 0;
  }
  const topAt = (index: number): number => {
    let top = 0;
    for (let i = 0; i < index; i += 1) top += heights[i] + gap;
    return top;
  };
  const topBefore = topAt(sourceIndex);
  // splice 后的前缀要按新数组算：向下移动时，新位置前缀不再包含被拖项自身
  // （它已从 source 抽走），等价于 T(target+1) −（自身高度 + gap）；向上移动时
  // 新位置前缀全部来自被拖项之前的项，旧序前缀即新序前缀。
  const topAfter =
    targetIndex > sourceIndex
      ? topAt(targetIndex + 1) - (heights[sourceIndex] + gap)
      : topAt(targetIndex);
  return topAfter - topBefore;
}

export function useProfileSectionReorder({ editing, saving, photoReading }: Options) {
  // 排序模式仍保留一份 state：页头的「调整顺序」按钮要跟着高亮（页面级消费者）。
  // 它只在拖拽激活/退出时翻转一次，不会进入 pointermove 高频路径。
  const [sectionReorderMode, setSectionReorderModeState] = useState(false);
  /** 正在拖动的分区；null 表示无拖动。仅作为 document 监听的挂载开关使用。 */
  const [draggingSection, setDraggingSection] = useState<ProfileSectionKey | null>(null);
  // store 单例：useState 惰性初始化，组件生命周期内引用恒定（跨重渲保持监听器）。
  const [store] = useState(createSectionOrderStore);

  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragActivatedRef = useRef(false);
  /** 与当前顺序逐位对齐的分区高度缓存（拖动激活时采集）。 */
  const heightsRef = useRef<number[]>([]);
  const geometryRef = useRef<DragGeometry | null>(null);
  /**
   * 拖拽开始以来累计的布局位移（order 变化把被拖项盒子挪动了多少像素）。
   * transform 必须减掉它才能保持视觉连续，见 `draggedLayoutShift` 的说明。
   */
  const layoutShiftRef = useRef(0);
  const draggedElRef = useRef<HTMLElement | null>(null);

  /** 排序模式写入的唯一出口：store 给分区栈，state 给页头按钮。 */
  const applyReorderMode = useCallback(
    (value: boolean) => {
      store.setReordering(value);
      setSectionReorderModeState(value);
    },
    [store],
  );

  const clearDragState = useCallback(() => {
    pointerStartRef.current = null;
    dragActivatedRef.current = false;
    heightsRef.current = [];
    geometryRef.current = null;
    layoutShiftRef.current = 0;
    const element = draggedElRef.current;
    if (element) {
      element.style.transform = "";
      // 拖拽结束摘掉合成层提示与置顶（见 profile.css 的 .is-dragging 说明）。
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

  // 以下回调全部 useCallback 稳定化：ProfilePage 的 useMemo 子树与 memo 化的
  // SortableProfileSection 依赖引用稳定，回调换新会把 memo 打穿。
  const handleSectionPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLButtonElement>, sectionKey: ProfileSectionKey) => {
      if (!editing || saving || photoReading || sectionKey === "basic_info") return;
      event.preventDefault();
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      dragActivatedRef.current = false;
      applyReorderMode(true);
      setDraggingSection(sectionKey);
    },
    [applyReorderMode, editing, saving, photoReading],
  );

  /**
   * 把拖动项从 sourceIndex 实时挪到 targetIndex；顺序与高度数组同步 splice。
   * splice 前先算被拖项的布局位移并累进补偿（heights 还是旧序，正是纯函数需要的输入）。
   */
  const applyLiveReorder = (sourceIndex: number, targetIndex: number) => {
    const next = [...store.getOrder()];
    const nextHeights = [...heightsRef.current];
    if (
      sourceIndex < 0 ||
      sourceIndex >= next.length ||
      targetIndex < 0 ||
      targetIndex >= next.length
    ) {
      return;
    }
    layoutShiftRef.current += draggedLayoutShift(
      nextHeights,
      geometryRef.current?.gap ?? 0,
      sourceIndex,
      targetIndex,
    );
    const moved = next.splice(sourceIndex, 1)[0];
    next.splice(targetIndex, 0, moved);
    const movedHeight = nextHeights.splice(sourceIndex, 1)[0];
    nextHeights.splice(targetIndex, 0, movedHeight);
    heightsRef.current = nextHeights;
    store.commitOrder(next);
  };

  /** 拖动激活时采集各分区高度（读一次 DOM，此后移动全程零 DOM 查询）。 */
  const captureGeometry = (sectionKey: ProfileSectionKey): boolean => {
    const elements = Array.from(
      document.querySelectorAll<HTMLElement>("[data-profile-section-key]"),
    );
    if (elements.length === 0) return false;
    const rects = elements.map((element) => element.getBoundingClientRect());
    const heightByKey = new Map<string, number>();
    elements.forEach((element, index) => {
      heightByKey.set(element.dataset.profileSectionKey ?? "", rects[index].height);
    });
    // 高度数组与当前顺序逐位对齐（高度按 key 取，与 DOM 遍历顺序无关）。
    heightsRef.current = store.getOrder().map((key) => heightByKey.get(key) ?? 0);

    // 分区栈按 CSS `order` 摆放后，DOM 顺序不再等于视觉顺序：栈几何必须按
    // 屏幕位置算——先把矩形排成视觉序，再取相邻间隔做 gap。
    const visualRects = [...rects].sort((a, b) => a.top - b.top || a.left - b.left);
    const gap =
      visualRects.length >= 2
        ? Math.max(0, visualRects[1].top - (visualRects[0].top + visualRects[0].height))
        : 0;
    const stackTop = visualRects[0].top;
    const stackBottom = Math.max(...rects.map((rect) => rect.top + rect.height));
    const draggedElement = document.querySelector<HTMLElement>(
      `[data-profile-section-key="${sectionKey}"]`,
    );
    if (!draggedElement) return false;
    // 抬起视觉：置顶 + 合成层提示（拖拽期间每帧直改 transform，见 profile.css）。
    draggedElement.classList.add("is-dragging");
    layoutShiftRef.current = 0;
    const draggedRect = draggedElement.getBoundingClientRect();
    geometryRef.current = {
      stackTop,
      stackBottom,
      gap,
      minTranslate: stackTop - draggedRect.top,
      maxTranslate: stackBottom - draggedRect.height - draggedRect.top,
    };
    draggedElRef.current = draggedElement;
    return true;
  };

  useEffect(() => {
    if (!draggingSection) return;
    const handlePointerMove = (event: globalThis.PointerEvent) => {
      event.preventDefault();
      const start = pointerStartRef.current;
      if (!start) return;
      const distance = Math.hypot(event.clientX - start.x, event.clientY - start.y);
      if (!dragActivatedRef.current && distance < SECTION_DRAG_THRESHOLD_PX) return;

      if (!dragActivatedRef.current) {
        // 首次越过阈值：激活拖拽，采集几何信息。
        dragActivatedRef.current = true;
        captureGeometry(draggingSection);
      }

      // 目标插入位：高度前缀和遍历「其余分区」的中心线，指针越过一个中心记一位。
      // 实时重排（若发生）会同步累加布局位移补偿，transform 必须在其**之后**计算，
      // 同一帧里「新布局位置 + 新 transform」一起绘制，视觉才不跳。
      const geometry = geometryRef.current;
      if (!geometry) return;
      const order = store.getOrder();
      const sourceIndex = order.indexOf(draggingSection);
      if (sourceIndex < 0) return;
      const otherHeights = heightsRef.current.filter((_, index) => index !== sourceIndex);
      let insertion = 0;
      let cursor = geometry.stackTop;
      for (let index = 0; index < otherHeights.length; index += 1) {
        const center = cursor + otherHeights[index] / 2;
        if (event.clientY > center) insertion = index + 1;
        cursor += otherHeights[index] + geometry.gap;
      }
      // basic_info 固定首位：插入位钳在 [1, n-1]，不可越过也不可顶替它。
      const targetIndex = Math.max(1, Math.min(insertion, order.length - 1));
      if (targetIndex !== sourceIndex) applyLiveReorder(sourceIndex, targetIndex);

      // 跟手视觉：ref 直改 transform（clamp 在分区栈范围内），不走 setState。
      // 偏移相对 pointerdown 的起始指针位置，与激活时机无关；再减去 order 变化把
      // 盒子挪动的累计位移，被拖卡片才始终钉在鼠标上（见 draggedLayoutShift 说明）。
      const element = draggedElRef.current;
      if (!element) return;
      const translateY = Math.min(
        geometry.maxTranslate,
        Math.max(geometry.minTranslate, event.clientY - start.y),
      );
      element.style.transform = `translateY(${translateY - layoutShiftRef.current}px)`;
    };
    const finishSectionDrag = (event: globalThis.PointerEvent) => {
      event.preventDefault();
      // 拖动中的实时重排已把顺序写进 store；松手/取消只做清理（transform 复位等）。
      clearDragState();
    };
    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", finishSectionDrag);
    document.addEventListener("pointercancel", finishSectionDrag);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishSectionDrag);
      document.removeEventListener("pointercancel", finishSectionDrag);
    };
    // applyLiveReorder / captureGeometry 只经 ref 与稳定 store 起作用，不进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingSection, clearDragState, store]);

  const toggleSectionReorderMode = useCallback(() => {
    if (store.isReordering()) clearDragState();
    applyReorderMode(!store.isReordering());
  }, [applyReorderMode, clearDragState, store]);

  const moveSectionByOffset = useCallback(
    (sectionKey: ProfileSectionKey, offset: -1 | 1) => {
      if (sectionKey === "basic_info") return;
      const current = store.getOrder();
      const sourceIndex = current.indexOf(sectionKey);
      const targetIndex = sourceIndex + offset;
      if (
        sourceIndex < 0 ||
        targetIndex <= 0 ||
        targetIndex >= current.length ||
        current[targetIndex] === "basic_info"
      ) {
        return;
      }
      const next = [...current];
      next.splice(sourceIndex, 1);
      next.splice(targetIndex, 0, sectionKey);
      store.commitOrder(next);
    },
    [store],
  );

  return {
    /** 顺序 + 排序模式的外部 store（ProfileSectionStack 用 useSyncExternalStore 订阅）。 */
    sectionOrderStore: store,
    /** 事件时刻读最新顺序（提交/解析等不经渲染的消费口）。 */
    getSectionOrder: store.getOrder,
    /** 整体换序（加载资料时写入服务端保存的顺序）。 */
    setSectionOrder: store.commitOrder,
    sectionReorderMode,
    setSectionReorderMode: applyReorderMode,
    resetSectionReorder,
    handleSectionPointerDown,
    toggleSectionReorderMode,
    moveSectionByOffset,
  };
}

/** 测试/调试用的计数器形状：分区内容与分区栈的渲染次数各一个可变槽。 */
export interface ReorderRenderCounters {
  contentRenders: RefObject<number>;
  commits: RefObject<number>;
}
