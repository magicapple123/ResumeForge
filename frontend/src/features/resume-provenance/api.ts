// SPDX-License-Identifier: Apache-2.0
/**
 * W12-FE 的真实 API 出口（后端已就绪：契约 `ResumeForge-w12-provenance-contract-20261024.md`）。
 *
 * 全部走既有 `api/client.request`（统一超时 / 取消 / 数据集头 / 错误体解析），
 * 不自己写 fetch——两套请求路径会让"切数据集后请求还打到旧库"这类问题重新出现。
 *
 * **外发预览的正文只在本函数栈里流转**：不写 localStorage/sessionStorage、不 console 输出
 * （契约 §5 的前端义务；组件层同样只用 state 持有）。
 */
import { request } from "../../api/client";
import type {
  BlockLinkOut,
  FactLockCreateRequest,
  FactLockListOut,
  FactLockOut,
  LinkCreateRequest,
  OutboundPreviewOut,
  OutboundPreviewRequest,
  ResumeProvenanceOut,
  RewriteFieldOut,
  SourceChainOut,
  SourceImpactOut,
  SourceOut,
  UsageSummaryOut,
} from "./types";

const PROVENANCE = "/provenance";

/** 整份简历的来源视图（sources + objects(link|null) + coverage）。 */
export function fetchProvenance(resumeId: number): Promise<ResumeProvenanceOut> {
  return request(PROVENANCE + "/resumes/" + resumeId);
}

/** 建立或刷新一个目标块到来源的关联。重复调用 = 刷新到最新修订。 */
export function createBlockLink(
  resumeId: number,
  payload: LinkCreateRequest,
): Promise<BlockLinkOut> {
  return request(PROVENANCE + "/resumes/" + resumeId + "/links", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 解除关联（拒绝采纳最新来源）。 */
export function deleteBlockLink(resumeId: number, linkId: number): Promise<void> {
  return request(PROVENANCE + "/resumes/" + resumeId + "/links/" + linkId, { method: "DELETE" });
}

/** 某块的来源链（object_id / point_id / path 至少给一个）。 */
export function fetchSourceChain(
  resumeId: number,
  locator: { object_id?: string; point_id?: string; path?: string },
): Promise<SourceChainOut> {
  const query = new URLSearchParams();
  if (locator.object_id) query.set("object_id", locator.object_id);
  if (locator.point_id) query.set("point_id", locator.point_id);
  if (locator.path) query.set("path", locator.path);
  return request(PROVENANCE + "/resumes/" + resumeId + "/chain?" + query.toString());
}

export function fetchSource(sourceId: number): Promise<SourceOut> {
  return request(PROVENANCE + "/sources/" + sourceId);
}

/** 来源变更影响面（跨简历）：这是"哪些简历要复核"的唯一入口。 */
export function fetchSourceImpact(sourceId: number): Promise<SourceImpactOut> {
  return request(PROVENANCE + "/sources/" + sourceId + "/impact");
}

// ===== 事实锁 =====
export function listFactLocks(resumeId: number): Promise<FactLockListOut> {
  return request(PROVENANCE + "/resumes/" + resumeId + "/fact-locks");
}

export function createFactLock(
  resumeId: number,
  payload: FactLockCreateRequest,
): Promise<FactLockOut> {
  return request(PROVENANCE + "/resumes/" + resumeId + "/fact-locks", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

export function deleteFactLock(resumeId: number, lockId: number): Promise<void> {
  return request(PROVENANCE + "/resumes/" + resumeId + "/fact-locks/" + lockId, {
    method: "DELETE",
  });
}

// ===== R04：用量 / 外发预览 =====
export function fetchUsageSummary(
  params: { task?: string; since?: string } = {},
): Promise<UsageSummaryOut> {
  const query = new URLSearchParams();
  if (params.task) query.set("task", params.task);
  if (params.since) query.set("since", params.since);
  const suffix = query.toString();
  return request("/usage/summary" + (suffix ? "?" + suffix : ""));
}

export function previewOutbound(payload: OutboundPreviewRequest): Promise<OutboundPreviewOut> {
  return request("/outbound/preview", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

// ===== 局部写作候选（复用既有 writing/rewrite-field；只返回建议，不落库） =====
export function rewriteField(
  resumeId: number,
  payload: { path: string; instruction: string },
): Promise<RewriteFieldOut> {
  return request("/resumes/" + resumeId + "/writing/rewrite-field", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}
