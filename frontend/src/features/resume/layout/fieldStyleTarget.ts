// SPDX-License-Identifier: Apache-2.0
/**
 * 字段路径的白名单与解析（前端侧，与后端 `field_style_target` 同一套规则）。
 *
 * 路径会变成 `object_roles` 的键和 `[data-resume-path]` 选择器，所以只接受
 * 「字母开头 + 2~4 段、每段 8~32 位」；页眉字段是**两段**（`header.{item_id}`），
 * 单开一条规则而不是把段数下限改成 2——后者会连带放宽所有两段路径。
 * `fieldStyleEntryId` 从中取第二段作为条目 id；页眉字段没有条目，返回 null。
 */
/** Field paths are validated before becoming format keys or CSS selectors. */
const FIELD_PATH =
  /^[A-Za-z][A-Za-z0-9_-]{0,63}\.[A-Za-z0-9_-]{8,32}\.[A-Za-z0-9_-]{8,32}(?:\.[A-Za-z0-9_-]{8,32})?$/;

/** QW-6：页眉字段路径（`header.{item_id}`），与后端 `_HEADER_PATH` 逐字相同。 */
const HEADER_PATH = /^header\.[A-Za-z0-9_-]{8,32}$/;

export function isHeaderStylePath(value: string | null | undefined): boolean {
  return typeof value === "string" && HEADER_PATH.test(value);
}

export function isFieldStylePath(value: string): boolean {
  return FIELD_PATH.test(value) || HEADER_PATH.test(value);
}

export function fieldStyleEntryId(value: string | null | undefined): string | null {
  // 页眉字段没有所属条目：回落成第二段（= 页眉 item id）会让"字段 → 条目"的继承链
  // 去查一个不存在的条目，样式来源与分辨率都会读错。
  if (!value || isHeaderStylePath(value)) return null;
  return isFieldStylePath(value) ? value.split(".")[1] : null;
}
