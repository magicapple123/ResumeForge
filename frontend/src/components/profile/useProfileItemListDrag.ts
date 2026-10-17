/** 资料分区里**小条目**（多条记录）的指针拖拽排序行为。
 *
 * 与更早实现（全部条目折叠成摘要条 + elementFromPoint 命中）的差别：
 * 1. **pointerdown 只记录起点，不改布局**：条目保持完整展开。旧实现在按下瞬间
 *    切换"排序模式"，所有条目塌缩成摘要条，布局塌缩后 elementFromPoint 命中错误
 *    条目或空白，松手时 move 用错索引甚至不触发——这正是用户实测"小条目拖不动"
 *    的根因。
 * 2. **越过阈值才激活，几何用缓存的前缀和**：激活时一次性采集本列表容器的条目
 *    几何（与当前顺序对齐），拖动中用共享的「指针行程制」插入判定算目标位
 *    （`resolveTargetIndex`，与分区拖拽同源），不碰 DOM 命中测试。
 * 3. **位置直接算，不累加位移**：`transform = 视觉目标位置 − 当前顺序下的布局位置`，
 *    实时重排（Form.List move）后同一帧内重算，无累计漂移。
 * 4. **拖拽期自动滚动**：指针贴近滚动容器（内层 `.app-content`）上下边缘时连续滚动，
 *    否则条目拖不出视口。
 *
 * 条目与分区的几何内核都在 `dragReorder.ts`，自动滚动在 `dragAutoScroll.ts`。
 */

import { flushSync } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent } from "react";
import {
  applyScrollShift,
  canScrollTowards,
  clampDesiredTop,
  dragTranslate,
  layoutTop,
  moveWithin,
  resolveTargetIndex,
  stackBottomOf,
  swapLatchOpen,
  TRAVEL_STEP_PX,
  type DragStackGeometry,
} from "./dragReorder";
import {
  compensateReleaseShift,
  createEdgeAutoScroller,
  disableScrollAnchoring,
  layoutTopWithoutTransform,
  resolveScrollParent,
  type EdgeAutoScroller,
} from "./dragAutoScroll";
import { captureFlipTops, playSwapFlip } from "./swapFlip";

const ITEM_DRAG_THRESHOLD_PX = 6;

/** 条目列表容器上用于限定几何查询范围的类名（见 ProfileSection 的 `.profile-list-items`）。 */
const LIST_CONTAINER_SELECTOR = ".profile-list-items";

/**
 * 从拖拽把手向上找到**所属**的条目列表容器。
 *
 * 资料页同时挂载 6 个分区列表（教育/实习/校园/项目/技能/荣誉），每行都带
 * `data-profile-list-item-index`——若几何采集退化成 `document.querySelectorAll`，
 * 就会把别的分区的行也算进来（gap 被算成几十上百像素、同号下标互相串味），
 * 于是 move 用错索引、transform 打到别的行上，视觉表现就是条目乱跳。所以几何
 * 查询必须严格限定在本列表容器内（见 captureGeometry）。
 *
 * 兜底：`closest(".profile-list-items")` 拿不到时退回把手所在条目的父节点，
 * 保证标记类被改名/裁剪时仍不会退化成全局查询。
 */
function resolveListContainer(handle: HTMLElement | null): HTMLElement | null {
  if (!handle) return null;
  const container = handle.closest<HTMLElement>(LIST_CONTAINER_SELECTOR);
  if (container) return container;
  const item = handle.closest<HTMLElement>("[data-profile-list-item-index]");
  return item?.parentElement ?? null;
}

interface Options {
  /** 拖拽总开关（非编辑态整体关闭）。 */
  enabled: boolean;
  /** 条目数（Form.List fields.length）。 */
  itemCount: number;
  /** 实际移动（Form.List operations.move，参数是当前顺序下的下标）。 */
  onMove: (from: number, to: number) => void;
}

export function useProfileItemListDrag({ enabled, itemCount, onMove }: Options) {
  /**
   * 正在被拖的条目：`index` 是按下那一刻的下标（此后只作为**身份**在缓存的几何
   * 数组里追踪，Form.List move 之后它的实际位置由 `dragIndexRef` 维护）；`key` 是
   * Form.List 的稳定 key，供渲染层给被拖条目挂视觉类（move 会改 field.name，
   * 不能用下标当视觉身份）。null 表示无拖动。
   */
  const [dragging, setDragging] = useState<{ index: number; key: number } | null>(null);
  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  const dragActivatedRef = useRef(false);
  /** 被拖条目**当前**在列表里的位置（实时重排时同步更新）。 */
  const dragIndexRef = useRef(-1);
  /** 激活时缓存的栈几何（heights 与当前顺序逐位对齐）。 */
  const geometryRef = useRef<DragStackGeometry | null>(null);
  const grabOffsetRef = useRef(0);
  const draggedHeightRef = useRef(0);
  /** 上一次算出的视觉目标位置：相邻两次的差决定拖动方向（静止/被 clamp 时沿用）。 */
  const lastDesiredTopRef = useRef(0);
  /** 指针最近一次的移动方向：1=向下，-1=向上。决定取上缘还是下缘做插入判定。 */
  /** 指针最近一次的移动方向：1=向下，-1=向上。静止时沿用（保留既有语义）。 */
  const directionRef = useRef<1 | -1>(1);
  /**
   * 行程锚点（内容坐标）：激活时 = 激活位置，每次真正换位后 = 当时 desiredTop。
   * 插入位 = 当前位 + |desiredTop − 锚点| / TRAVEL_STEP_PX 步；自动滚动时随内容
   * 平移（applyScrollShift，source==="auto"），外部滚动不平移（防 anchoring 环路）。
   * 它同时是换位闩锁的锚点（swapLatchOpen 用同一个值）。
   */
  const travelAnchorRef = useRef(0);
  const draggedElRef = useRef<HTMLElement | null>(null);
  const sectionElRef = useRef<HTMLElement | null>(null);
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  const lastScrollTopRef = useRef(0);
  const autoScrollerRef = useRef<EdgeAutoScroller | null>(null);
  /** 拖拽期关闭 `overflow-anchor` 的恢复函数（松手补偿写入后再调用）。 */
  const restoreScrollAnchorRef = useRef<(() => void) | null>(null);
  const lastPointerYRef = useRef(0);
  /**
   * 本次拖拽所属的条目列表容器（pointerdown 时缓存）。
   *
   * 资料页同时挂载 6 个列表，行上的 `data-profile-list-item-index` 在各列表之间
   * 是重复的（每个列表都有 0、1、2…），所以几何采集与身份比对都必须限定在这个
   * 容器内，否则会串到别的分区（见 `resolveListContainer`）。
   */
  const listRef = useRef<HTMLElement | null>(null);
  const onMoveRef = useRef(onMove);

  useEffect(() => {
    onMoveRef.current = onMove;
  });

  const clearDrag = useCallback(() => {
    pointerStartRef.current = null;
    dragActivatedRef.current = false;
    dragIndexRef.current = -1;
    geometryRef.current = null;
    grabOffsetRef.current = 0;
    draggedHeightRef.current = 0;
    lastDesiredTopRef.current = 0;
    directionRef.current = 1;
    travelAnchorRef.current = 0;
    lastPointerYRef.current = 0;
    listRef.current = null;
    const element = draggedElRef.current;
    if (element) {
      element.style.transform = "";
      element.classList.remove("is-dragging");
      draggedElRef.current = null;
    }
    const section = sectionElRef.current;
    if (section) {
      section.style.contentVisibility = "";
      sectionElRef.current = null;
    }
    setDragging(null);
  }, []);

  const handleItemPointerDown = useCallback(
    (event: ReactPointerEvent<HTMLElement>, index: number, key: number) => {
      if (!enabled || index < 0 || index >= itemCount || event.button !== 0) return;
      // 只记录起点、标记被拖条目；布局不变（is-dragging 视觉类在激活时才挂）。
      event.preventDefault();
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      lastPointerYRef.current = event.clientY;
      dragActivatedRef.current = false;
      dragIndexRef.current = index;
      // 缓存所属列表容器：几何采集只在本容器内查询（多列表页面上必须严格限定）。
      listRef.current = resolveListContainer(event.currentTarget as HTMLElement | null);
      setDragging({ index, key });
    },
    [enabled, itemCount],
  );

  useEffect(() => {
    if (!enabled || dragging === null) return;

    /** 激活时采集一次条目几何（此后移动全程零 DOM 查询）。 */
    function captureGeometry(): boolean {
      // **只查本列表容器**：资料页同时挂载 6 个列表，全局查询会把别的分区的行
      // 混进 gap/stackTop/order，同号下标互相顶替，导致 move 用错索引 → 抽动。
      const container = listRef.current;
      if (!container) return false;
      const items = Array.from(
        container.querySelectorAll<HTMLElement>("[data-profile-list-item-index]"),
      );
      if (items.length === 0) return false;
      const draggedElement = items.find(
        (element) => Number(element.dataset.profileListItemIndex) === dragIndexRef.current,
      );
      if (!draggedElement) return false;
      // 所属分区强制真实布局：拖拽中分区可能滚出视口，`content-visibility: auto`
      // 一旦生效就会把整块高度换成 contain-intrinsic-size（420px），缓存的前缀和
      // 立刻失效。
      //
      // **必须用内联样式，不能用 classList.add 挂类**：本 hook 拿不到分区壳的 React
      // 状态，命令式类会被分区壳重渲时的 className 整串覆盖（上一版 `is-dragging`
      // 就是这么丢的，几何随即整段错位）；而 React 的 style diff 只管理分区壳自己
      // 声明过的键（`order`），不会清掉 `contentVisibility`。结束时清空还原。
      const section = container.closest<HTMLElement>("[data-profile-section-key]");
      if (section) {
        section.style.contentVisibility = "visible";
        sectionElRef.current = section;
      }
      const rectList = items.map((element) => element.getBoundingClientRect());
      // 条目按 CSS gap 摆放；顺序数组与几何数组都按**屏幕位置**排（不假设 DOM 顺序）。
      const visual = rectList
        .map((rect, position) => ({
          rect,
          position,
          index: Number(items[position].dataset.profileListItemIndex),
        }))
        .sort((a, b) => a.rect.top - b.rect.top);
      const heights = visual.map((entry) => entry.rect.height);
      const gap =
        visual.length >= 2
          ? Math.max(0, visual[1].rect.top - (visual[0].rect.top + visual[0].rect.height))
          : 0;
      const stackTop = visual[0].rect.top;
      // 栈底由前缀和推导，保证 clamp 上限与插入判定自洽（末位一定可达）。
      const stackBottom = stackBottomOf(stackTop, gap, heights);
      // 视觉序第 i 位的条目，它此刻的 Form.List 下标；被拖条目在视觉序里的位置
      // 就是它当前的下标（激活前没有任何重排）。
      const draggedPosition = visual.findIndex((entry) => entry.index === dragIndexRef.current);
      if (draggedPosition < 0) return false;

      const draggedRect = draggedElement.getBoundingClientRect();
      const start = pointerStartRef.current;
      const rawOffset = start ? start.y - draggedRect.top : draggedRect.height / 2;
      geometryRef.current = { stackTop, stackBottom, gap, heights };
      grabOffsetRef.current = Math.min(Math.max(rawOffset, 0), draggedRect.height);
      draggedHeightRef.current = draggedRect.height;
      dragIndexRef.current = draggedPosition;
      // 方向跟踪的起点 = 激活时的布局位置：第一次移动就能判对方向（否则快速向上
      // 起手会被当成向下，先算出一个偏下的插入位）。
      lastDesiredTopRef.current = draggedRect.top;
      directionRef.current = 1;
      // 行程锚点 = 激活时的视觉目标位置（= 被拖卡布局上缘）。
      travelAnchorRef.current = draggedRect.top;
      // 抬起视觉（`is-dragging`）由渲染层按拖拽 key 声明式挂类（pointerdown 时已挂），
      // 这里不再命令式补类，避免两处来源互相覆盖。
      draggedElRef.current = draggedElement;
      return true;
    }

    function syncDrag(pointerY: number) {
      const geometry = geometryRef.current;
      const element = draggedElRef.current;
      if (!geometry || !element) return;
      const index = dragIndexRef.current;
      if (index < 0 || index >= geometry.heights.length) return;
      const height = draggedHeightRef.current;
      const desiredTop = clampDesiredTop(geometry, height, pointerY - grabOffsetRef.current);
      // 方向跟踪：只有明显位移（>0.5px）才改方向（保留既有语义；行程制下插入位
      // 的符号由 travel 自带，方向仅作为指针移动趋势的记录）。
      const delta = desiredTop - lastDesiredTopRef.current;
      if (delta > 0.5) directionRef.current = 1;
      else if (delta < -0.5) directionRef.current = -1;
      lastDesiredTopRef.current = desiredTop;
      // 目标插入位（行程制）：自行程锚点以来每 TRAVEL_STEP_PX 推进一格
      // （见 resolveTargetIndex 说明）；几何只负责 clamp，不再参与插入判定。
      const targetIndex = resolveTargetIndex(
        geometry.heights.length - 1,
        index,
        desiredTop,
        travelAnchorRef.current,
      );
      // 换位闩锁：距上一次真正换位不足 SWAP_LATCH_PX 时先不换（把当前目标位视为未达成），
      // 避免指针在临界点 ±2px 抖动导致邻项来回弹跳。
      if (targetIndex !== index && swapLatchOpen(travelAnchorRef.current, desiredTop)) {
        travelAnchorRef.current = desiredTop;
        // FLIP First：提交前量一次本列表内各行的视觉位置。
        const prevTops = captureFlipTops(listRef.current, "[data-profile-list-item-index]");
        // 实时重排：几何数组与 Form.List 的值同时更新（同步 splice 保持逐位对齐）。
        geometry.heights = moveWithin(geometry.heights, index, targetIndex);
        dragIndexRef.current = targetIndex;
        // **flushSync 是交换帧对齐的关键**：Form.List move 触发的 DOM 重排默认在
        // 下一帧才提交，而下面同步写入的 transform 是按**新布局**算的——不先提交
        // 布局就会出现一帧「旧布局 + 新 transform」，被拖条目向上（或向下）跳一个
        // 槽位（真机逐帧实测 -315.7px / +318.7px 两帧抖动）。flushSync 让 move 的
        // DOM 提交同步完成，随后写入的 transform 与布局同帧生效（单次绘制，无错帧）。
        // 调用点都在原生事件 / rAF 回调里，不在渲染期，flushSync 是安全的；
        // 换位受闩锁（≥12px）门控，频率很低，同步渲染不构成性能问题。
        flushSync(() => {
          onMoveRef.current(index, targetIndex);
        });
        // FLIP Last-Invert-Play：邻行从旧位置 150ms 滑到新位置；被拖条目保持 1:1 跟手。
        playSwapFlip(prevTops, element);
      } else if (
        targetIndex === index &&
        Math.abs(desiredTop - travelAnchorRef.current) >= TRAVEL_STEP_PX
      ) {
        // 钳制 pinned（目标位被栈边界挡住，步数 ≥1 却换不动）：锚点跟到当前位置，
        // 防止贴边滚动期间锚点单边漂移积累「行程债」——否则反向拖动时要先还清漂移量
        // 才能再次换位（真机 B6 回拖失效的根因）。
        travelAnchorRef.current = desiredTop;
      }
      const current = geometryRef.current;
      if (!current) return;
      element.style.transform = `translateY(${dragTranslate(
        desiredTop,
        layoutTop(current, dragIndexRef.current),
      )}px)`;
    }

    /**
     * 平移缓存的栈几何并重算跟手位置：滚动让内容整体上移 `delta`，项高与间距不变，
     * 因此只平移 stackTop/stackBottom，**不重新量 DOM**。
     */
    /**
     * 结算一次滚动：几何总是平移；行程锚点**只在自动滚动器自发的 tick 里**平移。
     *
     * 外部滚动（浏览器 scroll anchoring / 用户滚轮）只更新几何：锚点是「内容坐标」，
     * 被外部滚动挪走的内容已经不在指针下，此时再平移锚点等于"指针没动却离上次换位
     * 更远了"，会直接捅开闩锁再换位，而换位又触发 anchoring → 正反馈环路
     * （QA 实测分区 10/10 翻转、邻卡 −594↔−1484 弹跳 890px）。
     */
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
      const container = resolveScrollParent(listRef.current);
      if (!container) return;
      scrollContainerRef.current = container;
      lastScrollTopRef.current = container.scrollTop;
      // 拖拽期关掉浏览器滚动锚定：换位造成的布局变动会被 anchoring 反向补偿，
      // 再经 scroll 事件反馈回来，形成"换位→锚定→再换位"的正反馈。
      restoreScrollAnchorRef.current = disableScrollAnchoring(container);
      container.addEventListener("scroll", handleContainerScroll, { passive: true });
      autoScrollerRef.current = createEdgeAutoScroller({
        container,
        onTick: (delta) => applyScrollDelta(delta, "auto"),
        // 已被 clamp 在栈底/栈顶时指针继续贴边不滚（否则页面空转、卡片钉住不动）。
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
        if (distance < ITEM_DRAG_THRESHOLD_PX) return;
        if (!captureGeometry()) return;
        dragActivatedRef.current = true;
        startAutoScroll();
      }
      syncDrag(event.clientY);
      autoScrollerRef.current?.update(event.clientY);
    };

    const finishItemDrag = (event: globalThis.PointerEvent) => {
      event.preventDefault();
      autoScrollerRef.current?.stop();
      autoScrollerRef.current = null;
      // 松手瞬间补偿「分区 content-visibility 回落」带来的整页位移（见
      // compensateReleaseShift）：否则长页面上卡片会在松手那一帧跳一下。
      const element = draggedElRef.current;
      const container = scrollContainerRef.current;
      const beforeLayoutTop = element ? layoutTopWithoutTransform(element) : null;
      const restoreAnchor = restoreScrollAnchorRef.current;
      restoreScrollAnchorRef.current = null;
      // 条目不折叠，松手/取消只做清理（transform 复位、摘视觉类）。
      clearDrag();
      if (element && container && beforeLayoutTop !== null) {
        // overflow-anchor 在补偿写完之后再恢复（双重补偿守卫）。
        compensateReleaseShift(element, container, beforeLayoutTop, restoreAnchor ?? undefined);
      } else {
        restoreAnchor?.();
      }
    };

    document.addEventListener("pointermove", handlePointerMove, { passive: false });
    document.addEventListener("pointerup", finishItemDrag);
    document.addEventListener("pointercancel", finishItemDrag);
    return () => {
      document.removeEventListener("pointermove", handlePointerMove);
      document.removeEventListener("pointerup", finishItemDrag);
      document.removeEventListener("pointercancel", finishItemDrag);
      // rAF 不能泄漏：卸载 / 拖拽结束都必须停掉自动滚动。
      autoScrollerRef.current?.stop();
      autoScrollerRef.current = null;
      const container = scrollContainerRef.current;
      if (container) container.removeEventListener("scroll", handleContainerScroll);
      scrollContainerRef.current = null;
      // 拖拽中断（组件卸载）时也要摘掉视觉类，避免残留抬起态。
      const element = draggedElRef.current;
      if (element) {
        element.style.transform = "";
        element.classList.remove("is-dragging");
      }
      const section = sectionElRef.current;
      if (section) section.style.contentVisibility = "";
      // 兜底恢复滚动锚定（组件卸载 / 拖拽被中断）。
      restoreScrollAnchorRef.current?.();
      restoreScrollAnchorRef.current = null;
    };
  }, [clearDrag, dragging, enabled]);

  return { dragging, handleItemPointerDown };
}
