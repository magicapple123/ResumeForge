// SPDX-License-Identifier: Apache-2.0
/**
 * 简历模板工作台接口：自制模板与版式的增删改查。
 *
 * ## 2026-11：自制模板的 UI 入口已下线，读取路径保留
 *
 * 界面撤掉的是"写 HTML/CSS 的模板"这一路。**旧简历仍在用**这些数据：已有自制模板
 * 必须继续按原样渲染、继续能读列表，只是不再能新建——因此列表与增删改查的导出保留。
 * 随 UI 一起失去调用点的四个导入/识别函数（`fetchBuiltinTemplateSource`、
 * `fetchResumeTemplate`、`importTemplateFromFile`、`analyzeTemplateFromFiles`）已在
 * 2026-11-07 的零引用导出清理中删除；后端对应端点另行下线（本轮不动后端）。
 */
import type { ResumeTemplateDetail, ResumeTemplatePayload } from "../types";
import { request } from "./client";

export function listResumeTemplates(kind?: "style" | "format"): Promise<ResumeTemplateDetail[]> {
  return request(`/resume-templates${kind ? `?kind=${kind}` : ""}`);
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
