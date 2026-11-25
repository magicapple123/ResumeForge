// SPDX-License-Identifier: Apache-2.0
/**
 * 刷新恢复时"已经结束的任务"该怎么提醒（CR-25）。
 *
 * 单独成文件的两个理由：
 * 1. `backgroundTasks.ts` 已经贴着 500 行预算——这段只依赖 `notifyTaskDone` 与文案，
 *    不属于登记表本身的职责；
 * 2. 合并规则本身就是一条可独立陈述的约束：**同样的事只说一次**。恢复是并发查的，
 *    每条都弹一次会在启动瞬间连开好几个窗（用户报的"刷新后一堆弹窗"）。
 */
import { t } from "../i18n";
import { notifyTaskDone } from "./taskNotify";

/** 恢复阶段发现的一条"刷新前已经到终态"的任务。 */
export interface RestoredTerminal {
  /** 登记表里的任务键（`<kind>:<id>`），合并提醒的幂等键用它组成。 */
  taskKey: string;
  status: "completed" | "failed";
  title: string;
  description: string;
  deepLink: string | null;
  viewLabel: string;
}

/**
 * 把恢复阶段发现的终态任务合并成**一次**提醒。
 *
 * 只有 1 条时保持原样（带自己的深链，点进去就是那条结果）；多条时合并成一条并**不给**
 * 深链——多个结果没有单一落点，随便挑一个只会把用户丢进不相干的地方。
 */
export function notifyRestoredTerminals(terminals: RestoredTerminal[]): void {
  if (terminals.length === 0) return;
  if (terminals.length === 1) {
    const only = terminals[0];
    notifyTaskDone({
      modal: only.status === "completed",
      kind: only.status === "failed" ? "error" : undefined,
      title: only.title,
      description: only.description,
      confirmLabel: t("backgroundTasks.confirm.gotIt"),
      deepLink: only.deepLink,
      viewLabel: only.viewLabel,
      dedupeKey: `background:restore:${only.taskKey}`,
    });
    return;
  }
  const completed = terminals.filter((item) => item.status === "completed").length;
  const failed = terminals.length - completed;
  const parts = [
    completed > 0 ? t("backgroundTasks.restore.completed", { count: completed }) : "",
    failed > 0 ? t("backgroundTasks.restore.failed", { count: failed }) : "",
  ].filter(Boolean);
  const keys = terminals
    .map((item) => item.taskKey)
    .sort()
    .join(",");
  notifyTaskDone({
    modal: true,
    title: t("backgroundTasks.restore.mergedTitle", { count: terminals.length }),
    description: parts.join(" · "),
    confirmLabel: t("backgroundTasks.confirm.gotIt"),
    deepLink: null,
    dedupeKey: `background:restore:${new Date().toISOString().slice(0, 10)}:${keys}`,
  });
}
