// SPDX-License-Identifier: Apache-2.0
/**
 * 字段路径的白名单与解析（前端侧，与后端 `field_style_target` 同一套规则）。
 *
 * 路径会变成 `object_roles` 的键和 `[data-resume-path]` 选择器，所以只接受
 * 「字母开头 + 2~4 段、每段 8~32 位」；`fieldStyleEntryId` 从中取第二段作为条目 id。
 */
/** Field paths are validated before becoming format keys or CSS selectors. */
const FIELD_PATH =
  /^[A-Za-z][A-Za-z0-9_-]{0,63}\.[A-Za-z0-9_-]{8,32}\.[A-Za-z0-9_-]{8,32}(?:\.[A-Za-z0-9_-]{8,32})?$/;

export function isFieldStylePath(value: string): boolean {
  return FIELD_PATH.test(value);
}

export function fieldStyleEntryId(value: string | null | undefined): string | null {
  return value && isFieldStylePath(value) ? value.split(".")[1] : null;
}
