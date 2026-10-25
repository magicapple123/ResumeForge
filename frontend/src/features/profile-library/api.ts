// SPDX-License-Identifier: Apache-2.0
/**
 * 资料库 API（F6）：工作区读取、条目批量保存、定义 CRUD、字段偏好。
 *
 * 薄封装：只拼路径与请求体，不在这里做业务判断；错误由 ApiError 暴露（409 带 revision）。
 * expected_revision 全部按服务端语义传（写接口 required，新建类 optional）。
 */
import { request } from "../../api/client";
import type {
  BulkEntriesResult,
  BulkEntryItem,
  CustomFieldType,
  FieldDeletionImpactOut,
  FieldOut,
  FieldPreferencePatch,
  PaperProjectionOut,
  SectionDeletionImpactOut,
  SectionOut,
  WorkspaceOut,
} from "./types";

const BASE = "/profile";

function sectionPath(sectionKey: string): string {
  return BASE + "/sections/" + encodeURIComponent(sectionKey);
}

export function getWorkspace(): Promise<WorkspaceOut> {
  return request(BASE + "/workspace");
}

/** 当前组消费投影（F4 用；类型中无 collapsed——消费侧不得读折叠态）。 */
export function getCurrentProjection(signal?: AbortSignal): Promise<PaperProjectionOut> {
  return request(BASE + "/current/projection", { signal });
}

/** 批量保存本轮改动集（单事务原子；失败一条也不写）。 */
export function saveEntries(
  entries: BulkEntryItem[],
  expectedWorkspaceRevision: number | null,
): Promise<BulkEntriesResult> {
  return request(BASE + "/workspace/entries", {
    method: "PATCH",
    body: JSON.stringify({
      entries,
      expected_workspace_revision: expectedWorkspaceRevision,
    }),
  });
}

export function setSectionOrder(order: string[], expectedRevision: number) {
  return request(BASE + "/section-order", {
    method: "PUT",
    body: JSON.stringify({ order, expected_revision: expectedRevision }),
  });
}

export function createSection(name: string, expectedRevision: number): Promise<SectionOut> {
  return request(BASE + "/sections", {
    method: "POST",
    body: JSON.stringify({ name, expected_revision: expectedRevision }),
  });
}

export function renameSection(
  sectionKey: string,
  name: string,
  expectedRevision: number,
): Promise<SectionOut> {
  return request(sectionPath(sectionKey), {
    method: "PATCH",
    body: JSON.stringify({ name, expected_revision: expectedRevision }),
  });
}

export function deleteSection(
  sectionKey: string,
  expectedRevision: number,
): Promise<SectionDeletionImpactOut> {
  return request(sectionPath(sectionKey), {
    method: "DELETE",
    body: JSON.stringify({ expected_revision: expectedRevision }),
  });
}

export function getSectionDeletionImpact(sectionKey: string): Promise<SectionDeletionImpactOut> {
  return request(sectionPath(sectionKey) + "/deletion-impact");
}

export function createField(
  sectionKey: string,
  label: string,
  fieldType: CustomFieldType,
  expectedRevision: number | null,
): Promise<FieldOut> {
  return request(sectionPath(sectionKey) + "/fields", {
    method: "POST",
    body: JSON.stringify({
      label,
      field_type: fieldType,
      expected_revision: expectedRevision,
    }),
  });
}

export function updateField(
  sectionKey: string,
  fieldId: string,
  updates: { label?: string; sort_order?: number; expected_revision: number },
): Promise<FieldOut> {
  return request(sectionPath(sectionKey) + "/fields/" + encodeURIComponent(fieldId), {
    method: "PATCH",
    body: JSON.stringify(updates),
  });
}

export function deleteField(
  sectionKey: string,
  fieldId: string,
  expectedRevision: number,
  confirmWithValues: boolean,
): Promise<FieldDeletionImpactOut> {
  return request(sectionPath(sectionKey) + "/fields/" + encodeURIComponent(fieldId), {
    method: "DELETE",
    body: JSON.stringify({
      expected_revision: expectedRevision,
      confirm_with_values: confirmWithValues,
    }),
  });
}

export function getFieldDeletionImpact(
  sectionKey: string,
  fieldId: string,
): Promise<FieldDeletionImpactOut> {
  return request(
    sectionPath(sectionKey) + "/fields/" + encodeURIComponent(fieldId) + "/deletion-impact",
  );
}

/** 偏好局部更新：hidden 与 collapsed_override 独立；collapsed_override 传 null 表示恢复默认。 */
export function patchFieldPreference(
  fieldId: string,
  patch: FieldPreferencePatch,
): Promise<FieldOut> {
  return request(BASE + "/field-preferences/" + encodeURIComponent(fieldId), {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteEntry(
  sectionKey: string,
  entryId: string,
  expectedRevision: number,
): Promise<void> {
  return request(sectionPath(sectionKey) + "/entries/" + encodeURIComponent(entryId), {
    method: "DELETE",
    body: JSON.stringify({ expected_revision: expectedRevision }),
  });
}

export function reorderEntries(
  sectionKey: string,
  entryIds: string[],
  expectedRevision: number,
): Promise<void> {
  return request(sectionPath(sectionKey) + "/entries/reorder", {
    method: "PUT",
    body: JSON.stringify({ entry_ids: entryIds, expected_revision: expectedRevision }),
  });
}
