/** 求职进度接口：增删改查、两步导入（解析预览 → 确认写入）与导出。 */
import type {
  Track,
  TrackApplyResult,
  TrackList,
  TrackParseResult,
  TrackPayload,
  TrackRecord,
} from "../types";
import type { Page } from "../types/common";
import { buildQuery, getFilenameFromDisposition, request, requestRaw } from "./client";

export function listTracks(params: { status?: string; keyword?: string } = {}): Promise<TrackList> {
  return request(`/tracker${buildQuery(params)}`);
}

/**
 * 分页列出求职进度（RF-08）：过滤与排序与旧列表完全一致，不受旧端点 500 条兜底上限约束。
 * **响应不含漏斗/统计字段**——统计（status_counts 等）仍走旧 `listTracks`（同一套筛选）。
 * `jobId`（RF-11）：岗位详情「该岗位的投递进度」深链带的过滤；缺省不过滤。
 */
export function listTracksPage(
  params: { status?: string; keyword?: string; jobId?: number } = {},
  page: number,
  pageSize: number,
): Promise<Page<Track>> {
  // jobId → 后端的蛇形 job_id；余下的 status/keyword 原样透传。
  const { jobId, ...rest } = params;
  return request(
    `/tracker/page${buildQuery({ ...rest, job_id: jobId, page, page_size: pageSize })}`,
  );
}

export function getTrack(id: number): Promise<Track> {
  return request(`/tracker/${id}`);
}

export function createTrack(payload: TrackPayload): Promise<Track> {
  return request("/tracker", { method: "POST", body: JSON.stringify(payload) });
}

export function updateTrack(id: number, payload: TrackPayload): Promise<Track> {
  return request(`/tracker/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteTrack(id: number): Promise<void> {
  return request(`/tracker/${id}`, { method: "DELETE" });
}

export interface TrackParsePayload {
  text: string;
  /** 前端本地读出的图片 data URL 列表（与岗位识别同一条链路）。 */
  images?: { name: string; mime_type: string; data: string }[];
  documents?: { name: string; mime_type: string; data: string }[];
}

/** 解析通知材料，**只返回预览，不写任何数据**。 */
export function parseTracks(payload: TrackParsePayload): Promise<TrackParseResult> {
  return request("/tracker/parse", { method: "POST", body: JSON.stringify(payload) });
}

/** 提交用户确认过的条目；与解析共用同一份合并规则。 */
export function applyTracks(
  items: TrackRecord[],
  source = "recognized",
): Promise<TrackApplyResult> {
  return request("/tracker/apply", {
    method: "POST",
    body: JSON.stringify({ items, source }),
  });
}

/** 导出当前筛选条件下的记录；返回 Blob 与文件名交给下载工具。 */
export async function exportTracks(
  format: "csv" | "json",
  params: { status?: string; keyword?: string } = {},
): Promise<{ blob: Blob; filename: string }> {
  const resp = await requestRaw(`/tracker/export${buildQuery({ ...params, format })}`, {
    // 导出响应是文件流；导出走 export 预算（10 分钟），不吃 15s 的默认超时。
    budget: "export",
  });
  const filename =
    getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ?? `求职进度.${format}`;
  return { blob: await resp.blob(), filename };
}
