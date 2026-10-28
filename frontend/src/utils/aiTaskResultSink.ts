// SPDX-License-Identifier: Apache-2.0
/**
 * 「任务完成 → 结果回到它该在的地方」的**登记台**（唯一跳板）。
 *
 * 为什么需要它：任务化的入口分两类。简历生成、单条岗位适配的结果**写在业务表里**
 * （打开页面读一次就有）；而风险扫描 / 岗位化建议 / 网申预览的结果**没有业务表**
 * （它们本来就地消费、不落库），只随任务的 `result_ref` 回来一次。
 *
 * 于是"那条结果交给谁"必须有一个登记点，而且要覆盖两条路径：
 * 1. **正常路径**：轮询拿到 `succeeded` 的那一次（`adapters.fetch` 里派发）；
 * 2. **刷新恢复路径**：`restoreBackgroundTasks()` 重放 localStorage / `/ai-tasks/active`
 *    时，任务可能早就完成了——那时没有任何组件在等回调，只有登记台能把结果交回去。
 *
 * 本模块**不 import 任何领域代码**（它只是一个 Map）：`utils/*` 被 `features/*` 依赖，
 * 反向 import 会立刻造成循环。领域 store 在模块初始化时 `registerAiTaskResultSink` 登记
 * 自己，派发时按 `kind` 查表。没登记的 kind 静默忽略——任务机制不该因为"没人认领结果"
 * 而报错。
 */

/** 收到结果的回调：`taskId` 用于调用方去重（同一任务可能被派发两次）。 */
export type AiTaskResultSink = (taskId: number, resultData: Record<string, unknown> | null) => void;

const sinks = new Map<string, AiTaskResultSink>();

/** 登记（或替换）一种任务的结果接收方。 */
export function registerAiTaskResultSink(kind: string, sink: AiTaskResultSink): void {
  sinks.set(kind, sink);
}

/** 派发一次"任务成功了，结果在这里"。 */
export function dispatchAiTaskResult(
  kind: string,
  taskId: number,
  resultData: Record<string, unknown> | null,
): void {
  sinks.get(kind)?.(taskId, resultData);
}

/** 已登记的 kind（测试断言用）。 */
export function registeredAiTaskResultKinds(): string[] {
  return [...sinks.keys()];
}
