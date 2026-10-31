// SPDX-License-Identifier: Apache-2.0
/**
 * 版式预设的展示名（从 ResumeTemplateControls 拆出，守住单文件 500 行预算）。
 *
 * 内置预设按稳定 name 映射到语言包；自制版式的名字是用户输入、后端新增的未知预设也映射
 * 不到——两者一律回退后端原文（不丢信息）。
 */
import type { MessageKey } from "../../i18n";
import { RESUME_CATALOG_FORMAT_LABEL_KEYS } from "../../i18n/enum/resumeCatalog";
import type { ResumeFormatPreset } from "../../types";

export function formatPresetLabelOf(
  item: ResumeFormatPreset,
  t: (key: MessageKey) => string,
): string {
  const labelKey = item.custom ? undefined : RESUME_CATALOG_FORMAT_LABEL_KEYS[item.name];
  return labelKey ? t(labelKey) : item.label;
}
