// SPDX-License-Identifier: Apache-2.0
/**
 * W18 批注接口的**唯一适配层**（契约 wave3 §4.5）。
 *
 * 面板只依赖 `ReviewAnnotationApi` 接口：
 * - `createReviewAnnotationApi()` 走真实 HTTP（W18-BE 落地后即可用）；
 * - `createMockReviewAnnotationApi()` 是测试/联调前的有状态假实现，行为按契约九步导入
 *   的**可见部分**实现（格式解析、按 external_id 去重、包快照不一致标 stale、锚点不存在
 *   标 stale），状态迁移与真实接口同形。
 *
 * 为什么 HTTP 适配放在 feature 目录：task-30 的写入范围是 `features/resume-review/**`
 * + `components/resume/review/**` + i18n；`api/` 不在授权范围内。等 W18-BE 就绪后由
 * lead/接口负责人决定是否平移为 `api/reviewAnnotations.ts`（本文件可保持 re-export）。
 */
import type { ResumeContent } from "../../types/resume";
import { t } from "../../i18n";
import { getFilenameFromDisposition, request, requestRaw } from "../../api/client";
import { resolveAnnotationAnchor } from "./anchors";
import { parseReviewPack } from "./pack";
import type { ReviewAnnotationRecord, ReviewImportResult, ReviewTarget } from "./types";

export interface ReviewAnnotationApi {
  list(sharePackageId: number): Promise<ReviewAnnotationRecord[]>;
  /** `content` 是回传文件原文（`annotations.json` 文本）。 */
  importAnnotations(sharePackageId: number, content: string): Promise<ReviewImportResult>;
  resolve(annotationId: number): Promise<ReviewAnnotationRecord>;
  reopen(annotationId: number): Promise<ReviewAnnotationRecord>;
  dismiss(annotationId: number): Promise<ReviewAnnotationRecord>;
  /** stale 批注重挂到用户显式选择的当前对象（绝不自动/按下标）。 */
  reattach(annotationId: number, target: ReviewTarget): Promise<ReviewAnnotationRecord>;
  /** 下载评审包 zip（HTML/PDF + annotations.json 模板 + 说明）。 */
  downloadReviewPackage(sharePackageId: number): Promise<{ blob: Blob; filename: string }>;
}

export function createReviewAnnotationApi(): ReviewAnnotationApi {
  return {
    async list(sharePackageId) {
      const data = await request<{ items: ReviewAnnotationRecord[] }>(
        `/share-packages/${sharePackageId}/annotations`,
      );
      return data.items ?? [];
    },
    async importAnnotations(sharePackageId, content) {
      return request<ReviewImportResult>(`/share-packages/${sharePackageId}/annotations/import`, {
        method: "POST",
        body: JSON.stringify({ content }),
        // 回传文件可能较大：走 upload 预算（同一次本机请求，不需要导出级 10 分钟）。
        budget: "upload",
      });
    },
    async resolve(annotationId) {
      return request<ReviewAnnotationRecord>(`/resume-annotations/${annotationId}/resolve`, {
        method: "POST",
      });
    },
    async reopen(annotationId) {
      return request<ReviewAnnotationRecord>(`/resume-annotations/${annotationId}/reopen`, {
        method: "POST",
      });
    },
    async dismiss(annotationId) {
      return request<ReviewAnnotationRecord>(`/resume-annotations/${annotationId}/dismiss`, {
        method: "POST",
      });
    },
    async reattach(annotationId, target) {
      return request<ReviewAnnotationRecord>(`/resume-annotations/${annotationId}/reattach`, {
        method: "POST",
        body: JSON.stringify({ object_id: target.object_id, point_id: target.point_id ?? null }),
      });
    },
    async downloadReviewPackage(sharePackageId) {
      const resp = await requestRaw(`/share-packages/${sharePackageId}/review-package`, {
        budget: "export",
      });
      return {
        blob: await resp.blob(),
        filename:
          getFilenameFromDisposition(resp.headers.get("Content-Disposition")) ??
          "review-package.zip",
      };
    },
  };
}

// ── mock（UI 测试与联调前挂载用）──────────────────────────────────

export interface MockReviewApiOptions {
  shareToken?: string;
  /** 当前包快照指纹；导入包里不一致 → 整批 stale（契约第 5 步）。 */
  packageSnapshotSha?: string;
  /** 当前内容：用于把"对象/路径都不存在"的批注标 stale（契约第 7 步）。 */
  content?: ResumeContent | null;
  initial?: ReviewAnnotationRecord[];
}

export interface MockReviewAnnotationApi extends ReviewAnnotationApi {
  /** 当前全部记录（测试断言用）。 */
  records(): ReviewAnnotationRecord[];
  /** 调用记录：`list` / `import` / `resolve:<id>` …（测试断言用）。 */
  calls: string[];
}

function nextId(records: ReviewAnnotationRecord[]): number {
  return records.reduce((max, record) => Math.max(max, record.id), 0) + 1;
}

/**
 * 有状态假实现：与真实接口同形，行为按契约可见部分实现。
 * 注意它**不**校验 share_token 与包是否一致（真实接口会 403）；测试需要错误路径时
 * 直接让方法 reject 即可。
 */
export function createMockReviewAnnotationApi(
  options: MockReviewApiOptions = {},
): MockReviewAnnotationApi {
  let records = (options.initial ?? []).map((record) => ({ ...record }));
  const calls: string[] = [];
  const snapshotSha = options.packageSnapshotSha ?? "a".repeat(64);

  const transition = (
    id: number,
    mutate: (record: ReviewAnnotationRecord) => ReviewAnnotationRecord,
  ) => {
    const index = records.findIndex((record) => record.id === id);
    // mock 自身的错误文案也走 t()：它会经 UI 的 Toast 展示，不属于内部日志。
    if (index < 0) return Promise.reject(new Error(t("review.toast.statusFailed")));
    records = records.slice();
    records[index] = mutate(records[index]);
    return Promise.resolve(records[index]);
  };

  return {
    calls,
    records: () => records.map((record) => ({ ...record })),
    async list() {
      calls.push("list");
      return records.map((record) => ({ ...record }));
    },
    async importAnnotations(sharePackageId, content) {
      calls.push("import");
      const parsed = parseReviewPack(content);
      if (!parsed.ok) {
        const first = parsed.issues[0];
        throw new Error(`${t("review.import.failed")} (${first.code})`);
      }
      const packIsStale = parsed.pack.package_snapshot_sha256 !== snapshotSha;
      const seen = new Set(records.map((record) => record.external_id));
      let imported = 0;
      let duplicates = 0;
      let stale = 0;
      for (const annotation of parsed.pack.annotations) {
        if (seen.has(annotation.external_id)) {
          duplicates += 1;
          continue;
        }
        seen.add(annotation.external_id);
        const resolution = options.content
          ? resolveAnnotationAnchor(options.content, annotation)
          : { path: "" };
        const isStale = packIsStale || !resolution.path;
        if (isStale) stale += 1;
        imported += 1;
        records = [
          ...records,
          {
            id: nextId(records),
            share_package_id: sharePackageId,
            resume_id: null,
            document_version_id: parsed.pack.document_version_id ?? null,
            snapshot_sha256: parsed.pack.package_snapshot_sha256,
            external_id: annotation.external_id,
            object_id: annotation.object_id ?? null,
            point_id: annotation.point_id ?? null,
            path: annotation.path ?? null,
            field: annotation.field ?? null,
            quoted_text: annotation.quoted_text ?? "",
            text: annotation.text,
            reviewer: parsed.pack.reviewer ?? "",
            status: isStale ? "stale" : "open",
            resolved_at: null,
            created_at:
              annotation.created_at ?? parsed.pack.created_at ?? new Date(0).toISOString(),
          },
        ];
      }
      return {
        imported,
        duplicates,
        stale,
        dismissed_existing: 0,
        annotations: records.map((record) => ({ ...record })),
      };
    },
    async resolve(id) {
      calls.push(`resolve:${id}`);
      return transition(id, (record) => ({
        ...record,
        status: "resolved",
        resolved_at: "2026-10-24T00:00:00Z",
      }));
    },
    async reopen(id) {
      calls.push(`reopen:${id}`);
      return transition(id, (record) => ({ ...record, status: "open", resolved_at: null }));
    },
    async dismiss(id) {
      calls.push(`dismiss:${id}`);
      return transition(id, (record) => ({ ...record, status: "dismissed" }));
    },
    async reattach(id, target) {
      calls.push(`reattach:${id}`);
      return transition(id, (record) => ({
        ...record,
        object_id: target.object_id,
        point_id: target.point_id ?? null,
        status: "open",
        resolved_at: null,
      }));
    },
    async downloadReviewPackage() {
      calls.push("download");
      return {
        blob: new Blob(["PK-mock"], { type: "application/zip" }),
        filename: "review-package.zip",
      };
    },
  };
}
