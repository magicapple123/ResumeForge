// SPDX-License-Identifier: Apache-2.0
/** 投递队列的增删、体检与开始投递动作（从 ApplyQueuePanel 拆出，压 500 行预算）。
 *
 * 纯动作层：移出队列（单条/批量）、跑体检、开始投递的请求与提示。队列数据、筛选与
 * 界面渲染仍在 ApplyQueuePanel；本 hook 只拥有这些动作各自的 busy/弹层状态。
 */
import { useState } from "react";
import type { Dispatch, SetStateAction } from "react";
import { App } from "antd";
import { createApplyTask, getBrowserStatus, removeQueueItem } from "../../api/apply";
import { runQueuePreflight } from "../../api/applyExtras";
import type { ApplyPreflightResult, ApplyQueueItem, ApplyTask } from "../../types";
import { t } from "../../i18n";

type MessageApi = ReturnType<typeof App.useApp>["message"];

interface Options {
  items: ApplyQueueItem[];
  selectedIds: number[];
  setSelectedIds: Dispatch<SetStateAction<number[]>>;
  /** 来源不支持自动投递的待投条目（批量清理入口用）。 */
  unsupportedPending: ApplyQueueItem[];
  message: MessageApi;
  /** 队列内容变化后刷新列表与页面概览。 */
  refresh: () => void;
  onStarted: (task: ApplyTask) => void;
}

export function useApplyQueueOperations({
  items,
  selectedIds,
  setSelectedIds,
  unsupportedPending,
  message,
  refresh,
  onStarted,
}: Options) {
  const [busy, setBusy] = useState(false);
  const [batchRemoving, setBatchRemoving] = useState(false);
  // #14A 体检：抽屉、结果与"开始时自动跑一次"的确认弹层。
  const [preflightOpen, setPreflightOpen] = useState(false);
  const [preflightLoading, setPreflightLoading] = useState(false);
  const [preflight, setPreflight] = useState<ApplyPreflightResult | null>(null);
  const [confirmOpen, setConfirmOpen] = useState(false);

  const remove = async (item: ApplyQueueItem) => {
    setBusy(true);
    try {
      await removeQueueItem(item.id);
      setSelectedIds((current) => current.filter((id) => id !== item.id));
      message.success(t("applyQueue.toast.removed"));
      refresh();
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applyQueue.toast.removeFailed"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 批量移出：后端没有批量端点，逐条 DELETE、allSettled 聚合账目——一条失败不拖垮整批。
   * 「移出所选」与 #14I 的「移出这 N 条来源不支持」共用这一处，不再各写一份。
   */
  const removeMany = async (ids: number[], done: string) => {
    if (ids.length === 0) return;
    setBatchRemoving(true);
    try {
      const results = await Promise.allSettled(ids.map((id) => removeQueueItem(id)));
      const failed = results.filter((result) => result.status === "rejected").length;
      setSelectedIds((current) => current.filter((id) => !ids.includes(id)));
      refresh();
      if (failed > 0) {
        message.warning(t("applyQueue.toast.removePartial", { ok: ids.length - failed, failed }));
      } else {
        message.success(done);
      }
    } finally {
      setBatchRemoving(false);
    }
  };

  const removeSelected = () =>
    removeMany([...selectedIds], t("applyQueue.toast.removedCount", { count: selectedIds.length }));

  const removeUnsupported = () => {
    const ids = unsupportedPending.map((item) => item.id);
    void removeMany(ids, t("applyQueue.toast.removedUnsupported", { count: ids.length }));
  };

  /**
   * 跑一次体检（只读）。返回 `null` 表示体检没跑成（接口缺失 / 网络失败）——
   * 此时**不拦**投递：体检是额外保险，不该成为新的单点故障。
   */
  const runPreflight = async (queueIds?: number[]): Promise<ApplyPreflightResult | null> => {
    setPreflightLoading(true);
    try {
      const result = await runQueuePreflight(queueIds);
      setPreflight(result);
      return result;
    } catch {
      return null;
    } finally {
      setPreflightLoading(false);
    }
  };

  /** 体检范围：勾了就只查勾选的（与「开始投递」提交的范围同源），否则查整个队列。 */
  const preflightScope = (ids: number[]): number[] | undefined =>
    ids.length > 0 ? [...ids] : undefined;

  const openPreflight = () => {
    setPreflightOpen(true);
    void runPreflight(preflightScope(selectedIds));
  };

  /** 体检抽屉里的「移出队列」：删完立刻重跑一次，抽屉里的结论不会停在删之前。 */
  const fixRemove = async (queueId: number) => {
    const rest = selectedIds.filter((id) => id !== queueId);
    setBusy(true);
    try {
      await removeQueueItem(queueId);
      setSelectedIds(rest);
      message.success(t("applyQueue.toast.removed"));
      refresh();
      await runPreflight(preflightScope(rest));
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applyQueue.toast.removeFailed"));
    } finally {
      setBusy(false);
    }
  };

  /** 勾选条目的岗位 id（= 后端 `/apply/tasks` 要的形状）；没勾选时返回 undefined（整队列）。 */
  const chosenJobIds = (): number[] | undefined => {
    if (selectedIds.length === 0) return undefined;
    return items
      .filter(
        (item): item is ApplyQueueItem & { job_id: number } =>
          selectedIds.includes(item.id) && item.status === "pending" && item.job_id !== null,
      )
      .map((item) => item.job_id);
  };

  const launch = async (chosen: number[] | undefined) => {
    setBusy(true);
    try {
      // 投递由受控浏览器执行：浏览器没启动时后端必然失败。按钮不禁用（保留可发现性），
      // 但点击时先查一次状态并给出引导，而不是让用户去读一条后端报错。
      const browser = await getBrowserStatus();
      if (browser.state !== "running") {
        message.warning(t("applyQueue.toast.needBrowser"));
        return;
      }
      const task = await createApplyTask(
        chosen ? { job_ids: chosen, use_queue: false } : { use_queue: true },
      );
      message.success(
        chosen
          ? t("applyQueue.toast.startedSelected", { count: chosen.length })
          : t("applyQueue.toast.startedAll"),
      );
      setSelectedIds([]);
      onStarted(task);
    } catch (err) {
      message.error(err instanceof Error ? err.message : t("applyQueue.toast.startFailed"));
    } finally {
      setBusy(false);
    }
  };

  /**
   * 「开始投递」：先自动跑一次体检，有 blocking **弹确认但不硬拦**（与现有 409 语义一致）。
   * 体检接口不可用（`null`）时直接投——体检是额外保险，不是准入门。
   */
  const start = async () => {
    // Table 的 rowKey 是队列条目 id，而后端 /apply/tasks 的 job_ids 明确要求岗位 id。
    // 两种 id 通常不同，直接提交 selectedIds 会投错岗位，甚至在碰巧存在同号岗位时静默误投。
    const chosen = chosenJobIds();
    if (selectedIds.length > 0 && chosen?.length === 0) {
      message.warning(t("applyQueue.toast.notEligible"));
      return;
    }
    const check = await runPreflight(preflightScope(selectedIds));
    if (check && check.summary.blocking > 0) {
      // 叠层约束：同一时刻只留一个容器——体检抽屉先关，再开确认弹层。
      setPreflightOpen(false);
      setConfirmOpen(true);
      return;
    }
    await launch(chosen);
  };

  return {
    busy,
    batchRemoving,
    preflightOpen,
    setPreflightOpen,
    preflightLoading,
    preflight,
    confirmOpen,
    setConfirmOpen,
    remove,
    removeMany,
    removeSelected,
    removeUnsupported,
    runPreflight,
    openPreflight,
    fixRemove,
    chosenJobIds,
    launch,
    start,
  };
}
