/** 内推管理接口。 */
import type { Page, Referral, ReferralImageUpload, ReferralPayload, ReferralStats } from "../types";
import { buildQuery, request, uploadWithProgress } from "./client";

export function listReferrals(
  params: { status?: string; keyword?: string; limit?: number } = {},
): Promise<Referral[]> {
  return request(`/referrals${buildQuery(params)}`);
}

/** 分页列出内推（每页默认 10 条），与旧全量端点同源过滤口径。 */
export function listReferralsPage(
  params: { status?: string; keyword?: string } = {},
  page = 1,
  pageSize = 10,
): Promise<Page<Referral>> {
  return request(`/referrals/page${buildQuery({ ...params, page, page_size: pageSize })}`);
}

export function getReferralStats(): Promise<ReferralStats> {
  return request("/referrals/stats");
}

export function createReferral(payload: ReferralPayload): Promise<Referral> {
  return request("/referrals", { method: "POST", body: JSON.stringify(payload) });
}

export function updateReferral(id: number, payload: Partial<ReferralPayload>): Promise<Referral> {
  return request(`/referrals/${id}`, { method: "PATCH", body: JSON.stringify(payload) });
}

export function deleteReferral(id: number): Promise<void> {
  return request(`/referrals/${id}`, { method: "DELETE" });
}

/** 批量移入回收站（软删除）：与简历批量删除同一口径，后端缺失任一 id 即整体 404。 */
export function batchDeleteReferrals(referralIds: number[]): Promise<{ deleted: number }> {
  return request("/referrals/batch-delete", {
    method: "POST",
    body: JSON.stringify({ referral_ids: referralIds }),
  });
}

/**
 * 上传一张内推备注图片（multipart），返回相对路径。
 *
 * fetch 版拿不到上传字节进度，这里改走 XHR 进度上传：onProgress 报 0-100，
 * 供面板在上传按钮旁画进度条。仍走 upload 预算（10 分钟）。
 */
export function uploadReferralImage(
  file: File,
  onProgress?: (percent: number) => void,
): Promise<ReferralImageUpload> {
  const formData = new FormData();
  formData.append("file", file);
  // uploadWithProgress 对 FormData 不预设 Content-Type（multipart boundary 由浏览器生成）。
  return uploadWithProgress("/referrals/upload-image", formData, { onProgress });
}
