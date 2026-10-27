// SPDX-License-Identifier: Apache-2.0
/**
 * 批量「直接加入投递队列」（海投效率路径）：逐条入队、逐条容错。
 *
 * 为什么逐条而不是一次批量请求：入队闸门（已在队列 / 来源不支持）是**按条**返回 409 的，
 * 一次批量会让"其中一条已在队列"拖垮整批。海投场景用户要的是"能进的都进"，
 * 所以这里每条独立处理、最后给出聚合账目。
 *
 * 两条显式确认直接带上（`confirm_unanalyzed` / `confirm_real_gap`）：用户点的是
 * 「加入投递队列」这个明确动作，等于知情选择跳过逐条弹窗——投递前仍有准入核对兜底。
 *
 * ## 界面文案在 `bulkEnqueue.*` 语言包里
 *
 * 本模块是纯函数、不在 React 组件里，因此拿不到 `useLocale()`；用模块级 `t()` 即可，
 * 它在**事件处理时**被调用，每次重新读当前语言，不存在"切语言后还留着旧文案"的问题。
 * 反过来，模块作用域直接求值 `t()` 是错的（交接单 §8.1）：那会在模块求值时把语言钉死。
 */
import { addToQueue, QueueConflictError } from "../../../api/apply";
import { t } from "../../../i18n";

export interface BulkEnqueueOutcome {
  /** 成功加入队列的条数。 */
  enqueued: number;
  /** 已经在队列里、被跳过的条数。 */
  alreadyQueued: number;
  /** 因"来源不支持"等硬闸门未能加入的条数。 */
  unsupported: number;
  /** 其它失败明细（岗位 id + 原因）。 */
  failed: { jobId: number; message: string }[];
}

export function isAlreadyQueued(err: unknown): boolean {
  // i18n-ok: 这里匹配的是后端返回的错误文案（协议耦合），不是界面文案；翻译了永远匹配不上。
  return err instanceof QueueConflictError && err.detail.message.includes("已在投递队列中");
}

export function isUnsupportedSite(err: unknown): boolean {
  return err instanceof QueueConflictError && err.detail.site_unsupported === true;
}

export async function bulkEnqueueJobs(jobIds: number[]): Promise<BulkEnqueueOutcome> {
  const outcome: BulkEnqueueOutcome = { enqueued: 0, alreadyQueued: 0, unsupported: 0, failed: [] };
  for (const jobId of jobIds) {
    try {
      await addToQueue([{ job_id: jobId, confirm_unanalyzed: true, confirm_real_gap: true }]);
      outcome.enqueued += 1;
    } catch (err) {
      if (isAlreadyQueued(err)) outcome.alreadyQueued += 1;
      else if (isUnsupportedSite(err)) outcome.unsupported += 1;
      else
        outcome.failed.push({
          jobId,
          // `err.message` 是后端原文，原样透传；只有拿不到 Error 时才用兜底文案。
          message: err instanceof Error ? err.message : t("bulkEnqueue.error.enqueueFailed"),
        });
    }
  }
  return outcome;
}

/**
 * 把聚合账目写成给用户看的一句话（失败明细由调用方按需展开）。
 *
 * 每个分句都是一条完整的 key（不做词块拼接），分句之间的分隔符也来自语言包：
 * 中文是全角逗号、英文是半角逗号加空格。`t()` 在函数体内调用，切语言后下一次入队
 * 就会用新语言（见文件头的 §8.1 说明）。
 */
export function bulkEnqueueSummary(outcome: BulkEnqueueOutcome): string {
  const parts = [t("bulkEnqueue.summary.enqueued", { count: outcome.enqueued })];
  if (outcome.alreadyQueued) {
    parts.push(t("bulkEnqueue.summary.alreadyQueued", { count: outcome.alreadyQueued }));
  }
  if (outcome.unsupported) {
    parts.push(t("bulkEnqueue.summary.unsupported", { count: outcome.unsupported }));
  }
  if (outcome.failed.length) {
    parts.push(t("bulkEnqueue.summary.failed", { count: outcome.failed.length }));
  }
  return parts.join(t("bulkEnqueue.summary.separator"));
}
