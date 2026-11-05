// SPDX-License-Identifier: Apache-2.0
/**
 * 版式字段的显示名（目录里 `format_fields` / `style_fields` 的 `label`）。
 *
 * 后端每一项同时下发中文正名 `label` 与英文名 `label_en`（`description_en` 同理）。
 * 这里按**当前界面语言**挑一个：
 *
 * - 英文界面且 `label_en` 非空 → 用 `label_en`；
 * - 其它情况（中文界面 / 旧后端没有这个键 / 该项漏了英文）→ 回落 `label`。
 *
 * 回落到 `label` 这一点是关键：`label_en` 是**附加键**，中文界面的输出因此与改动前
 * 逐字相同，旧后端不带这个键也不会变成空白。
 *
 * ## 为什么判断只写在这里
 *
 * 色板四行（强调色 / 正文 / 次要文字 / 分隔线）、区块间距行，以及它们身上的
 * `aria-label`（`Toggle palette for {label}` / `Decrease {label}` 这类模板串）读的都是
 * 同一个返回值。若在组件里各写一次 `locale === "en-US"`，两处迟早不同步——那正是
 * `docs/ui-copy-guide-en.md` 里"一词一义"要挡的那类缺陷。
 */
import type { Locale } from "../i18n";

/** 目录项里可能带英文名的两种字段（`format_fields` 与 `style_fields`）。 */
interface LabeledField {
  key?: string;
  label: string;
  label_en?: string;
  description?: string;
  description_en?: string;
}

/**
 * 取一个目录项的显示名。
 *
 * @param field 目录项；`undefined`（目录还没回来 / 旧目录没有这一项）时用 `fallback`。
 * @param locale 当前界面语言，调用方从 `useLocale()` 拿，不要在组件里另算。
 * @param fallback 取不到任何标签时的兜底（通常是该字段的 i18n 文案或原始 key）。
 */
export function formatFieldLabel(
  field: LabeledField | undefined | null,
  locale: Locale,
  fallback: string,
): string {
  if (!field) return fallback;
  if (locale.startsWith("en")) {
    const english = (field.label_en ?? "").trim();
    if (english) return english;
  }
  return field.label || fallback;
}

/**
 * 按 key 在目录清单里找一项并取显示名。
 *
 * 与 `formatFieldLabel` 是同一套判断，只是把"找项"这一步一并收进来——三个渲染处
 * （色板、区块间距、自制版式编辑器）都在做 `catalog?.format_fields?.find(...)?.label`。
 */
export function formatFieldLabelOf(
  fields: readonly LabeledField[] | undefined | null,
  key: string,
  locale: Locale,
  fallback: string,
): string {
  const field = fields?.find((item) => item.key === key);
  return formatFieldLabel(field, locale, fallback);
}

/** 取一个目录项的说明文字；规则与 `formatFieldLabel` 相同。 */
export function formatFieldDescription(
  field: LabeledField | undefined | null,
  locale: Locale,
): string {
  if (!field) return "";
  if (locale.startsWith("en")) {
    const english = (field.description_en ?? "").trim();
    if (english) return english;
  }
  return field.description ?? "";
}
