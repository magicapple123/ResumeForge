// SPDX-License-Identifier: Apache-2.0
/**
 * 网申「AI 字段识别」的**暂存结果**：任务跑完了，用户可能已经不在这一页。
 *
 * ## 为什么是暂存，而不是直接写
 *
 * 网申填表会**写数据**（把值写进页面控件）。任务化之后有一个新的时间窗：任务在后台跑完时，
 * 用户可能正在别处改资料、或者在页面上手改了几个值。此时若自动把 AI 结果写到页面/表单上，
 * 就等于**覆盖他当时的编辑**，而且他看不见这件事发生过。
 *
 * 所以这条链路只做三件事，一步都不越界：
 * 1. 任务产出「AI 补全后的预览」→ 放进 `ai_task.result_ref`（服务端暂存）；
 * 2. 结果回来后进本模块的**暂存槽**（客户端暂存），**不写页面、不写填充记录**；
 * 3. 页面在用户眼前打开、且快照还是同一份时**自动应用**（此时"应用"= 把预览画出来，
 *    仍然一行都没写，勾选与填写还是用户自己点）；快照不同则留一张提示卡，
 *    由用户点「应用」再切过去。
 *
 * 真正写页面永远走同步的 `POST /webform/fill`：用户勾了才写、写完**不提交**。
 *
 * ## 为什么放模块级而不是页面 state
 *
 * 结果可能在页面卸载之后才到（那正是任务化要解决的问题）。放组件里，回来就没了。
 */
import { useSyncExternalStore } from "react";
import type { WebFormPreview } from "../../types/webform";
import { registerAiTaskResultSink } from "../../utils/aiTaskResultSink";

/** 本文件负责的任务类型（= 后端 `ai_task.kind`）。 */
const TASK_KIND = "webform_fill";

export interface StagedAiPreview {
  /** 这份预览对应哪一次页面快照（页面据此判断能不能直接应用）。 */
  snapshotId: string;
  preview: WebFormPreview;
  /** 到达时间（毫秒时间戳）：提示卡上说「刚刚识别完成」。 */
  receivedAt: number;
}

let staged: StagedAiPreview | null = null;
/** 已经收过的任务 id：刷新恢复与正常轮询可能各派发一次，别让提示卡重复跳。 */
const delivered = new Set<number>();
const listeners = new Set<() => void>();

function emit(): void {
  for (const listener of listeners) listener();
}

registerAiTaskResultSink(TASK_KIND, (taskId, resultData) => {
  if (delivered.has(taskId)) return;
  delivered.add(taskId);
  const snapshotId = String(resultData?.snapshot_id ?? "").trim();
  const preview = resultData?.preview;
  if (!snapshotId || !preview || typeof preview !== "object") return;
  staged = {
    snapshotId,
    preview: preview as unknown as WebFormPreview,
    receivedAt: Date.now(),
  };
  emit();
});

/** 当前暂存的 AI 预览（没有则为 `null`）。 */
export function getStagedAiPreview(): StagedAiPreview | null {
  return staged;
}

/** 用掉/丢弃暂存结果（页面应用过一次就该清掉，否则每次进页面都会重放旧预览）。 */
export function clearStagedAiPreview(): void {
  if (staged === null) return;
  staged = null;
  emit();
}

/** 订阅暂存槽的变化；返回取消订阅函数。 */
export function subscribeStagedAiPreview(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** 组件用的订阅入口。 */
export function useStagedAiPreview(): StagedAiPreview | null {
  return useSyncExternalStore(subscribeStagedAiPreview, getStagedAiPreview, getStagedAiPreview);
}

/** 测试用：清空暂存槽与去重集。 */
export function resetStagedAiPreview(): void {
  delivered.clear();
  staged = null;
  emit();
}
