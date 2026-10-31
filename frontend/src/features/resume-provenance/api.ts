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
  AdoptLinkOut,
  AdoptLinkRequest,
  BlockLinkOut,
  FactLockCreateRequest,
  FactLockListOut,
  FactLockOut,
  LinkCreateRequest,
  OutboundPreviewOut,
  ProvenanceSourceListOut,
  UsagePricingIn,
  UsagePricingOut,
  UsagePricingRecordListOut,
  UsagePricingRecordOut,
  UsageRecordListOut,
  OutboundPreviewRequest,
  ResumeProvenanceOut,
  RewriteFieldOut,
  SourceChainOut,
  SourceImpactOut,
  ManualSourceCreateInput,
  ManualSourceOut,
  SourceLinkCreateRequest,
  SourceOut,
  RevisionTextViewOut,
  SourceRevisionsOut,
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

// ===== W12 冻结契约：数据集来源列表 / 手工来源 / 建立关联 / 采纳写正文 =====

/** 数据集级来源列表（GET /api/provenance/sources；SourceLinkModal 的选择器数据源）。 */
export function listProvenanceSources(
  params: { kind?: string; keyword?: string; limit?: number } = {},
): Promise<ProvenanceSourceListOut> {
  const query = new URLSearchParams();
  if (params.kind) query.set("kind", params.kind);
  if (params.keyword) query.set("keyword", params.keyword);
  if (params.limit) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return request(PROVENANCE + "/sources" + (suffix ? "?" + suffix : ""));
}

/**
 * 新建来源（POST /api/provenance/sources；P5-1 支持 kind / external_ref / payload）。
 *
 * 只给 title 时请求体与旧版逐字段一致（kind=manual、不带新字段），后端旧默认 payload
 * {"title": title} 因此保持不变——历史关联不会因为这次扩展集体变 stale。
 */
export function createManualSource(input: ManualSourceCreateInput): Promise<ManualSourceOut> {
  const body: Record<string, unknown> = { title: input.title, kind: input.kind ?? "manual" };
  const externalRef = (input.external_ref ?? "").trim();
  if (externalRef) body.external_ref = externalRef;
  const payload = input.payload ?? "";
  if (payload.trim()) body.payload = payload;
  return request(PROVENANCE + "/sources", { method: "POST", body: JSON.stringify(body) });
}

/** 某来源的修订列表（GET /sources/{id}/revisions）。 */
export function listSourceRevisions(sourceId: number): Promise<SourceRevisionsOut> {
  return request(PROVENANCE + "/sources/" + sourceId + "/revisions");
}

/**
 * 来源某版修订的原文（GET /sources/{id}/revision-text；adopt 预填用）。
 * `revisionNo` 缺省 = 最新修订；resolvable=false 表示来源无可读取正文。
 */
export function fetchRevisionText(
  sourceId: number,
  revisionNo?: number | null,
): Promise<RevisionTextViewOut> {
  const query = new URLSearchParams();
  if (typeof revisionNo === "number" && revisionNo > 0)
    query.set("revision_no", String(revisionNo));
  const suffix = query.toString();
  return request(
    PROVENANCE + "/sources/" + sourceId + "/revision-text" + (suffix ? "?" + suffix : ""),
  );
}

/** 建立/刷新块 → 来源关联（新契约：只带 source_id，不 upsert）。 */
export function createSourceLink(payload: SourceLinkCreateRequest): Promise<BlockLinkOut> {
  return request(PROVENANCE + "/links", {
    method: "POST",
    body: JSON.stringify(payload),
  });
}

/** 采纳来源更新：把新文本写回一个块（服务端事实锁/版本条件写，冲突返回 409）。 */
export function adoptSourceLink(linkId: number, payload: AdoptLinkRequest): Promise<AdoptLinkOut> {
  return request(PROVENANCE + "/links/" + linkId + "/adopt", {
    method: "POST",
    body: JSON.stringify(payload),
  });
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

/** 读取用户配置的单价（未配置 = input/output null）。 */
export function fetchUsagePricing(): Promise<UsagePricingOut> {
  return request("/usage/pricing");
}

/**
 * 保存一份新单价（每百万 token、三档），保存后立即生效。
 *
 * 每次保存都新建一条记录而不是覆盖：用户要能同时保留"官方价 / 调价后"并给它们命名。
 */
export function saveUsagePricing(payload: UsagePricingIn): Promise<UsagePricingOut> {
  return request("/usage/pricing", {
    method: "PUT",
    body: JSON.stringify(payload),
  });
}

/** 全部单价记录（新→旧），含哪条生效。 */
export function fetchUsagePricingRecords(): Promise<UsagePricingRecordListOut> {
  return request("/usage/pricing/records");
}

/** 给一条单价记录改名（价格与生效状态都不动）。 */
export function renameUsagePricingRecord(
  recordId: number,
  name: string,
): Promise<UsagePricingRecordOut> {
  return request(`/usage/pricing/records/${recordId}`, {
    method: "PATCH",
    body: JSON.stringify({ name }),
  });
}

/** 切换生效的单价（其它记录同时失效）。 */
export function activateUsagePricingRecord(recordId: number): Promise<UsagePricingOut> {
  return request(`/usage/pricing/records/${recordId}/activate`, { method: "POST" });
}

/** 删除一条单价记录（删掉生效那条时，剩下最新的一条自动顶上）。 */
export function deleteUsagePricingRecord(recordId: number): Promise<{ ok: boolean }> {
  return request(`/usage/pricing/records/${recordId}`, { method: "DELETE" });
}

/** 调用记录（含 finish_reason；无正文，隐私边界由后端保证）。 */
export function fetchUsageRecords(params: { limit?: number } = {}): Promise<UsageRecordListOut> {
  const query = new URLSearchParams();
  if (params.limit) query.set("limit", String(params.limit));
  const suffix = query.toString();
  return request("/usage/records" + (suffix ? "?" + suffix : ""));
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
