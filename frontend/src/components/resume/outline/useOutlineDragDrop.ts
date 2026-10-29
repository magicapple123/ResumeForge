// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲树的**拖放接入层**（用户反馈 #4：拖动"大部分情况下拖不动"且很卡）。
 *
 * 三条职责，都不碰命令/历史（那些仍在 `useOutlineSort` 里）：
 * 1. `handleTreeDragOver`：树容器上**一律** `preventDefault`。HTML5 拖放只有一个硬规则：
 *    目标元素（或其祖先）在 dragover 里 preventDefault 过，drop 事件才会触发。旧实现只有
 *    行级处理器，所以松在缝隙/板块标题/分组容器上时**连 drop 都不会发生**；
 * 2. `handleTreeDrop`：落点与悬停预览**同一套语义**（都走 `bandHitRow`）：指针真的压在某个
 *    同类行上就用它的下标；**压在空要点字段的占位行上**（第三种落点）就搬进那个字段；
 *    否则提交 `sortSession.currentIndex`（用户在拖动中看到的那一版）。
 *    原地松手不算改动；提交走与键盘同一个命令层（一条命令 = 一步历史）；
 * 3. `handleTreeDragEnd`：只做**收尾**（清 payload / 目标高亮 / 会话 + 指针状态），不提交。
 *    历史坑：行按预览换位后，若被拖行正好落到指针下，Chromium 会把 hovered 元素当成
 *    "被替换"从而**扣掉 drop**（只剩 dragend）——真机"向下拖一格"曾是这种形态。
 *    现在 DOM 顺序稳定（只改 CSS `order`）+ 行 `pointer-events:none`，drop 稳定到达，
 *    所以"松手提交"只发生在 drop 路径；dragend 到达时 payload 已清空，是幂等 no-op。
 *
 * 拖动中行被设成 `pointer-events:none` 且行组用 CSS `order` 换位（DOM 节点不换），
 * 于是 drop 的目标始终是**稳定的树容器**，浏览器不再扣 drop。
 *
 * ## 性能：为什么 dragover 里只记坐标（2026-10-28 实测）
 *
 * 同一次拖动里 `dragover` 间隔 p95 = 43ms、max = **373ms**，`PerformanceObserver` 抓到两个
 * longtask（132ms / 124ms）。原因是旧实现**每次** dragover 都
 *   ① `querySelectorAll` + 对 60+ 个元素 `getBoundingClientRect()`（16 条目 + 30+ 要点 + 7 板块），
 *      与 React 同帧的 DOM 写入互相作废 → 布局抖动（layout thrash）；
 *   ② 解析结果直接 setState → 大纲整棵树重渲染 + 结构预览推到制作台顶层 → 三栏重渲染。
 * 现在 dragover 只把 `clientY` 记进 ref，**量测 + 解析 + setState 合并到一帧一次**
 * （`scheduleHover`）：同一帧的多次 dragover 只解析一次，量测结果天然按帧缓存。
 *
 * 另有**边缘自动滚动**：指针停在树容器上下边缘时持续滚动，长列表才能把条目拖到屏幕外。
 */
import { useCallback, useEffect, useRef } from "react";
import type { DragEvent, RefObject } from "react";
import { t } from "../../../i18n";
import type { OutlineModel } from "../../../features/resume-outline/model";
import type { OutlineCommand } from "../../../features/resume-outline/types";
import {
  classifyDropKey,
  dragDropCommand,
  dragPayloadName,
  dragStartIndex,
  resolveDropPoint,
  resolveHoverTarget,
  type DropRowBox,
} from "./outlineDropTargets";
import { dragFieldCommand } from "./outlineDropCommands";
import { collectRowBoxes } from "./outlineRowBoxes";
import type { OutlineDragPayload } from "./useOutlineSort";

/** 指针进入距容器上下边缘多少像素内开始自动滚动。 */
const AUTO_SCROLL_EDGE_PX = 40;
/** 自动滚动速度（px/ms）：与帧率无关；60fps 下约 4px/帧（≈230px/s），长列表也拖得动。 */
const AUTO_SCROLL_SPEED_PX_PER_MS = 0.24;
/** 单帧最多结算的时长：标签页掉帧后不会一次滚很远。 */
const AUTO_SCROLL_MAX_FRAME_MS = 50;
/** `requestAnimationFrame` 是否可用（jsdom/老宿主没有时退化成同步解析）。 */
function hasAnimationFrame(): boolean {
  return typeof window !== "undefined" && typeof window.requestAnimationFrame === "function";
}

interface Options {
  model: OutlineModel;
  payload: OutlineDragPayload | null;
  /** 大纲树滚动容器（`.resume-outline-tree`）。 */
  treeRef: RefObject<HTMLElement | null>;
  /** 与键盘/会话提交同一个命令出口（`useOutlineActions.dispatch`）。 */
  dispatch: (command: OutlineCommand) => boolean;
  announce: (text: string) => void;
  /** 收起拖动状态（清 payload / drop 高亮 / 会话）。 */
  endDrag: () => void;
  /** 松在被拖对象自己身上 / 缝隙里：提交会话最后一步（与旧版 drop-on-target 语义一致）。 */
  commitDrag: () => void;
  /**
   * 拖动悬停回调：`{ key, index }` 表示指针当前**压在**哪一行的行矩形里（index 是基准模型
   * 里的下标），null = 没压住任何同类行（缝隙/空白/自己）。树容器上算，是因为拖动中行被设成
   * `pointer-events:none`（见 OutlinePanel），行级 dragover 在真机上收不到。
   *
   * 压在**空要点字段占位行**上时，`index` 是被拖要点自己的基准下标（"不产生位移"），
   * 于是调用方既有的"下标没变就不 setState / 变回去就复位"分支就把预览清干净了；
   * 松手时的字段落点由 `classifyDropKey` / `resolveDropPoint` 的 `field` 分支负责。
   */
  onHover: (target: { key: string; index: number } | null) => void;
}

export interface OutlineDragDropApi {
  /** 树容器的 dragOver：允许 drop + 记录指针位置（悬停解析合并到一帧一次）。 */
  handleTreeDragOver: (event: DragEvent<HTMLDivElement>) => void;
  /** 树容器的 drop：按落点解析结果提交，或原地/无效时静默收尾。 */
  handleTreeDrop: (event: DragEvent<HTMLDivElement>) => void;
  /** 树容器的 dragEnd：收起拖动状态（拖到树外/取消时走这里；drop 已处理时是幂等的 no-op）。 */
  handleTreeDragEnd: () => void;
}

export function useOutlineDragDrop({
  model,
  payload,
  treeRef,
  dispatch,
  announce,
  endDrag,
  commitDrag,
  onHover,
}: Options): OutlineDragDropApi {
  /** 最近一次 dragover 的视口纵向坐标（边缘自动滚动用）。 */
  const pointerYRef = useRef<number | null>(null);
  /** 指针此刻是否在树容器内（由 document 级 dragover 维护：拖出树后能立刻变 false）。 */
  const pointerInsideRef = useRef(false);
  /** 最近一次上报的悬停目标行（判据 3 用；拖动结束清空，下一次拖动不会继承上一次的目标）。 */
  const activeHoverKeyRef = useRef<string | null>(null);
  /** 待解析的指针 y：同一帧里多次 dragover 只保留最后一次。 */
  const pendingHoverYRef = useRef<number | null>(null);
  /** 已排队的悬停解析帧（0 = 没有排队）。dragover 与自动滚动共用它，一帧最多解析一次。 */
  const hoverFrameRef = useRef(0);

  const cancelHoverFrame = useCallback(() => {
    pendingHoverYRef.current = null;
    if (hoverFrameRef.current !== 0) {
      if (hasAnimationFrame()) window.cancelAnimationFrame(hoverFrameRef.current);
      hoverFrameRef.current = 0;
    }
  }, []);

  useEffect(() => {
    if (!payload) {
      activeHoverKeyRef.current = null;
      cancelHoverFrame();
    }
  }, [cancelHoverFrame, payload]);

  // 卸载时不要留悬停帧：回调里持有旧的 model/payload，松手之后跑起来会"复活"一次预览。
  useEffect(() => cancelHoverFrame, [cancelHoverFrame]);

  /** 当前 DOM 里每一行的矩形（量**行元素**本身，不是包含子树的 treeitem；见 outlineRowBoxes）。 */
  const collectRows = useCallback((): DropRowBox[] => collectRowBoxes(treeRef.current), [treeRef]);

  /**
   * 指针纵向位置 → 悬停目标（行已 `pointer-events:none`，只能按几何算）。
   * 返回 null = 维持现状：指针压在被拖行自己身上、没压住任何行（缝隙）、或压的就是当前目标。
   * 判定规则与不变量见 `resolveHoverTarget`。
   */
  const hoverAt = useCallback(
    (pointerY: number): { key: string; index: number } | null => {
      if (!payload) return null;
      const resolution = resolveHoverTarget(
        model,
        payload,
        collectRows(),
        pointerY,
        activeHoverKeyRef.current,
      );
      if (resolution.kind !== "target") return null;
      activeHoverKeyRef.current = resolution.key;
      return { key: resolution.key, index: resolution.index };
    },
    [collectRows, model, payload],
  );

  /**
   * 把一次悬停解析**合并到下一帧**：同一帧里无论来了多少次 dragover / 自动滚动，都只量测
   * 一次、只 setState 一次。没有 rAF 的宿主（老 jsdom）退化成同步解析，行为仍可预期。
   */
  const scheduleHover = useCallback(
    (pointerY: number) => {
      pendingHoverYRef.current = pointerY;
      if (!hasAnimationFrame()) {
        const immediateY = pendingHoverYRef.current;
        pendingHoverYRef.current = null;
        if (immediateY === null) return;
        const hover = hoverAt(immediateY);
        if (hover) onHover(hover);
        return;
      }
      if (hoverFrameRef.current !== 0) return;
      hoverFrameRef.current = window.requestAnimationFrame(() => {
        hoverFrameRef.current = 0;
        const frameY = pendingHoverYRef.current;
        pendingHoverYRef.current = null;
        if (frameY === null) return;
        const hover = hoverAt(frameY);
        if (hover) onHover(hover);
      });
    },
    [hoverAt, onHover],
  );

  const handleTreeDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!payload) return;
      // 必须 cancel：否则缝隙/板块标题上的 drop 根本不会触发（见文件头第 1 条）。
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      // 真机：行 pointer-events:none，dragover 目标是树容器本身 → 在树容器上按几何算悬停；
      // jsdom 测试/键盘场景直接派发在行上（行级处理器已经算过了）→ 不要用 0 尺寸的
      // getBoundingClientRect 覆盖它。
      const target = event.target as Element | null;
      const insideRow = Boolean(target?.closest?.("[data-tree-key]"));
      if (insideRow) return;
      // 高频事件只记坐标：量测/解析/setState 全部收敛到一帧一次（见文件头「性能」）。
      scheduleHover(event.clientY);
    },
    [payload, scheduleHover],
  );

  // 指针是否还在树内、坐标在哪：挂在 document 的 dragover 上。
  // 不能只看树自身的 dragleave —— 拖动中行会换位，dragenter/dragleave 会在子元素间频繁抖动，
  // 且 relatedTarget 经常是 null，"在树内换行"会被误判成"离开树"（真机实测）。
  useEffect(() => {
    if (!payload) {
      pointerInsideRef.current = false;
      return;
    }
    const onDragOver = (event: globalThis.DragEvent) => {
      const root = treeRef.current;
      const target = event.target as Node | null;
      if (!root || !target) return;
      if (!root.contains(target)) {
        pointerInsideRef.current = false;
        return;
      }
      pointerInsideRef.current = true;
      pointerYRef.current = event.clientY;
    };
    document.addEventListener("dragover", onDragOver, true);
    return () => document.removeEventListener("dragover", onDragOver, true);
  }, [payload, treeRef]);

  // 边缘自动滚动（指针停在边缘不动时也持续滚），与浏览器绘制同一节奏（rAF）。
  // 滚动改变了行相对指针的位置，但**不在滚动回调里同步重算悬停**：走同一个 `scheduleHover`
  // （下一帧再算），避免"滚动 → 重算 → 改预览 → 又改布局"在同一个任务里连锁触发。
  useEffect(() => {
    if (!payload) {
      pointerYRef.current = null;
      return;
    }
    if (!hasAnimationFrame()) return;
    let frame = 0;
    let lastFrameAt = performance.now();
    const tick = (now: number) => {
      frame = window.requestAnimationFrame(tick);
      const elapsed = Math.min(AUTO_SCROLL_MAX_FRAME_MS, Math.max(0, now - lastFrameAt));
      lastFrameAt = now;
      const root = treeRef.current;
      const pointerY = pointerYRef.current;
      if (!root || pointerY === null || !pointerInsideRef.current) return;
      const rect = root.getBoundingClientRect();
      let scrolled = false;
      if (pointerY < rect.top + AUTO_SCROLL_EDGE_PX) {
        const next = Math.max(0, root.scrollTop - AUTO_SCROLL_SPEED_PX_PER_MS * elapsed);
        if (next !== root.scrollTop) {
          root.scrollTop = next;
          scrolled = true;
        }
      } else if (pointerY > rect.bottom - AUTO_SCROLL_EDGE_PX) {
        const max = Math.max(0, root.scrollHeight - root.clientHeight);
        const next = Math.min(max, root.scrollTop + AUTO_SCROLL_SPEED_PX_PER_MS * elapsed);
        if (next !== root.scrollTop) {
          root.scrollTop = next;
          scrolled = true;
        }
      }
      // 滚动后行相对指针变了：下一帧再解析一次（与 dragover 的悬停共用同一个帧槽位）。
      if (scrolled) scheduleHover(pointerY);
    };
    frame = window.requestAnimationFrame(tick);
    return () => window.cancelAnimationFrame(frame);
  }, [payload, scheduleHover, treeRef]);

  /**
   * 松在**空字段占位行**上：直接搬进那个字段（`toIndex: 0`，一条 `move-point` = 一步历史）。
   * 不与 `dragStartIndex` 比较：占位落点天然是"换了字段"，下标相同也必须提交。
   */
  const commitFieldDrop = useCallback(
    (pointField: string) => {
      if (payload) {
        const command = dragFieldCommand(payload, pointField);
        if (command && dispatch(command)) {
          announce(
            t("outline.sort.committed", { name: dragPayloadName(model, payload), position: 1 }),
          );
        }
      }
      endDrag();
    },
    [announce, dispatch, endDrag, model, payload],
  );

  const handleTreeDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!payload) return;
      event.preventDefault();
      // 落点在这一刻重新量（不受排队的悬停帧影响）：先作废排队帧，免得它在松手之后再
      // 带着旧的 payload 跑一次、把预览/高亮改回去。
      cancelHoverFrame();
      const target = event.target as Element | null;
      const keyElement = target?.closest?.("[data-tree-key]") as HTMLElement | null;
      const keyed = classifyDropKey(model, payload, keyElement?.dataset.treeKey ?? "");
      // 落到别的板块/别的条目上：不猜用户意图，安静收尾（顺序不变）。
      if (keyed.kind === "reject") {
        endDrag();
        return;
      }
      // 松在空字段占位行上：搬进该字段，不走扁平下标。
      if (keyed.kind === "field") {
        commitFieldDrop(keyed.pointField);
        return;
      }
      // 松在被拖对象自己身上（拖动中预览把它挪到了指针下）：提交会话最后一步。
      if (keyed.kind === "self") {
        commitDrag();
        return;
      }
      let index: number | null = keyed.kind === "row" ? keyed.index : null;
      if (index === null) {
        // 键说明不了落点（真机：行 `pointer-events:none`，drop 目标恒为树容器）→
        // 交给与悬停完全相同的 band 判定，绝不另算一套"最近行"。
        const resolution = resolveDropPoint(model, payload, collectRows(), event.clientY);
        if (resolution.kind === "reject") {
          endDrag();
          return;
        }
        // 缝隙 / 压在自己身上：提交拖动中看到的那一版（原地时是 no-op）。
        if (resolution.kind === "commit") {
          commitDrag();
          return;
        }
        if (resolution.kind === "field") {
          commitFieldDrop(resolution.pointField);
          return;
        }
        index = resolution.index;
      }
      if (index === dragStartIndex(model, payload)) {
        // 原地松手：不算一次改动，也不记历史。
        endDrag();
        return;
      }
      if (dispatch(dragDropCommand(model, payload, index))) {
        announce(
          t("outline.sort.committed", {
            name: dragPayloadName(model, payload),
            position: index + 1,
          }),
        );
      }
      endDrag();
    },
    [
      announce,
      cancelHoverFrame,
      collectRows,
      commitDrag,
      commitFieldDrop,
      dispatch,
      endDrag,
      model,
      payload,
    ],
  );

  const handleTreeDragEnd = useCallback(() => {
    pointerInsideRef.current = false;
    cancelHoverFrame();
    // drop 已经处理过时 payload 已被清空，endDrag 是幂等的；拖到树外 / Esc 取消也走这里。
    endDrag();
  }, [cancelHoverFrame, endDrag]);

  return { handleTreeDragOver, handleTreeDrop, handleTreeDragEnd };
}
