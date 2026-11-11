// SPDX-License-Identifier: Apache-2.0
/**
 * 逐页位图的**请求出口**（唯一实现）。
 *
 * 单独成一个文件而不是塞进 `previewPages.ts`：那边是纯函数与类型（可以脱离 DOM 单测），
 * 这边要碰 `request()` 与错误文案。更实际的理由是**可测**——面板测试只 mock 这一个模块，
 * 不必连带把地址拼装、高度算式的真实实现一起 mock 掉。
 *
 * 走 `POST` 而不是 `GET`：这组参数（整份 `format_config` + 未保存正文）太大，塞进 URL
 * 会被代理截断；而且它本质上是"按这组参数排一版"，不是"取一个固定资源"。
 */
import { request } from "../../api/client";
import type { ResumeDocument } from "../../types/resumeDocument";
import type { PreviewPagesMeta } from "./previewPages";

/** 服务端返回的形状（snake_case 是后端约定，本模块负责折成前端的 camelCase）。 */
interface PreviewPagesPayload {
  token: string;
  page_count: number;
  pages: { index: number; width: number; height: number }[];
  pages_needed: number | null;
  overflow: boolean;
  page_limit: number | null;
  pdf_url: string;
}

export interface PreviewPagesOptions {
  /** 模板 / 版式：草稿值，换完没保存也要按新的排。 */
  template?: string;
  format_name?: string;
  page_limit?: number;
  font_scale?: string;
  /** 纸面文案的语言（`zh-CN` / `en-US`）；不传 = 后端回落到记录里的值。 */
  language?: string;
  format_config?: Record<string, unknown>;
  include_photo?: boolean;
  /** 还没保存的正文（W04）：预览与用户眼前的草稿必须是同一份。 */
  content?: ResumeDocument;
  /** 相框的 CSS 像素宽（服务端分桶后决定渲染分辨率）。 */
  width: number;
  /** 设备像素比（服务端分桶并夹在 1–3）。 */
  dpr: number;
}

/**
 * 按一组参数排一版，返回逐页位图的清单。
 *
 * @param id 简历 id。
 * @param options 与 `/preview-pdf` 完全相同的排版参数，外加宽高口径。
 * @param signal 取消信号：拖滑块时上一次请求要被作废（慢的那次回来更晚会盖掉新版式）。
 */
export async function fetchResumePreviewPages(
  id: number,
  options: PreviewPagesOptions,
  signal?: AbortSignal,
): Promise<PreviewPagesMeta> {
  const payload = await request<PreviewPagesPayload>(`/resumes/${id}/preview-pages`, {
    method: "POST",
    // 一版要跑服务端排版 + 光栅化（本机数百毫秒，冷启动更久），用导出档预算。
    budget: "export",
    signal,
    headers: { "Content-Type": "application/json" },
    body: JSON.stringify(options),
  });
  return {
    token: payload.token,
    pages: payload.pages,
    pagesNeeded: payload.pages_needed,
    overflow: payload.overflow,
  };
}
