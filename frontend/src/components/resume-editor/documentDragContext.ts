// SPDX-License-Identifier: Apache-2.0
/**
 * 编辑器内部的拖拽上下文：记"当前被拿起的是哪个 item"，以及**本次落点为什么被拒**。
 *
 * 单独放一个 Context 而不是逐层传 props：拖拽源是三种区里的 chips，目标也散在各区，
 * 中间隔着 EntryCard / SectionEditor 好几层；逐层透传会让这些组件都长出一个与它们
 * 无关的参数。
 *
 * ## 为什么还要一个 `rejectRef`（问题 13）
 *
 * 非法落点（跨方框 / 位置不允许 / 插完不动）现在把 `dropEffect` 设成 `"none"`——浏览器
 * 因此**不派发 `drop`**，可禁止光标正是用户要的反馈。代价是 `onDrop` 里那些文案说不出口，
 * 所以原因记在 ref 里、由拖拽源的 `dragend` 补一条提示。
 *
 * 用 ref 而不是 state 的两个理由：
 * 1. `dragend` 需要读到**最后一次** `dragover` 的判定，state 在这里只会多一轮渲染；
 * 2. 不能读 `dragend` 的 `dataTransfer.dropEffect`——Chrome 里成功/失败都可能读到 `none`，
 *    判据必须是"我们自己记下的原因"。
 */
import { createContext, useContext, useMemo, useRef } from "react";
import type { MutableRefObject } from "react";
import type { DropRejectReason } from "../../features/resume-document/drag";

export interface DocumentDragValue {
  /** 正在被拖动的 item 路径；null = 没有拖动。 */
  draggedPath: string | null;
  setDraggedPath: (path: string | null) => void;
  /**
   * 记下"这次落点被拒"（非 null）或"这次落点合法"（null）。
   *
   * 用函数而不是把 ref 直接暴露出去：`react-hooks/immutability` 不允许改 hook 返回对象上的
   * 属性；而且写入点只有目标位的 `dragover` 一处，收成一个入口更不容易漏。
   */
  markRejected: (reason: DropRejectReason | null) => void;
  /**
   * 取走并清空本次拖拽的拒绝原因（拖拽源 `dragend` 专用）。
   *
   * 为什么需要 ref：`dropEffect="none"` 时浏览器**不派发 `drop`**，`onDrop` 里的文案说不出口；
   * 而 `dragend` 的 `dataTransfer.dropEffect` 在 Chrome 里成功/失败都可能读到 `none`，
   * 判据只能是我们自己记下的原因。
   */
  takeRejectReason: () => DropRejectReason | null;
}

/**
 * 没有 Provider 时的兜底（单测里单独渲染 ItemChip 之类）。
 * 状态放在模块级：`useDocumentDrag()` 每次渲染都返回同一个对象，不会因为"兜底对象是新建的"
 * 而丢掉上一次判定。
 */
const FALLBACK_REJECT: MutableRefObject<DropRejectReason | null> = { current: null };
const FALLBACK_VALUE: DocumentDragValue = {
  draggedPath: null,
  setDraggedPath: () => undefined,
  markRejected: (reason) => {
    FALLBACK_REJECT.current = reason;
  },
  takeRejectReason: () => {
    const reason = FALLBACK_REJECT.current;
    FALLBACK_REJECT.current = null;
    return reason;
  },
};

export const DocumentDragContext = createContext<DocumentDragValue | null>(null);

export function useDocumentDrag(): DocumentDragValue {
  return useContext(DocumentDragContext) ?? FALLBACK_VALUE;
}

/**
 * 编辑器级的拖拽上下文值（`DocumentEditor` 唯一调用点）。
 *
 * 抽成 hook 而不是在 `DocumentEditor` 里写 `useRef` + `useMemo`：那个文件已经贴着 500 行预算，
 * 而"拒绝原因"这块逻辑（写入 / 取走并清空 / 身份稳定）与编辑器本体无关。
 */
export function useDocumentDragHost(
  draggedPath: string | null,
  setDraggedPath: (path: string | null) => void,
): DocumentDragValue {
  const rejectRef: MutableRefObject<DropRejectReason | null> = useRef(null);
  // `setDraggedPath` 来自 useState，身份稳定；`draggedPath` 变化才需要换新对象。
  return useMemo(
    () => ({
      draggedPath,
      setDraggedPath,
      markRejected: (reason: DropRejectReason | null) => {
        rejectRef.current = reason;
      },
      takeRejectReason: () => {
        const reason = rejectRef.current;
        rejectRef.current = null;
        return reason;
      },
    }),
    [draggedPath, setDraggedPath],
  );
}
