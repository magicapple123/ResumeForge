// SPDX-License-Identifier: Apache-2.0
/**
 * W10 试模板的**取数层**：把"某一侧模板要预览什么、量什么"收成纯函数 + 两个薄调用。
 *
 * ## 为什么不用新端点
 *
 * 现有两个 API 已经表达了需要的一切：
 * - `POST /api/resume-templates/preview`（`previewResumeTemplate`）：返回 HTML，
 *   支持 `resume_id` 与 `content`（后端 schema 有，前端旧类型还没声明）——示例/当前内容切换；
 * - `POST /api/resumes/{id}/preview-pdf`（`fetchResumePreviewPdf`）：**真 PDF 排版**并回
 *   `X-Resume-Pages(-Needed)/-Overflow` 响应头——"实际页数 / 溢出"的唯一真实来源。
 *
 * 所以这里只拼请求体、不复制渲染：契约要求"不做模拟分页"，页数一律来自后端真实排版。
 *
 * ## 示例内容不测页数
 *
 * 示例内容的页数**不是用户内容的页数**，拿它说"这个模板放得下"正是 W10 要防的误导。
 * 因此测量只在"我的内容 + 有简历 id"时发生；示例模式界面如实显示"示例内容不测页数"。
 */
import { fetchResumePreviewPdf, previewResumeTemplate } from "../../api/resumes";
import type { ResumeContent, ResumeFontScale, ResumeFormatConfig } from "../../types";
import type { TrialMeasurement, TrialSideRequest } from "./types";

/** `previewResumeTemplate` 的请求体（后端 `TemplatePreviewRequest` 的字段镜像）。 */
export interface TemplatePreviewPayload {
  template_name: string;
  format_name: string;
  format_config: ResumeFormatConfig;
  page_limit: number;
  font_scale: ResumeFontScale;
  resume_id?: number;
  content?: ResumeContent;
}

/** 采纳时的最终排版覆盖：保留 = 原样；采用模板默认 = 清空覆盖与具名版式。 */
export function adoptFormatConfig(layout: {
  format_config?: ResumeFormatConfig;
}): ResumeFormatConfig {
  return { ...(layout.format_config ?? {}) };
}

/**
 * 拼预览请求：模板固定，预览内容按模式给（示例 = 什么都不传）。
 *
 * 覆盖策略同时作用于 `format_name` 与 `format_config`：用户选"采用模板默认"时，
 * 预览必须真的按模板默认排——否则"看到的"和"采纳后得到的"是两回事。
 */
export function templatePreviewPayload(input: TrialSideRequest): TemplatePreviewPayload {
  const { context, template, useOverrides } = input;
  const payload: TemplatePreviewPayload = {
    template_name: template,
    format_name: useOverrides ? context.layout.format_name : "",
    format_config: useOverrides ? { ...(context.layout.format_config ?? {}) } : {},
    page_limit: Number(context.layout.page_limit) || 1,
    font_scale: context.layout.font_scale,
  };
  if (context.mode === "current") {
    if (context.content) payload.content = context.content;
    else if (context.resumeId) payload.resume_id = context.resumeId;
  }
  return payload;
}

/** 取一侧的预览 HTML。取消/关闭由调用方通过 `signal` 掐掉在飞的请求。 */
export async function fetchTrialPreview(
  input: TrialSideRequest,
  signal?: AbortSignal,
): Promise<string> {
  return previewResumeTemplate({ ...templatePreviewPayload(input), signal });
}

/**
 * 拼测量请求：只有"我的内容 + 有简历 id"才有真实测量，其余返回 `null`。
 *
 * 测量同样遵守覆盖策略：用户选"采用模板默认"时，测的是模板默认参数下的页数。
 */
export function measureOptions(
  input: TrialSideRequest,
): { resumeId: number; options: Record<string, unknown> } | null {
  const { context, template, useOverrides } = input;
  if (context.mode !== "current" || !context.resumeId) return null;
  return {
    resumeId: context.resumeId,
    options: {
      template,
      format_name: useOverrides ? context.layout.format_name : "",
      page_limit: Number(context.layout.page_limit) || 1,
      font_scale: context.layout.font_scale,
      format_config: useOverrides ? { ...(context.layout.format_config ?? {}) } : {},
      ...(context.content ? { content: context.content } : {}),
    },
  };
}

/** 真实排版测量（响应头读页数；PDF 字节不参与 UI，只作为"真的排过一遍"的凭据）。 */
export async function measureTrial(
  input: TrialSideRequest,
  signal?: AbortSignal,
): Promise<TrialMeasurement | null> {
  const request = measureOptions(input);
  if (!request) return null;
  const result = await fetchResumePreviewPdf(
    request.resumeId,
    request.options as Parameters<typeof fetchResumePreviewPdf>[1],
    signal,
  );
  return {
    pages: result.pages,
    pagesNeeded: result.pagesNeeded,
    pageLimit: result.pageLimit,
    overflow: result.overflow,
  };
}
