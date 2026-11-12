// SPDX-License-Identifier: Apache-2.0
/**
 * W16 变体独立排版的纯规则（`resume_variant.layout`，0060）。
 *
 * 口径（be-prov 冻结契约）：
 * - `layout` 为 NULL = 继承当前简历排版；非空 = 该变体自己的排版覆盖；
 * - 有效排版由 `GET /variants/{id}/export-input` 下发（layout + layout_source），
 *   编辑时只改 template / page_limit / font_scale 三个显式字段，其余继承。
 *
 * 本文件不写请求、不 import React：字段归一化与补丁形状可单测。
 */

export interface VariantLayoutFields {
  template: string;
  page_limit: number;
  font_scale: string;
}

export const VARIANT_PAGE_LIMIT_MIN = 1;
export const VARIANT_PAGE_LIMIT_MAX = 10;

export const VARIANT_FONT_SCALES = ["small", "standard", "large"] as const;

/** 页数上限夹到 1–10（与后端长 CV/普通简历共用的可见区间一致，越界不静默）。 */
export function clampVariantPageLimit(value: number): number {
  if (!Number.isFinite(value)) return VARIANT_PAGE_LIMIT_MIN;
  return Math.min(VARIANT_PAGE_LIMIT_MAX, Math.max(VARIANT_PAGE_LIMIT_MIN, Math.round(value)));
}

/** 1–10 的可选页数（Select 用；不依赖目录）。 */
export function variantPageLimitOptions(): number[] {
  const options: number[] = [];
  for (let page = VARIANT_PAGE_LIMIT_MIN; page <= VARIANT_PAGE_LIMIT_MAX; page += 1) {
    options.push(page);
  }
  return options;
}

/**
 * 有效排版 → 编辑字段。缺值一律回退（旧变体无 layout / 旧后端缺字段时不编造）。
 * `fallback` 用于 export-input 缺 template 时取派生基底快照。
 */
export function variantLayoutFieldsFrom(
  layout: Record<string, unknown> | null | undefined,
  fallback?: Partial<VariantLayoutFields> | null,
): VariantLayoutFields {
  const source = layout ?? {};
  const template =
    typeof source.template === "string" && source.template
      ? source.template
      : (fallback?.template ?? "");
  const fontScale =
    typeof source.font_scale === "string" && source.font_scale
      ? source.font_scale
      : (fallback?.font_scale ?? "standard");
  const rawLimit = Number(source.page_limit ?? fallback?.page_limit ?? VARIANT_PAGE_LIMIT_MIN);
  return { template, page_limit: clampVariantPageLimit(rawLimit), font_scale: fontScale };
}

/** 编辑字段 → PATCH variants 的 `layout` 覆盖（只发三个显式字段）。 */
export function variantLayoutPatch(fields: VariantLayoutFields): Record<string, unknown> {
  return {
    template: fields.template,
    page_limit: clampVariantPageLimit(fields.page_limit),
    font_scale: fields.font_scale,
  };
}

/** 两个编辑态是否等价（保存按钮据此禁用；模板/字体空串也算不同）。 */
export function sameVariantLayout(left: VariantLayoutFields, right: VariantLayoutFields): boolean {
  return (
    left.template === right.template &&
    clampVariantPageLimit(left.page_limit) === clampVariantPageLimit(right.page_limit) &&
    left.font_scale === right.font_scale
  );
}

/** export-input 的 layout_source 是否表示「这条变体有自己的排版」。 */
export function layoutIsVariantOwned(layoutSource: string | null | undefined): boolean {
  return layoutSource === "variant";
}
