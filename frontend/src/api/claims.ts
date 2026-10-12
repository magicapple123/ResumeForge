/** 事实台账接口：条目增删改查、事实基线，以及从一段资料草拟条目。 */
import type {
  Claim,
  ClaimDigest,
  ClaimDraft,
  ClaimDraftPayload,
  ClaimList,
  ClaimPageList,
  ClaimPayload,
} from "../types";
import { buildQuery, request } from "./client";

export function listClaims(
  params: { category?: string; status?: string; keyword?: string } = {},
): Promise<ClaimList> {
  return request(`/claims${buildQuery(params)}`);
}

/**
 * 分页列出事实台账（RF-08 续）：过滤语义与旧端点一致，汇总（total/confirmed/
 * pending/category_counts）随响应下发——页面不必再为统计拉全量。行是摘要
 * （原文/表述 ≤200 字），全文走 getClaim(id)。
 */
export function listClaimsPage(
  params: { category?: string; status?: string; keyword?: string } = {},
  page: number,
  pageSize: number,
): Promise<ClaimPageList> {
  return request(`/claims/page${buildQuery({ ...params, page, page_size: pageSize })}`);
}

export function getClaim(id: number): Promise<Claim> {
  return request(`/claims/${id}`);
}

export function createClaim(payload: ClaimPayload): Promise<Claim> {
  return request("/claims", { method: "POST", body: JSON.stringify(payload) });
}

export function updateClaim(id: number, payload: ClaimPayload): Promise<Claim> {
  return request(`/claims/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteClaim(id: number): Promise<void> {
  return request(`/claims/${id}`, { method: "DELETE" });
}

/** 批量移入回收站（软删除）：与简历批量删除同一口径，后端缺失任一 id 即整体 404。 */
export function batchDeleteClaims(claimIds: number[]): Promise<{ deleted: number }> {
  return request("/claims/batch-delete", {
    method: "POST",
    body: JSON.stringify({ claim_ids: claimIds }),
  });
}

/** 当前可用于生成的事实基线（已确认事实 + 必须避开的未确认说法）。 */
export function getClaimBaseline(): Promise<ClaimDigest> {
  return request("/claims/baseline");
}

/** 按一段资料草拟条目；只返回草稿，不落库。 */
export function draftClaims(payload: ClaimDraftPayload): Promise<ClaimDraft> {
  return request("/claims/draft", { method: "POST", body: JSON.stringify(payload) });
}
