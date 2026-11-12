// SPDX-License-Identifier: Apache-2.0
/**
 * 制作台**测量结果的模块级快照**（#24 24B）。
 *
 * ## 为什么走 store，而不是 props
 *
 * 测量只能发生在右栏画布里（`ResumeWorkbenchCanvas` 是 `LayoutMeasure` 的唯一产地：
 * iframe 在它内部，`onMeasure` / `onLayoutStatus` 只在那一层才拿得到）。而消费方是
 * **左栏**「版面」组顶部的状态条——它们是 `WorkbenchColumnsBody` 的两个兄弟节点，
 * 中间没有共享的 props 链。要接上只有两条路：把状态提到 `ResumeWorkbenchV2` 外壳再
 * 一路传下去（那个文件贴着 500 行预算，而且为此要改三处签名），或者用一块模块级快照。
 *
 * 这里选后者，与 `paginationReportStore` / `paginationRefreshStore` 同一个做法：
 * 那片代码的注释写明了同样的理由（"消费方与请求方不在同一个 props 链上"），
 * 不新增 shell 契约、不动外壳。
 *
 * ## 生命周期
 *
 * 画布挂载即写入、卸载即清空（`null`）。工作台同一时刻只挂一个（`WorkbenchModalFrame`
 * 是模态），所以"后写覆盖先写"不会串台；即便如此，清空仍然必须做——否则关闭制作台后
 * 再打开，左栏会先显示上一份简历的旧数字，那正好是本条要消灭的"数字打架"。
 */
import { useSyncExternalStore } from "react";
import type { LayoutMeasure } from "../../../utils/resumeLayoutMeasure";
import type { PreviewLayoutStatus } from "../preview/config";

/** 画布上报的一份测量：本地量到的高度 + 画布判定的版式状态（可能还没到）。 */
export interface WorkbenchLayoutSnapshot {
  measure: LayoutMeasure | null;
  layoutStatus: PreviewLayoutStatus | null;
}

const EMPTY: WorkbenchLayoutSnapshot = { measure: null, layoutStatus: null };

function sameMeasure(left: LayoutMeasure | null, right: LayoutMeasure | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.usedHeight === right.usedHeight &&
    left.pageContentHeight === right.pageContentHeight &&
    left.pageLimit === right.pageLimit
  );
}

function sameStatus(left: PreviewLayoutStatus | null, right: PreviewLayoutStatus | null): boolean {
  if (left === right) return true;
  if (!left || !right) return false;
  return (
    left.pages === right.pages &&
    left.overflow === right.overflow &&
    left.pagesNeeded === right.pagesNeeded &&
    left.pagesRendered === right.pagesRendered
  );
}

function sameSnapshot(left: WorkbenchLayoutSnapshot, right: WorkbenchLayoutSnapshot): boolean {
  return (
    sameMeasure(left.measure, right.measure) && sameStatus(left.layoutStatus, right.layoutStatus)
  );
}

let snapshot: WorkbenchLayoutSnapshot = EMPTY;
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of Array.from(listeners)) listener();
}

function subscribe(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

function getSnapshot(): WorkbenchLayoutSnapshot {
  return snapshot;
}

/**
 * 写入一份测量。`null` = 清空（画布卸载）。
 *
 * 值没变时不通知订阅者：`ResumePreview` 每次重排都会上报一份新对象，而拖动滑杆一轮会
 * 重排好几次——不折叠的话，左栏状态条会跟着做几次无意义的渲染。
 */
export function syncWorkbenchLayout(next: WorkbenchLayoutSnapshot | null): void {
  const value = next ?? EMPTY;
  if (sameSnapshot(snapshot, value)) return;
  snapshot = value;
  emit();
}

/** 订阅当前测量（画布没挂载时是 `{measure: null, layoutStatus: null}`）。 */
export function useWorkbenchLayoutSnapshot(): WorkbenchLayoutSnapshot {
  return useSyncExternalStore(subscribe, getSnapshot, getSnapshot);
}

/** 测试清理：与其它 store 的 `reset*` 成对使用。 */
export function resetWorkbenchLayout(): void {
  syncWorkbenchLayout(null);
}
