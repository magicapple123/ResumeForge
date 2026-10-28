// SPDX-License-Identifier: Apache-2.0
/**
 * 简历中心「批量导出」：一次请求换回一个 zip。
 *
 * 参数（格式 / 字号 / 页数 / 语言 / 版式）不由调用方传：服务端读「设置 → 批量操作」里
 * 保存的那一套。未配置时服务端返回 409，前端在点击前也会先拦一次（避免白等）。
 */
import { getFilenameFromDisposition, requestRaw } from "./client";

export interface BatchExportResult {
  blob: Blob;
  filename: string;
  exported: number;
  skipped: number;
  /** 被跳过的简历与原因（已解码，可直接展示；空串表示全部成功）。 */
  skippedDetail: string;
}

function readCount(value: string | null): number {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed >= 0 ? parsed : 0;
}

export async function batchExportResumes(resumeIds: number[]): Promise<BatchExportResult> {
  const response = await requestRaw("/resumes/batch-export", {
    method: "POST",
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify({ resume_ids: resumeIds }),
    // 服务端逐份同步渲染，份数多时要几分钟：走导出预算，而不是默认 15s。
    budget: "export",
  });
  const skippedDetail = response.headers.get("X-Batch-Skipped-Detail") ?? "";
  return {
    blob: await response.blob(),
    filename:
      getFilenameFromDisposition(response.headers.get("Content-Disposition")) ??
      "resumes-export.zip",
    exported: readCount(response.headers.get("X-Batch-Exported")),
    skipped: readCount(response.headers.get("X-Batch-Skipped")),
    skippedDetail: skippedDetail ? decodeURIComponent(skippedDetail) : "",
  };
}
