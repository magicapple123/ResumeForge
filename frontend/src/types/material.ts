// SPDX-License-Identifier: Apache-2.0
/** 资料箱条目类型。 */

/** 资料附件：本机提取出的文字、一张图片的缩略图，或一份已存原件的引用。 */
export interface MaterialFile {
  name: string;
  mime_type: string;
  size_bytes: number;
  text: string;
  data_url: string;
  /**
   * 已保存原件的 user_file id；null/缺省 = 历史附件，没有原件可「另存为」。
   * 后端 material.files 是 JSON 列，老数据没有这个字段。
   */
  file_id?: number | null;
}

/** POST /api/materials/attachments 的响应：上传并提取完成的单个附件。 */
export interface MaterialAttachment {
  file_id: number;
  name: string;
  mime_type: string;
  size_bytes: number;
  text: string;
  data_url: string;
  /** 没提取到文字时的原因（如扫描件 PDF），前端要常驻提示，但仍允许加入。 */
  warnings: string[];
}

export interface Material {
  id: number;
  title: string;
  category: string;
  content: string;
  url: string;
  files: MaterialFile[];
  note: string;
  created_at: string;
  updated_at: string;
}

export interface MaterialPayload {
  title: string;
  category: string;
  content: string;
  url: string;
  files: MaterialFile[];
  note: string;
}

/** 列表用的附件摘要：只要元信息，不带 data_url 与附件文字（详情接口才有全量）。 */
export interface MaterialFileSummary {
  name: string;
  mime_type: string;
  size_bytes: number;
  has_image: boolean;
  text_length: number;
}

/** 列表视图（GET /api/materials）：files 是摘要，图片预览与附件全文按需取详情。 */
export interface MaterialSummary {
  id: number;
  title: string;
  category: string;
  content: string;
  url: string;
  note: string;
  files: MaterialFileSummary[];
  created_at: string;
  updated_at: string;
}

/** 内置分类，与后端 MATERIAL_CATEGORIES 一致；接口还会返回用户用过的自定义分类。 */
export const MATERIAL_CATEGORIES = [
  "证书",
  "作品",
  "链接",
  "笔记",
  "实习材料",
  "校园材料",
  "其他",
] as const;
