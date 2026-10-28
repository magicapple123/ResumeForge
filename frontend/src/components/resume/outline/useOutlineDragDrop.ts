// SPDX-License-Identifier: Apache-2.0
/**
 * 大纲树的**拖放接入层**（用户反馈 #4：拖动"大部分情况下拖不动"）。
 *
 * 三条职责，都不碰命令/历史（那些仍在 `useOutlineSort` 里）：
 * 1. `handleTreeDragOver`：树容器上**一律** `preventDefault`。HTML5 拖放只有一个硬规则：
 *    目标元素（或其祖先）在 dragover 里 preventDefault 过，drop 事件才会触发。旧实现只有
 *    行级处理器，所以松在缝隙/板块标题/分组容器上时**连 drop 都不会发生**；
 * 2. `handleTreeDrop`：落点交给 `outlineDropTargets` 解析（同类行 / 就近行 / 被拖自己 / 拒绝），
 *    原地松手不算改动；提交走与键盘同一个命令层（一条命令 = 一步历史）；
 * 3. **dragend 兜底**：行按预览换位后，若被拖行正好落到指针下，Chromium 会把 hovered
 *    元素当成"被替换"从而**扣掉 drop**（只剩 dragend）——真机"向下拖一格"就是这种形态。
 *    兜底把会话最后一步提交上去；「Esc 取消」用"dragend 之后浏览器还会把这次松手当普通
 *    pointerup/mouseup 派发"这一差异排除（正常松手时这两个事件被拖拽会话吞掉，真机实测）。
 *
 * 拖动中行被设成 `pointer-events:none` 且行组用 CSS `order` 换位（DOM 节点不换），
 * 于是 drop 的目标始终是**稳定的树容器**，浏览器不再扣 drop——drop 正常到达时提交，
 * dragend 只负责收尾（拖出树/取消 = 不改顺序）。
 * 另有**边缘自动滚动**：指针停在树容器上下边缘时持续滚动，长列表才能把条目拖到屏幕外。
 * 落点解析是纯函数（`outlineDropTargets.ts`），这里只管 DOM 事件与定时器。
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
  nearestDropIndex,
  type DropRowBox,
} from "./outlineDropTargets";
import type { OutlineDragPayload } from "./useOutlineSort";

/** 指针进入距容器上下边缘多少像素内开始自动滚动。 */
const AUTO_SCROLL_EDGE_PX = 40;
/** 每次滚动的像素数（每 50ms 一跳；不追求平滑，够把屏幕外行拖进可视区）。 */
const AUTO_SCROLL_STEP_PX = 14;
const AUTO_SCROLL_INTERVAL_MS = 50;

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
  /** 松在被拖对象自己身上：提交会话最后一步（与旧版 drop-on-target 语义一致）。 */
  commitDrag: () => void;
  /**
   * 拖动悬停回调：`{ key, index }` 表示指针当前离哪一行最近（index 是基准模型里的下标），
   * null = 没命中任何同类行。树容器上算，是因为拖动中行被设成 `pointer-events:none`
   * （见 OutlinePanel），行级 dragover 在真机上收不到。
   */
  onHover: (target: { key: string; index: number } | null) => void;
}

export interface OutlineDragDropApi {
  /** 树容器的 dragOver：允许 drop + 记录指针位置（自动滚动用）。 */
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

  /** 当前 DOM 里每一行的纵向中心（拖动中预览会换位，所以每次 dragover 现量）。 */
  const collectRows = useCallback((): DropRowBox[] => {
    const root = treeRef.current;
    if (!root) return [];
    return Array.from(root.querySelectorAll<HTMLElement>("[data-tree-key]")).map((element) => {
      const rect = element.getBoundingClientRect();
      return {
        key: element.dataset.treeKey ?? "",
        centerY: rect.top + rect.height / 2,
      };
    });
  }, [treeRef]);

  /** 指针纵向位置附近最近的**同类行**（行已 `pointer-events:none`，只能按几何距离算）。 */
  const hoverAt = useCallback(
    (pointerY: number): { key: string; index: number } | null => {
      let best: { distance: number; key: string; index: number } | null = null;
      for (const row of collectRows()) {
        const resolution = classifyDropKey(
          model,
          payload ?? { kind: "entry", field: "projects", objectId: "" },
          row.key,
        );
        let index: number | null = null;
        if (resolution.kind === "row") index = resolution.index;
        else if (resolution.kind === "self") index = dragStartIndex(model, payload!);
        if (index === null) continue;
        const distance = Math.abs(row.centerY - pointerY);
        if (!best || distance < best.distance) best = { distance, key: row.key, index };
      }
      return best ? { key: best.key, index: best.index } : null;
    },
    [collectRows, model, payload],
  );

  const handleTreeDragOver = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!payload) return;
      // 必须 cancel：否则缝隙/板块标题上的 drop 根本不会触发（见文件头第 1 条）。
      event.preventDefault();
      if (event.dataTransfer) event.dataTransfer.dropEffect = "move";
      // 真机：行 pointer-events:none，dragover 目标是树容器本身 → 在这里按几何距离算悬停；
      // jsdom 测试/键盘场景直接派发在行上（行级处理器已经算过了）→ 不要用 0 尺寸的
      // getBoundingClientRect 覆盖它。
      const target = event.target as Element | null;
      const insideRow = Boolean(target?.closest?.("[data-tree-key]"));
      if (!insideRow) onHover(hoverAt(event.clientY));
    },
    [hoverAt, onHover, payload],
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

  // 边缘自动滚动（指针停在边缘不动时也持续滚）。
  useEffect(() => {
    if (!payload) {
      pointerYRef.current = null;
      return;
    }
    const timer = window.setInterval(() => {
      const root = treeRef.current;
      const pointerY = pointerYRef.current;
      if (!root || pointerY === null || !pointerInsideRef.current) return;
      const rect = root.getBoundingClientRect();
      if (pointerY < rect.top + AUTO_SCROLL_EDGE_PX) {
        root.scrollTop = Math.max(0, root.scrollTop - AUTO_SCROLL_STEP_PX);
      } else if (pointerY > rect.bottom - AUTO_SCROLL_EDGE_PX) {
        root.scrollTop = Math.min(
          Math.max(0, root.scrollHeight - root.clientHeight),
          root.scrollTop + AUTO_SCROLL_STEP_PX,
        );
      }
    }, AUTO_SCROLL_INTERVAL_MS);
    return () => window.clearInterval(timer);
  }, [payload, treeRef]);

  const handleTreeDrop = useCallback(
    (event: DragEvent<HTMLDivElement>) => {
      if (!payload) return;
      event.preventDefault();
      const target = event.target as Element | null;
      const keyElement = target?.closest?.("[data-tree-key]") as HTMLElement | null;
      let resolution = classifyDropKey(model, payload, keyElement?.dataset.treeKey ?? "");
      if (resolution.kind === "nearest") {
        resolution = nearestDropIndex(model, payload, collectRows(), event.clientY) ?? {
          kind: "reject",
        };
      }
      if (resolution.kind === "reject") {
        // 落到别的板块/条目上：不猜用户意图，安静收尾（顺序不变）。
        endDrag();
        return;
      }
      if (resolution.kind === "self") {
        // 松在被拖对象自己身上（拖动中预览把它挪到了指针下）：提交会话最后一步。
        commitDrag();
        return;
      }
      if (resolution.index === dragStartIndex(model, payload)) {
        // 原地松手：不算一次改动，也不记历史。
        endDrag();
        return;
      }
      if (dispatch(dragDropCommand(payload, resolution.index))) {
        announce(
          t("outline.sort.committed", {
            name: dragPayloadName(model, payload),
            position: resolution.index + 1,
          }),
        );
      }
      endDrag();
    },
    [announce, collectRows, commitDrag, dispatch, endDrag, model, payload],
  );

  const handleTreeDragEnd = useCallback(() => {
    pointerInsideRef.current = false;
    // drop 已经处理过时 payload 已被清空，endDrag 是幂等的；拖到树外 / Esc 取消也走这里。
    endDrag();
  }, [endDrag]);

  return { handleTreeDragOver, handleTreeDrop, handleTreeDragEnd };
}
