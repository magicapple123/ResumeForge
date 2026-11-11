// SPDX-License-Identifier: Apache-2.0
/**
 * 投递台 #14 的补充接口封装（体检 / 漏斗 / 跟进 / 话术库 / 屏蔽清单）。
 *
 * 单独成文件而不是塞进 `api/apply.ts`：后者已接近 500 行预算，而这一批是**新一轮**
 * 的接口面（全部由 #14 引入），独立成册既能守住预算，也让"这批加了哪些端点"一眼可见。
 * 契约见详册 #14「后端契约」；字段名以后端为准，前端不改名。
 */
import type {
  ApplyBlocklist,
  ApplyFunnelSummary,
  ApplyPreflightResult,
  ApplyStaleList,
  ApplyTrackResult,
  GreetingTemplate,
  GreetingTemplateList,
} from "../types";
import { buildQuery, request } from "./client";

// ===== 14A 投递前体检 =====

/**
 * 投放前体检（只读，不改任何状态）。
 *
 * 不传 `queue_ids` 时体检**整个队列**（与"不勾选＝投整个队列"同义）；传了只体检那些
 * 队列条目。注意 `queue_ids` 是**队列条目 id**，不是岗位 id——两者通常不同。
 */
export function runQueuePreflight(queueIds?: number[]): Promise<ApplyPreflightResult> {
  const body = queueIds && queueIds.length > 0 ? { queue_ids: queueIds } : {};
  return request("/apply/queue/preflight", { method: "POST", body: JSON.stringify(body) });
}

// ===== 14F 漏斗条 =====

/** 最近 `days` 天的执行量（已投 / 成功 / 失败 / 面试中）。 */
export function getApplySummary(days = 7): Promise<ApplyFunnelSummary> {
  return request(`/apply/summary${buildQuery({ days })}`);
}

// ===== 14C 跟进闭环 =====

/** 投递 ≥`days` 天、对应求职进度仍停在"已投/筛选中"的记录（静默提醒用）。 */
export function listStaleRecords(days = 7): Promise<ApplyStaleList> {
  return request(`/apply/records/stale${buildQuery({ days })}`);
}

/**
 * 把一条投递记录写进求职进度（`source=apply`、`channel=boss`）。
 *
 * 幂等语义在后端：按 `job_id + 未删除` 查重，已有则**更新阶段**并回 `created=false`，
 * 所以连点不会多出漏斗记录。
 */
export function trackApplyRecord(recordId: number): Promise<ApplyTrackResult> {
  return request(`/apply/records/${recordId}/track`, { method: "POST" });
}

// ===== 14D 话术库 =====

export function getGreetingTemplates(): Promise<GreetingTemplateList> {
  return request("/apply/greeting-templates");
}

/** 整份覆盖保存（后端存在 AppSetting 的 JSON 数组里，零迁移）。 */
export function saveGreetingTemplates(
  templates: GreetingTemplate[],
): Promise<GreetingTemplateList> {
  return request("/apply/greeting-templates", {
    method: "PUT",
    body: JSON.stringify({ templates }),
  });
}

// ===== 14E 屏蔽清单 =====

export function getApplyBlocklist(): Promise<ApplyBlocklist> {
  return request("/apply/blocklist");
}

export function saveApplyBlocklist(payload: ApplyBlocklist): Promise<ApplyBlocklist> {
  return request("/apply/blocklist", { method: "PUT", body: JSON.stringify(payload) });
}
