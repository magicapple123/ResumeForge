// SPDX-License-Identifier: Apache-2.0
/** 多格式导出与脱敏的类型（R-16 / R-17）。枚举字符串与后端逐字一致。 */
import type { ResumeFontScale, ResumeLanguage } from "./resume";
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
  mask_github: boolean;
  mask_website: boolean;
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
   * 「保存」时，导出也必须按 7px 排——否则就会出现"预览一页、导出两页"。
   */
  format_config?: ResumeFormatConfig;
  /**
   * 本次导出的**草稿语言**（纸面固定文案：小节标题 / 字段前缀）。
   *
   * 与 `format_config` 同属"预览的草稿就是导出的版式"：预览里把语言切成 English、
   * 还没点「保存」时，导出也必须印英文标题。`null` / 不传 = 后端用记录里的语言。
   */
  language?: ResumeLanguage | null;
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

/**
 * 前端本地生成的补充格式：图片（PNG）。
 *
 * **故意不进 `ExportFormat`**：后端 `ExportFormat` 枚举里没有 png（也不该有——ATS 能解析的是
 * PDF，服务端只保留一份排版产物）。选中它时请求仍然发 `format: "pdf"`，再在前端把同一份字节
 * 光栅化成图片（见 `utils/pdfToPng.ts`）。
 */
export type LocalExportFormat = "png";

/** 导出面板里可勾选的格式 = 后端格式 ∪ 前端本地格式。 */
export type ExportUiFormat = ExportFormat | LocalExportFormat;

/** 可选的导出格式（顺序即「导出选项」里的展示顺序）。 */
export const EXPORT_FORMATS: { value: ExportFormat; label: string }[] = [
  { value: "pdf", label: "PDF" },
  { value: "docx", label: "Word" },
  { value: "html", label: "HTML" },
  { value: "md", label: "Markdown" },
  { value: "txt", label: "纯文本" },
  { value: "json", label: "JSON" },
];

/** 导出面板的完整格式清单 = 六种后端格式 + 前端转出的图片（不重复抄一遍标签）。 */
export const EXPORT_FORMAT_OPTIONS: { value: ExportUiFormat; label: string }[] = [
  ...EXPORT_FORMATS,
  { value: "png", label: "图片（PNG）" },
];

/** 图片格式的定位说明：一句话讲清"什么时候用图片、什么时候必须用 PDF"。 */
export const PNG_FORMAT_NOTE = "图片用于必须上传图片的投递平台；需要机器筛选（ATS）时请用 PDF。";

/** 脱敏范围的可配置项（与后端字段一一对应，label 用于勾选界面）。 */
export const REDACTION_FIELDS: { key: keyof RedactionOptions; label: string }[] = [
  { key: "mask_name", label: "姓名" },
  { key: "mask_phone", label: "手机" },
  { key: "mask_email", label: "邮箱" },
  { key: "mask_github", label: "GitHub" },
  { key: "mask_website", label: "个人主页" },
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
  mask_github: true,
  mask_website: true,
};
