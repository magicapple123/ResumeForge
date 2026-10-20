// SPDX-License-Identifier: Apache-2.0
/**
 * 附件预览接口（项 7 / D14）：PDF 的前 N 页由**服务端**渲染成 JPEG。
 *
 * 为什么不在前端打开：Chrome/Edge 早已禁止顶层导航到 `data:`，Electron 没有内置 PDF
 * 查看器——`window.open(dataUrl)` 必然失败（老的"点预览打不开"就是这么来的）。服务端
 * 复用 `pypdfium2`（扫描页识别在用）渲染首页，零新增依赖。
 */
import { request } from "./client";

export interface PdfPreviewPage {
  /** **1 起始**的真实页码（与 PDF 阅读器一致）。 */
  page: number;
  /** `data:image/jpeg;base64,...`，可直接作为 `<img src>`。 */
  image: string;
}

export interface PdfPreviewResult {
  pages: PdfPreviewPage[];
}

/**
 * 请求 PDF 前几页的位图。
 *
 * `pages` 默认 1（服务端上限 3）：预览要回答的是"我传的是这份文件吗"，首页足够——
 * 整份 30 页渲染会吃掉几十秒 CPU 与几十 MB 内存（D15）。
 */
export function previewPdf(payload: {
  name: string;
  mime_type: string;
  data: string;
  pages?: number;
}): Promise<PdfPreviewResult> {
  return request("/attachments/pdf-preview", {
    method: "POST",
    body: JSON.stringify({ pages: 1, ...payload }),
    // 服务端要真的渲染一页位图（PIL 编码 + 150 DPI），慢机器上远超默认 15s 的一半，
    // 用上传预算（600s）兜底，避免"慢机器上预览必超时"。
    budget: "upload",
  });
}
