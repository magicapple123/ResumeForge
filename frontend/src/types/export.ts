// SPDX-License-Identifier: Apache-2.0
/** 多格式导出与脱敏的类型（R-16 / R-17）。枚举字符串与后端逐字一致。 */
import type { ResumeFontScale } from "./resume";
import type { ResumeFormatConfig } from "./resumeFormat";

/** 导出格式（与后端 ``ExportFormat`` 逐字一致）。 */
export type ExportFormat = "json" | "md" | "html" | "pdf" | "docx" | "txt";

/** 脱敏范围（与后端 ``RedactionOptions`` 逐字一致）。 */
export interface RedactionOptions {
  mask_name: boolean;
  mask_phone: boolean;
  mask_email: boolean;
  mask_company: boolean;
  mask_school: boolean;
  mask_project: boolean;
  mask_product: boolean;
}

/** 全参数导出请求体（与后端 ``ExportRequest`` 逐字一致）。 */
export interface ExportRequest {
  format: ExportFormat;
  watermark?: string;
  redact?: boolean;
  redact_options?: RedactionOptions;
  /**
   * 页边距（mm）；null 表示沿用记录里存的值。
   *
   * **后端仍接受这个字段**（PDF/Word 读它），但导出面板自 R1 起**不再发送**：页边距
   * 只有 `format_config.page_padding` 一个落点，预览与导出读同一个键。两套参数并存
   * 正是"改面板值预览不变、PDF 变"的来源。新调用方请用 `format_config.page_padding`。
   */
  margin_mm?: number | null;
  font_scale?: ResumeFontScale | null;
  page_limit?: number | null;
  /**
   * 本次导出的版式草稿（字号系数 / 行距 / 页边距 / 区块间距…）。
   *
   * 与预览 `POST /resumes/render` 用的是同一个对象：用户在预览里把字号拖到 7px 但没点
   * 「保存版式」时，导出也必须按 7px 排——否则就会出现"预览一页、导出两页"。
   */
  format_config?: ResumeFormatConfig;
  include_photo?: boolean;
  allow_incomplete?: boolean;
  /** 正式投递存档：为真时后端把这次导出冻结成一份投递快照；默认不落库。
   *  「导出并记录交付」一律走 POST（本类型），GET 的同名参数已 deprecated（ADR-0002）。 */
  record_delivery?: boolean;
}

/** 导出结果（对应一个 blob + 服务端建议文件名 + 页数元数据）。 */
export interface ExportResult {
  blob: Blob;
  filename: string;
  pages: number | null;
  pageLimit: number | null;
}

/** 可选的导出格式（顺序即「导出选项」里的展示顺序）。 */
export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word" },
  { value: "html", label: "HTML" },
  { value: "md", label: "Markdown" },
  { value: "txt", label: "纯文本" },
  { value: "json", label: "JSON" },
];

/** 脱敏范围的可配置项（与后端字段一一对应，label 用于勾选界面）。 */
export const REDACTION_FIELDS: { key: keyof RedactionOptions; label: string }[] = [
  { key: "mask_name", label: "姓名" },
  { key: "mask_phone", label: "手机" },
  { key: "mask_email", label: "邮箱" },
  { key: "mask_company", label: "公司" },
  { key: "mask_school", label: "学校" },
  { key: "mask_project", label: "项目" },
  { key: "mask_product", label: "产品名（正文）" },
];

/** 默认遮罩可直接识别身份的四项（与后端默认值一致）。 */
export const DEFAULT_REDACTION_OPTIONS: RedactionOptions = {
  mask_name: true,
  mask_phone: true,
  mask_email: true,
  mask_company: true,
  mask_school: false,
  mask_project: false,
  mask_product: false,
};
