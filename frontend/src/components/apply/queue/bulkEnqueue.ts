/**
 * 批量「直接加入投递队列」（海投效率路径）：逐条入队、逐条容错。
 *
 * 为什么逐条而不是一次批量请求：入队闸门（已在队列 / 来源不支持）是**按条**返回 409 的，
 * 一次批量会让"其中一条已在队列"拖垮整批。海投场景用户要的是"能进的都进"，
 * 所以这里每条独立处理、最后给出聚合账目。
 *
 * 两条显式确认直接带上（`confirm_unanalyzed` / `confirm_real_gap`）：用户点的是
 * 「加入投递队列」这个明确动作，等于知情选择跳过逐条弹窗——投递前仍有准入核对兜底。
 */
import { addToQueue, QueueConflictError } from "../../../api/apply";

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
          message: err instanceof Error ? err.message : "加入投递队列失败",
        });
    }
  }
  return outcome;
}

/** 把聚合账目写成给用户看的一句话（失败明细由调用方按需展开）。 */
export function bulkEnqueueSummary(outcome: BulkEnqueueOutcome): string {
  const parts = [`已加入投递队列 ${outcome.enqueued} 个`];
  if (outcome.alreadyQueued) parts.push(`${outcome.alreadyQueued} 个已在队列`);
  if (outcome.unsupported) parts.push(`${outcome.unsupported} 个来源不支持自动投递`);
  if (outcome.failed.length) parts.push(`${outcome.failed.length} 个失败`);
  return parts.join("，");
}
