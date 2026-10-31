// SPDX-License-Identifier: Apache-2.0
/**
 * W04-config：**导出配置预览**（水印 / 脱敏后）的唯一请求适配。
 *
 * 与"编辑预览"（`POST /resumes/{id}/preview-pdf` 不带后处理）的区别只在请求体：
 * 这里额外带 `watermark` / `redact` / `redact_options`，让用户在下成套导出之前先看到
 * 对外发送的实际样子。产物不落库、不冻结交付（与精确预览同一条管线）。
 *
 * 为什么单独成文件：导出弹层已经接近 300 行预算；HTTP/头解析只放在这一层，
 * 组件只负责"按钮 → loading → iframe"。
 */
import type { ResumeDocument } from "../../types/resumeDocument";
import { ApiError } from "../../api/apiError";
import { requestRaw } from "../../api/client";
import { DEFAULT_REDACTION_OPTIONS, type RedactionOptions } from "../../types/export";

/** 配置预览请求（字段与导出按钮同源：同一份草稿/版式 + 配置里的后处理）。 */
export interface ConfigPreviewInput {
  resumeId: number;
  template?: string;
  formatName?: string;
  pageLimit?: number;
  fontScale?: string;
  language?: string;
  formatConfig?: Record<string, unknown>;
  includePhoto?: boolean;
  content?: ResumeDocument | null;
  watermark?: string;
  redact?: boolean;
  redactOptions?: RedactionOptions;
  /** W16 岗位变体：服务端按变体导出输入排版。 */
  variantId?: number | null;
}

export interface ConfigPreviewResult {
  blob: Blob;
  pages: number | null;
  pagesNeeded: number | null;
  pageLimit: number | null;
  overflow: boolean;
}

/** 后端还不支持"带后处理的预览"（extra="forbid" 422 等）——UI 按能力缺失提示，不报成坏产物。 */
export class ConfigPreviewUnsupportedError extends Error {
  constructor() {
    super("config preview is not supported by this backend");
    this.name = "ConfigPreviewUnsupportedError";
  }
}

const UNSUPPORTED_STATUSES = new Set([400, 404, 422]);

export function buildConfigPreviewBody(input: ConfigPreviewInput): Record<string, unknown> {
  return {
    // 版式：与导出面板同一组草稿值（缺省 = 用记录值）。
    ...(input.template ? { template: input.template } : {}),
    ...(input.formatName ? { format_name: input.formatName } : {}),
    ...(input.pageLimit !== undefined ? { page_limit: input.pageLimit } : {}),
    ...(input.fontScale ? { font_scale: input.fontScale } : {}),
    ...(input.language ? { language: input.language } : {}),
    ...(input.formatConfig ? { format_config: input.formatConfig } : {}),
    ...(input.includePhoto !== undefined ? { include_photo: input.includePhoto } : {}),
    ...(input.content ? { content: input.content } : {}),
    // 后处理：正是"配置预览"比编辑预览多出来的部分。
    ...(input.watermark ? { watermark: input.watermark } : {}),
    ...(input.redact ? { redact: true } : {}),
    redact_options: input.redactOptions ?? DEFAULT_REDACTION_OPTIONS,
    ...(input.variantId != null ? { variant_id: input.variantId } : {}),
  };
}

function readCount(value: string | null): number | null {
  const parsed = Number.parseInt(value ?? "", 10);
  return Number.isFinite(parsed) && parsed > 0 ? parsed : null;
}

export async function previewExportConfig(
  input: ConfigPreviewInput,
  signal?: AbortSignal,
): Promise<ConfigPreviewResult> {
  let resp: Response;
  try {
    resp = await requestRaw(`/resumes/${input.resumeId}/preview-pdf`, {
      method: "POST",
      budget: "export",
      signal,
      headers: { "Content-Type": "application/json" },
      body: JSON.stringify(buildConfigPreviewBody(input)),
    });
  } catch (error) {
    if (
      error instanceof ApiError &&
      typeof error.status === "number" &&
      UNSUPPORTED_STATUSES.has(error.status)
    ) {
      throw new ConfigPreviewUnsupportedError();
    }
    throw error;
  }
  return {
    blob: await resp.blob(),
    pages: readCount(resp.headers.get("X-Resume-Pages")),
    pagesNeeded: readCount(resp.headers.get("X-Resume-Pages-Needed")),
    pageLimit: readCount(resp.headers.get("X-Resume-Page-Limit")),
    overflow: resp.headers.get("X-Resume-Overflow") === "true",
  };
}
