// SPDX-License-Identifier: Apache-2.0
/** 资料分区排序状态与指针拖拽行为（T05 重写；order 外部 store 化）。
 *
 * ## 零 `elementFromPoint`
 *
 * 拖动激活时一次性缓存各分区高度（与当前顺序对齐），pointermove 里用「指针行程制」
 * （`resolveTargetIndex`，自行程锚点每 TRAVEL_STEP_PX 推进一格）直接算插入位，
 * 不碰 DOM 命中测试；几何只负责 clamp 与布局前缀和。
 *
 * ## 拖动中实时重排
 *
 * 目标 index 变化就立即 splice 进顺序（高度数组同步），不等 pointerup；松手只做
 * 清理，顺序已经是最终态。
 *
 * ## 跟手视觉走 ref
 *
 * 被拖分区用 `style.transform = translateY(...)` 直改，不经 setState——指针移动
 * 本身不再引发任何 React 渲染。
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
 *
 * ## 拖动期折叠全部分区（第三轮：用户明确要求）
 *
 * 上一版刻意保持真实布局（不塌缩），理由记在 `profileCompactDrag.ts` 头注释：塌缩会
 * 改文档高度，滚动被夹 + 插入判定错位曾让卡片直接脱手。用户随后明确要求「一开始拖
 * 就把所有大卡片收起来，再在紧凑布局里换位」，于是这两条坑改成在激活那一刻显式处理：
 *
 * 1. 先记被拖卡的视口上缘 → `flushSync` 折叠全部卡片 → 把位移写进 `scrollTop`
 *    （`switchToCompactLayout`）；
 * 2. 折叠把卡片挪出指针时重设抓取偏移，让激活这一刻 `transform` 恒为 0
 *    （`resolveCompactGrabOffset`）；
 * 3. 几何在折叠**之后**采集，此后前缀和 / clamp / 换位 / 行程仍是同一套模型；
 * 4. 跟手就是**紧凑条自己**：`transform` 直写 + `is-dragging` 置顶（不再有独立浮条）。
 *
 * 松手在同一个 `flushSync` 里复位紧凑态（立刻恢复展开），恢复造成的整页位移由
 * `compensateReleaseShift` 逐帧补偿；位移收敛后把视角滚回**被拖卡片居中**
 * （`centerElementInContainer`）——折叠期 `scrollTop` 会被浏览器夹小，不主动滚回来
 * 就会停在页顶。
 */

import { flushSync } from "react-dom";
import { useCallback, useEffect, useRef, useState } from "react";
import type { PointerEvent as ReactPointerEvent, RefObject } from "react";
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
import { createSectionOrderStore } from "./sectionOrderStore";
import { stepSectionOrder } from "./profileSectionMove";
import { captureSectionGeometry } from "./profileSectionGeometry";
import {
  centerElementInContainer,
  resolveCompactGrabOffset,
  switchToCompactLayout,
} from "./profileCompactDrag";
import { commitLiveSwap } from "./profileSwapCommit";

interface Options {
  editing: boolean;
  saving: boolean;
  photoReading: boolean;
}

/** `basic_info` 固定首位：分区目标插入位的下限。 */
const SECTION_MIN_INDEX = 1;

export function useProfileSectionReorder({ editing, saving, photoReading }: Options) {
  // 排序模式仍保留一份 state：页头按钮（全部展开/收起）与 CSS 类要看它。
  // 它只在拖拽激活/退出时翻转一次，不会进入 pointermove 高频路径。
  const [sectionReorderMode, setSectionReorderModeState] = useState(false);
  /** 正在拖动的分区；null 表示无拖动。仅作为 document 监听的挂载开关使用。 */
  const [draggingSection, setDraggingSection] = useState<ProfileSectionKey | null>(null);
  // store 单例：useState 惰性初始化，组件生命周期内引用恒定（跨重渲保持监听器）。
  const [store] = useState(createSectionOrderStore);

  const pointerStartRef = useRef<{ x: number; y: number } | null>(null);
  /** 最近一次指针 y（自动滚动回调里要按它重算得跟手位置）。 */
  const lastPointerYRef = useRef(0);
  const dragActivatedRef = useRef(false);
  /** 激活时缓存的栈几何（heights 与当前顺序逐位对齐，重排时同步 splice）。 */
  const geometryRef = useRef<DragStackGeometry | null>(null);
  /** 指针按下点在被拖分区内的纵向偏移（0~h），跟手位置 = 指针 y − 它。 */
  const grabOffsetRef = useRef(0);
  const draggedHeightRef = useRef(0);
  /** 上一次算出的视觉目标位置：相邻两次的差决定拖动方向（静止/被 clamp 时沿用）。 */
  const lastDesiredTopRef = useRef(0);
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
  /** 本次拖拽的滚动容器（内层 `.app-content`），自动滚动与外部滚动补偿共用。 */
  const scrollContainerRef = useRef<HTMLElement | null>(null);
  /** 上一次已知的 scrollTop：外部/浏览器发起的滚动用它算增量。 */
  const lastScrollTopRef = useRef(0);
  const autoScrollerRef = useRef<EdgeAutoScroller | null>(null);
  /** 拖拽期关闭 `overflow-anchor` 的恢复函数（松手补偿写入后再调用）。 */
  const restoreScrollAnchorRef = useRef<(() => void) | null>(null);

  /** 排序模式写入的唯一出口：store 给分区栈，state 给页头按钮。 */
  const applyReorderMode = useCallback(
    (value: boolean) => {
      if (value) store.setReordering(true);
      else store.endDrag();
      setSectionReorderModeState(value);
    },
    [store],
  );

  /**
   * 拖拽激活：一次 notify 同时打开 reordering、被拖分区标记与「全部折叠」紧凑态
   * （三者同一次提交，折叠才不会比抬起视觉晚一帧）。
   *
   * 抬起视觉（`is-dragging`）必须走**声明式**类：激活时 React 会因为 reordering
   * 翻转而重写分区壳的 className，命令式 `classList.add('is-dragging')` 会被整串
   * 覆盖掉（真机上表现为卡片没有抬起、z-index 没置顶，被后面的兄弟卡盖住）。
   */
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
      // 只记录起点、被拖壳与分区标记，**不**改布局：越过阈值才激活。
      // 被拖壳必须在这里就拿到：折叠切换要在几何采集**之前**量它的 rect。
      pointerStartRef.current = { x: event.clientX, y: event.clientY };
      lastPointerYRef.current = event.clientY;
      dragActivatedRef.current = false;
      draggedElRef.current = event.currentTarget.closest<HTMLElement>("[data-profile-section-key]");
      setDraggingSection(sectionKey);
    },
    [editing, saving, photoReading],
  );

  /**
   * 把拖动项从 sourceIndex 实时挪到 targetIndex；顺序与高度数组同步 splice。
   * 每次都按新顺序重算 transform（不累加位移），所以重排与跟手在同一个几何模型里。
   * 提交细节（flushSync 帧对齐 + FLIP）见 `profileSwapCommit.ts`。
   */
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

  /**
   * 拖动激活时采集各分区高度（读一次 DOM，此后移动全程零 DOM 查询）。
   *
   * 实现见 `profileSectionGeometry.captureSectionGeometry`（几何模型与
   * `content-visibility` 的处理写在那边）；这里只负责把结果灌进各 ref。
   */
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
    // 方向跟踪的起点 = 激活时的布局位置：第一次移动就能判对方向。
    lastDesiredTopRef.current = captured.draggedTop;
    directionRef.current = 1;
    // 行程锚点 = 激活时的视觉目标位置（= 被拖卡布局上缘）。
    travelAnchorRef.current = captured.draggedTop;
    draggedElRef.current = captured.element;
    return true;
  };

  useEffect(() => {
    if (!draggingSection) return;
    const draggedKey = draggingSection;

    /**
     * 按指针 y 同步「插入位 + transform」：自动滚动、外部滚动、pointermove 三处共用。
     *
     * 顺序很重要：先按当前几何算目标插入位 → 需要就实时重排（顺序与 heights 同步）
     * → 再用**新顺序**算布局位置与 transform。全部在前缀和模型里完成，不读 DOM。
     */
    function syncDrag(pointerY: number) {
      const geometry = geometryRef.current;
      const element = draggedElRef.current;
      if (!geometry || !element) return;
      const order = store.getOrder();
      const sourceIndex = order.indexOf(draggedKey);
      if (sourceIndex < 0) return;
      const height = draggedHeightRef.current;
      const desiredTop = clampDesiredTop(geometry, height, pointerY - grabOffsetRef.current);
      // 方向跟踪：只有明显位移（>0.5px）才改方向（保留既有语义；行程制下插入位
      // 的符号由 travel 自带，方向仅作为指针移动趋势的记录）。
      const delta = desiredTop - lastDesiredTopRef.current;
      if (delta > 0.5) directionRef.current = 1;
      else if (delta < -0.5) directionRef.current = -1;
      lastDesiredTopRef.current = desiredTop;
      // 目标插入位（行程制）：自行程锚点以来每 TRAVEL_STEP_PX 推进一格
      // （见 resolveTargetIndex 说明）；几何只负责 clamp 与 basic_info 下限。
      const targetIndex = resolveTargetIndex(
        geometry.heights.length - 1,
        sourceIndex,
        desiredTop,
        travelAnchorRef.current,
        SECTION_MIN_INDEX,
      );
      // 换位闩锁：距上一次真正换位不足 SWAP_LATCH_PX 时先不换，避免卡片在临界点
      // ±2px 抖动时来回换位（gap=0 的大分区在旧实现里完全没有滞回）。
      if (targetIndex !== sourceIndex && swapLatchOpen(travelAnchorRef.current, desiredTop)) {
        travelAnchorRef.current = desiredTop;
        applyLiveReorder(sourceIndex, targetIndex);
      } else if (
        targetIndex === sourceIndex &&
        Math.abs(desiredTop - travelAnchorRef.current) >= TRAVEL_STEP_PX
      ) {
        // 钳制 pinned（目标位被 minIndex/lastIndex 挡住，步数 ≥1 却换不动）：锚点跟到
        // 当前位置，防止贴边滚动期间锚点单边漂移积累「行程债」——否则反向拖动时要先
        // 还清漂移量才能再次换位（真机 B6 回拖失效的根因）。
        travelAnchorRef.current = desiredTop;
      }
      const current = geometryRef.current;
      if (!current) return;
      const currentIndex = store.getOrder().indexOf(draggedKey);
      if (currentIndex < 0) return;
      // 跟手：视觉目标位置 − 当前顺序下的布局位置。重排后同一帧内重算，无漂移。
      // 被拖的就是卡片本身（紧凑条），`is-dragging` 由 React 声明式挂载负责置顶与合成层。
      element.style.transform = `translateY(${dragTranslate(
        desiredTop,
        layoutTop(current, currentIndex),
      )}px)`;
    }

    /**
     * 结算一次滚动：几何总是平移；行程锚点**只在自动滚动器自发的 tick 里**平移。
     *
     * 滚动让内容整体上移 `delta`，项高与间距不变，所以只需平移 stackTop/stackBottom
     * ——**不重新量 DOM**。外部滚动（用户滚轮、浏览器夹 scrollTop、scroll anchoring）
     * 只平移几何、**不动锚点**：锚点是「内容坐标」，被外部滚动挪走的内容已不在指针下，
     * 再平移锚点等于"指针没动却离上次换位更远了"，会捅开闩锁再换位，而换位又触发
     * anchoring → 正反馈环路（QA 实测分区 10/10 翻转、邻卡跨 890px 弹跳）。
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
      const container = resolveScrollParent(draggedElRef.current);
      if (!container) return;
      scrollContainerRef.current = container;
      lastScrollTopRef.current = container.scrollTop;
      // 拖拽期关掉浏览器滚动锚定（换位→anchoring→再换位的正反馈源头）。
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
        if (distance < SECTION_DRAG_THRESHOLD_PX) return;
        // 顺序不能反：先把**全部**大卡片折成紧凑条并补偿位移，再按紧凑高度量几何
        // （折叠 → 补偿 → 采集，理由见 profileCompactDrag.ts）。
        switchToCompactLayout({
          element: draggedElRef.current,
          enterCompactLayout: () => flushSync(() => beginSectionDrag(draggedKey)),
          resolveContainer: resolveScrollParent,
        });
        if (!captureGeometry(draggedKey)) {
          // 采不到几何（分区已不在 DOM）：把折叠退回去，否则整页永久停在紧凑条。
          flushSync(() => applyReorderMode(false));
          return;
        }
        // 折叠把卡片挪出了指针（补偿被滚动边界夹掉）时以紧凑条当前上缘重设抓取偏移，
        // 否则 desiredTop 会离原位好几槽，激活瞬间就连跳多位。
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
      // 松手/取消即退出排序模式：分区壳摘掉 is-dragging（置顶/合成层提示），顺序
      // 保留拖动中的最终态，没有"确认"步骤。
      //
      // `is-section-reordering`（强制真实布局）自进入编辑态起就挂在每个分区上
      // （见 ProfileSectionShell），拖拽全程不发生 content-visibility 切换——这正是
      // 拖拽激活瞬间卡片背景整段不绘制的伪影根因（Chrome 对「刚切出
      // content-visibility 的内容 + 新提升的合成层」会出现栅格失效）。
      //
      // 但紧凑折叠是一次**真实的高度变化**：松手必须立刻恢复展开，并让
      // `compensateReleaseShift` 逐帧补偿恢复造成的整页位移（所以 beforeLayoutTop
      // 必须取恢复**之前**的紧凑位置，恢复本身走 flushSync 同步落地）。
      const element = draggedElRef.current;
      const container = scrollContainerRef.current;
      // 未激活（按下即松手）时不做任何滚动：`scrollContainerRef` 此时为空，
      // 若无条件调 `centerElementInContainer` 会把「点一下拖动把手」变成一次滚动。
      const activated = dragActivatedRef.current;
      const beforeLayoutTop = element ? layoutTopWithoutTransform(element) : null;
      const restoreAnchor = restoreScrollAnchorRef.current;
      restoreScrollAnchorRef.current = null;
      flushSync(() => {
        applyReorderMode(false);
        clearDragState();
      });
      /**
       * 补偿帧收敛后的收尾：先恢复 overflow-anchor（先恢复再滚，否则这次滚动会被
       * 浏览器锚定重新计算一遍），再把视角落回被拖卡片居中（用户松手后要看到
       * 自己刚拖的那张卡，而不是被夹到 0 的页顶）。
       *
       * `isConnected` 兜底：收敛期最长 10 帧，窗口里组件可能已卸载（切路由）。脱离
       * 文档的元素 rect 全是 0，照算会把共享的 `.app-content` 推到错误位置。
       */
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
      // rAF 不能泄漏：卸载 / 拖拽结束都必须停掉自动滚动。
      autoScrollerRef.current?.stop();
      autoScrollerRef.current = null;
      const container = scrollContainerRef.current;
      if (container) container.removeEventListener("scroll", handleContainerScroll);
      scrollContainerRef.current = null;
      // 兜底恢复滚动锚定（组件卸载 / 拖拽被中断）。
      restoreScrollAnchorRef.current?.();
      restoreScrollAnchorRef.current = null;
      // 紧凑折叠同理：拖拽被打断时没有 pointerup 收尾，不主动复位就会让整页永远
      // 停在 52px 的标签条上（effect 的清理发生在提交之后，setState 是安全的）。
      store.setCompact(false);
    };
    // applyLiveReorder / captureGeometry 只经 ref 与稳定 store 起作用，不进依赖。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [draggingSection, beginSectionDrag, applyReorderMode, clearDragState, store]);

  // 上移/下移一位：实现与焦点收尾见 `profileSectionMove.ts`（键盘与微调按钮同一条路径）。
  const moveSectionByOffset = useCallback(
    (sectionKey: ProfileSectionKey, offset: -1 | 1) => stepSectionOrder(store, sectionKey, offset),
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
    moveSectionByOffset,
  };
}

/** 测试/调试用的计数器形状：分区内容与分区栈的渲染次数各一个可变槽。 */
export interface ReorderRenderCounters {
  contentRenders: RefObject<number>;
  commits: RefObject<number>;
}
