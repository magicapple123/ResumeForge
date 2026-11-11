// SPDX-License-Identifier: Apache-2.0
/**
 * #15A–#15E 的接口封装（僵尸岗雷达 / JD 变更 / 岗位体检 / 简历指派建议 / 边际收益停止线）。
 *
 * 单独成文件而不并进 `api/apply.ts`：后者已 363 行、仍在增长，而这些端点是**同一条
 * 决策链**（先看这岗位还活着吗 → 再体检 → 再优化指派 → 投到拐点就停），独立成册让
 * "这批加了什么"一眼可见。契约见详册第 1290–1341 行；字段名以后端为准，前端不改名。
 */
import type {
  ApplyGhostIgnorePatch,
  ApplyGhostIgnoreResult,
  ApplyJdChange,
  ApplyJobInspect,
  ApplyResumeFitList,
  ApplyStoppingPoint,
} from "../types";
import { buildQuery, request } from "./client";

/**
 * 岗位体检（只读）。
 *
 * 参数是**队列条目 id**（不是岗位 id）——与 `/apply/queue/{id}` 系列同源。
 * 返回的三块（薪资偏离 / 同司多投 / 历史结果）都可能"样本不足"，界面照后端给的
 * `status` 显示，不在前端重算阈值。
 */
export function inspectQueueItem(queueId: number): Promise<ApplyJobInspect> {
  return request(`/apply/queue/${queueId}/inspect`);
}

/**
 * 批量取「简历指派建议」：每个选中条目一份，含当前/推荐简历与关键词覆盖。
 *
 * `ids` 是队列条目 id 列表，逗号拼接（后端按 `ids=1,2,3` 解析）。空数组直接返回空结果，
 * 不发请求——没有选中条目时调用它只会白打一次后端。
 */
export function getResumeFit(queueIds: number[]): Promise<ApplyResumeFitList> {
  if (queueIds.length === 0) return Promise.resolve({ items: [] });
  return request(`/apply/queue/resume-fit${buildQuery({ ids: queueIds.join(",") })}`);
}

/**
 * 边际收益停止线（只读）。`days` 是回看窗口，默认 28 天（= 4 周）。
 *
 * 样本次数由后端判定（< 10 条投递 → `insufficient`），前端不自己数。
 */
export function getStoppingPoint(days = 28): Promise<ApplyStoppingPoint> {
  return request(`/apply/stopping-point${buildQuery({ days })}`);
}

/**
 * #15B 某条队列条目的 JD 前后两版（只读，**被动式**）。
 *
 * 参数是**队列条目 id**——与 `/apply/queue/{id}` 系列同源，不是岗位 id。
 * "被动"是指后端只在自己采集时才发现变化：用户不采集，这里就一直是同一份文本，
 * 所以界面必须写明「下次采集时更新」，不能让人以为点了就会去重抓。
 */
export function getJdChange(queueId: number): Promise<ApplyJdChange> {
  return request(`/apply/queue/${queueId}/jd-change`);
}

/**
 * #15A 忽略 / 恢复某条岗位的僵尸分提示。
 *
 * 只写"不再提示这一个徽标"，**不改分数、不影响队列与投递**——所以失败也不阻塞任何操作。
 * 请求体只有 `{ ignored }`（后端契约），不是整个条目。
 */
export function setGhostIgnored(
  queueId: number,
  patch: ApplyGhostIgnorePatch,
): Promise<ApplyGhostIgnoreResult> {
  return request(`/apply/queue/${queueId}/ghost-ignore`, {
    method: "PUT",
    body: JSON.stringify(patch),
  });
}
