// SPDX-License-Identifier: Apache-2.0
/**
 * 导出格式能力矩阵（W19 前端视图 / 契约 §6.7）。
 *
 * 判定口径来自 plan §P0-04 的能力表与 wave2 W05 契约：PDF 是权威版面；Word 允许近似
 * （字体/间距由查看器重排）；HTML/MD/TXT/JSON 是文本线性产物。界面必须**如实标注**
 * "近似"的原因，不能把差异藏起来，也不能把必做能力标成不支持。
 */
import type { ExportCapability, ExportFormat } from "./types";
import { EXPORT_FORMATS } from "./types";

export const EXPORT_CAPABILITIES: Record<ExportFormat, ExportCapability> = {
  pdf: { level: "full" },
  // Word 不承诺与 PDF 像素一致：字体替换、分页由 Word 自己重排（契约 §6.1 / plan §0.3）。
  docx: { level: "approx", reason: "layout" },
  html: { level: "full" },
  md: { level: "full" },
  txt: { level: "full" },
  json: { level: "full" },
};

/** 界面上可勾选的格式（不支持项不进清单；当前矩阵里没有 unavailable）。 */
export function availableExportFormats(): ExportFormat[] {
  return EXPORT_FORMATS.filter((format) => EXPORT_CAPABILITIES[format].level !== "unsupported");
}

/** 该格式是否需要在界面上标注"近似/不支持"的原因。 */
export function formatCapability(format: ExportFormat): ExportCapability {
  return EXPORT_CAPABILITIES[format];
}
