// SPDX-License-Identifier: Apache-2.0
/**
 * W08 分页报告与**溢出定位**的数据层（wave2 契约 §3.6）。
 *
 * ## 唯一口径：后端真 PDF 排版
 *
 * 分页报告来自 `POST /api/resumes/{id}/pagination/report`，内部就是"再排一遍 PDF 并读
 * 渲染日志"（W08-BE）。前端不数页、不模拟分页：草稿的 CSS 多列与 PDF 断点规则不同，
 * 数出来的页数一定与导出不一致。
 *
 * ## 前端只做三件事
 *
 * 1. 容错解析响应（旧后端/缺字段不崩）；
 * 2. 把"被截断的第一条内容"换成宿主可执行的定位目标（objectId / section / page）；
 * 3. 组装请求体（复用预览/导出的版式字段，content 支持未保存草稿，不落库）。
 */
import { request } from "../../api/client";
import type { ResumeContent, ResumeFontScale } from "../../types";
import type { ResumeFormatConfig } from "../../types/resumeFormat";

/** 报告请求体：与 `PreviewPdfRequest` 的版式字段同形（不新建第二套形状）。 */
export interface PaginationReportRequest {
  template?: string;
  format_name?: string;
  page_limit?: number;
  font_scale?: ResumeFontScale | string;
  language?: string;
  format_config?: ResumeFormatConfig | Record<string, unknown>;
  /** 未保存正文；不传 = 用记录里已保存的那一版（不落库，与 W04 同边界）。 */
  content?: ResumeContent;
}

export type TruncationKind = "section" | "entry" | "point" | "meta";

export interface TruncatedAt {
  kind: TruncationKind;
  section: string | null;
  objectId: string | null;
  pointIndex: number | null;
  textPreview: string;
}

export interface ManualBreak {
  kind: TruncationKind;
  section: string | null;
  objectId: string | null;
  page: number | null;
}

export interface PaginationWarning {
  code: string;
  detail: string;
}

export interface PaginationReport {
  pages: number | null;
  pagesNeeded: number | null;
  pageLimit: number | null;
  overflow: boolean;
  /**
   * 末页占用（0–1 比例）。后端分页报告目前**不返回**这个字段；解析层容忍它缺席
   * （旧后端/未升级时为 null），缩略图据此显示"未测量"而不是编一个百分比。
   */
  lastPageFill: number | null;
  truncatedAt: TruncatedAt | null;
  manualBreaks: ManualBreak[];
  warnings: PaginationWarning[];
  /** 同一快照的两个指纹：宿主据此丢弃过时响应（W11 同一机制）。 */
  contentSha256: string;
  renderConfigSha256: string;
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function intOrNull(value: unknown): number | null {
  return typeof value === "number" && Number.isFinite(value) ? Math.trunc(value) : null;
}

/** 0–1 的占用比例；越界/非数字一律 null（不猜、不夹成一个假值）。 */
function ratioOrNull(value: unknown): number | null {
  if (typeof value !== "number" || !Number.isFinite(value)) return null;
  if (value < 0 || value > 1) return null;
  return value;
}

const KINDS: readonly TruncationKind[] = ["section", "entry", "point", "meta"];

function readKind(value: unknown): TruncationKind {
  return KINDS.includes(value as TruncationKind) ? (value as TruncationKind) : "entry";
}

function readTruncatedAt(raw: unknown): TruncatedAt | null {
  if (!isRecord(raw)) return null;
  return {
    kind: readKind(raw["kind"]),
    section: typeof raw["section"] === "string" ? raw["section"] : null,
    objectId: typeof raw["object_id"] === "string" ? raw["object_id"] : null,
    pointIndex: intOrNull(raw["point_index"]),
    textPreview: typeof raw["text_preview"] === "string" ? raw["text_preview"] : "",
  };
}

function readManualBreaks(raw: unknown): ManualBreak[] {
  if (!Array.isArray(raw)) return [];
  return raw.filter(isRecord).map((item) => ({
    kind: readKind(item["kind"]),
    section: typeof item["section"] === "string" ? item["section"] : null,
    objectId: typeof item["object_id"] === "string" ? item["object_id"] : null,
    page: intOrNull(item["page"]),
  }));
}

function readWarnings(raw: unknown): PaginationWarning[] {
  if (!Array.isArray(raw)) return [];
  return raw
    .filter(isRecord)
    .map((item) => ({
      code: typeof item["code"] === "string" ? item["code"] : "",
      detail: typeof item["detail"] === "string" ? item["detail"] : "",
    }))
    .filter((item) => item.code !== "" || item.detail !== "");
}

/** 容错解析：形状不对 → `null`（界面显示"还没有分页报告"，不猜）。 */
export function parsePaginationReport(raw: unknown): PaginationReport | null {
  if (!isRecord(raw)) return null;
  const snapshot = isRecord(raw["snapshot"]) ? raw["snapshot"] : {};
  return {
    pages: intOrNull(raw["pages"]),
    pagesNeeded: intOrNull(raw["pages_needed"]),
    pageLimit: intOrNull(raw["page_limit"]),
    overflow: raw["overflow"] === true,
    lastPageFill: ratioOrNull(raw["last_page_fill"]),
    truncatedAt: readTruncatedAt(raw["truncated_at"]),
    manualBreaks: readManualBreaks(raw["manual_breaks"]),
    warnings: readWarnings(raw["warnings"]),
    contentSha256: typeof snapshot["content_sha256"] === "string" ? snapshot["content_sha256"] : "",
    renderConfigSha256:
      typeof snapshot["render_config_sha256"] === "string" ? snapshot["render_config_sha256"] : "",
  };
}

/** 宿主定位目标：滚到画布 + 高亮（复用既有 pickTarget/选中机制，不新造高亮）。 */
export interface LocateTarget {
  objectId?: string;
  section?: string;
  pointIndex?: number;
  page?: number;
}

/** 被截断的第一条内容的定位目标；没有可定位信息返回 `null`（按钮置灰）。 */
export function truncationLocateTarget(report: PaginationReport | null): LocateTarget | null {
  const truncated = report?.truncatedAt;
  if (!truncated) return null;
  if (truncated.objectId) {
    return {
      objectId: truncated.objectId,
      ...(truncated.section ? { section: truncated.section } : {}),
      ...(truncated.pointIndex !== null ? { pointIndex: truncated.pointIndex } : {}),
    };
  }
  if (truncated.section) return { section: truncated.section };
  return null;
}

/** 手动断页的定位目标（按页号翻页；页导航归 W15 的 PageNavigator）。 */
export function manualBreakLocateTarget(item: ManualBreak): LocateTarget | null {
  const target: LocateTarget = {};
  if (item.objectId) target.objectId = item.objectId;
  if (item.section) target.section = item.section;
  if (item.page !== null) target.page = item.page;
  return Object.keys(target).length > 0 ? target : null;
}

/** 取报告（同步渲染，预算与精确预览一致用 `export`；不落库、不冻结交付）。 */
export async function fetchPaginationReport(
  resumeId: number,
  payload: PaginationReportRequest,
  signal?: AbortSignal,
): Promise<PaginationReport> {
  const raw = await request<unknown>(`/resumes/${resumeId}/pagination/report`, {
    method: "POST",
    body: JSON.stringify(payload),
    signal,
    budget: "export",
  });
  const report = parsePaginationReport(raw);
  if (!report) throw new Error("pagination report unavailable");
  return report;
}
