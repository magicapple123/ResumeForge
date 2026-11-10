// SPDX-License-Identifier: Apache-2.0
/** 资料箱接口：零散资料的增删改查。 */
import type { Material, MaterialAttachment, MaterialPayload, MaterialSummary } from "../types";
import type { Page } from "../types/common";
import { buildQuery, request } from "./client";

/** 列表只带附件元信息（RF-25）：图片预览与附件全文走 getMaterial 详情。 */
export function listMaterials(
  params: { keyword?: string; category?: string } = {},
): Promise<MaterialSummary[]> {
  return request(`/materials${buildQuery(params)}`);
}

/** 分页列出资料（RF-08 续）：行结构与旧列表一致，一页默认 16 张（网格口径）。 */
export function listMaterialsPage(
  params: { keyword?: string; category?: string } = {},
  page: number,
  pageSize: number,
): Promise<Page<MaterialSummary>> {
  return request(`/materials/page${buildQuery({ ...params, page, page_size: pageSize })}`);
}

/** 候选分类：内置分类 + 用户已用过的自定义分类。 */
export function listMaterialCategories(): Promise<string[]> {
  return request("/materials/categories");
}

export function getMaterial(id: number): Promise<Material> {
  return request(`/materials/${id}`);
}

/**
 * 上传一个资料附件：后端存原件 + 提取文字/生成受限缩略图，返回可直接放进
 * material.files 的元信息（含 file_id）。
 *
 * 走 multipart 而不是 JSON：10 MB 的 PDF 转 base64 会再放大三分之一，而这是一个
 * 逐个文件上传的接口（表单里可多选，逐个 await 串行上传）。
 */
export function uploadMaterialAttachment(file: File): Promise<MaterialAttachment> {
  const form = new FormData();
  form.append("file", file);
  return request("/materials/attachments", {
    method: "POST",
    body: form,
    budget: "upload",
  });
}

export function createMaterial(payload: MaterialPayload): Promise<Material> {
  return request("/materials", { method: "POST", body: JSON.stringify(payload) });
}

export function updateMaterial(id: number, payload: MaterialPayload): Promise<Material> {
  return request(`/materials/${id}`, { method: "PUT", body: JSON.stringify(payload) });
}

export function deleteMaterial(id: number): Promise<void> {
  return request(`/materials/${id}`, { method: "DELETE" });
}

/** 批量移入回收站（软删除）：与简历批量删除同一口径，后端缺失任一 id 即整体 404。 */
export function batchDeleteMaterials(materialIds: number[]): Promise<{ deleted: number }> {
  return request("/materials/batch-delete", {
    method: "POST",
    body: JSON.stringify({ material_ids: materialIds }),
  });
}
