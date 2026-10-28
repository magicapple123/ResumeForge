// SPDX-License-Identifier: Apache-2.0
/**
 * 简历模板工作台接口：自制模板与版式的增删改查。
 *
 * ## 2026-11：自制模板的 UI 入口已下线，但这里**一个导出都不删**
 *
 * 界面撤掉的是"写 HTML/CSS 的模板"这一路（`fetchBuiltinTemplateSource`、`createResumeTemplate`
 * 的 style 分支等现在没有调用点）。函数留着有两个理由：
 *
 * 1. 未引用的文件仍会被 `tsc` 检查，删导出只会换来编译失败或连带删掉一片类型；
 * 2. **旧简历仍在用**这些数据：已有自制模板必须继续按原样渲染、继续能读列表，
 *    只是不再能新建。
 *
 * 真要彻底删，应该是一次单独的后端 + 迁移动作（先给存量模板找归宿），不在"下线 UI"这一批里做。
 */
import type {
  ResumeTemplateDetail,
  ResumeTemplatePayload,
  TemplateRecognitionDraft,
} from "../types";
import { request } from "./client";

export function listResumeTemplates(kind?: "style" | "format"): Promise<ResumeTemplateDetail[]> {
  return request(`/resume-templates${kind ? `?kind=${kind}` : ""}`);
}

/** 读取内置模板源码，用于「从内置模板复制一份」开始自制。 */
export function fetchBuiltinTemplateSource(
  name: string,
): Promise<{ name: string; label: string; html: string; config?: Record<string, unknown> }> {
  return request(`/resume-templates/builtin-source?name=${encodeURIComponent(name)}`);
}

export function fetchResumeTemplate(id: number): Promise<ResumeTemplateDetail> {
  return request(`/resume-templates/${id}`);
}

export function createResumeTemplate(
  payload: ResumeTemplatePayload & { name: string },
): Promise<ResumeTemplateDetail> {
  return request("/resume-templates", { method: "POST", body: JSON.stringify(payload) });
}

export function updateResumeTemplate(
  id: number,
  payload: Partial<ResumeTemplatePayload>,
): Promise<ResumeTemplateDetail> {
  return request(`/resume-templates/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteResumeTemplate(id: number): Promise<void> {
  return request(`/resume-templates/${id}`, { method: "DELETE" });
}

/**
 * 导入「目标模板」（图片 / PDF / DOCX）：由模型读出它的版式参数，落成一份版式。
 *
 * 走 multipart 而不是 base64 JSON：一份简历 PDF 几 MB，base64 后还要再涨三分之一，
 * 而这条路径本来就不需要 JSON 结构。
 */
export async function importTemplateFromFile(
  file: File,
  name = "",
  signal?: AbortSignal,
): Promise<ResumeTemplateDetail> {
  const formData = new FormData();
  formData.append("file", file);
  if (name.trim()) formData.append("name", name.trim());
  // request() 对 FormData 不预设 Content-Type；简历文件可能几 MB，走 upload 预算。
  return request("/resume-templates/import-from-file", {
    method: "POST",
    body: formData,
    budget: "upload",
    signal,
  });
}

/** 分析多份参考图片/文档，只返回可编辑草稿，不落库。 */
export async function analyzeTemplateFromFiles(
  files: File[],
  name = "",
  signal?: AbortSignal,
): Promise<TemplateRecognitionDraft> {
  const formData = new FormData();
  files.forEach((file) => formData.append("files", file));
  if (name.trim()) formData.append("name", name.trim());
  return request("/resume-templates/analyze-from-files", {
    method: "POST",
    body: formData,
    budget: "upload",
    signal,
  });
}
