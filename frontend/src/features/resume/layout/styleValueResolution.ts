// SPDX-License-Identifier: Apache-2.0
/**
 * 排版值的「存储值 → 显示值」转换：字段级目标要保留条目继承。
 *
 * `font_scale` 存的是相对系数，显示要乘回条目基准（否则 0.9 会显示成 0.9px）；其余属性
 * 原样返回。取生效值时按 字段 → 条目角色 → 条目 → 模板 逐级回退。
 */
/** Effective display values retain entry inheritance for exact field targets. */
import {
  coerceStylePropValue,
  STYLE_PROP_FALLBACKS,
  type StylePropKey,
} from "../../../utils/resumeStyleParams";
import { fieldStyleEntryId } from "./fieldStyleTarget";
import type { ResumeRoleKey } from "./styleCatalog";
import {
  objectRoleKey,
  type ResumeRoleStyle,
  type ResumeStyleDomains,
  type ResumeStyleValue,
} from "./styleOverrides";

export function roleBaseRatio(templateDefaults: ResumeRoleStyle | null | undefined): number {
  const base = templateDefaults?.font_scale;
  return typeof base === "number" && Number.isFinite(base) && base > 0 ? base : 1;
}

export function displayStyleValue(
  prop: StylePropKey,
  stored: ResumeStyleValue | undefined,
  baseRatio: number,
): ResumeStyleValue | undefined {
  if (prop !== "font_scale") return stored;
  const coefficient = typeof stored === "number" ? stored : 1;
  return Math.round(coefficient * baseRatio * 100) / 100;
}

export function storedStyleValue(
  prop: StylePropKey,
  displayed: ResumeStyleValue | null,
  baseRatio: number,
): ResumeStyleValue | null {
  if (displayed === null) return null;
  if (prop !== "font_scale") return displayed;
  if (typeof displayed !== "number" || !Number.isFinite(displayed) || !(baseRatio > 0)) return null;
  return Math.round((displayed / baseRatio) * 10000) / 10000;
}

export function resolvedPropValue(
  domains: ResumeStyleDomains,
  params: {
    role: ResumeRoleKey;
    prop: StylePropKey;
    objectId?: string | null;
    templateDefaults?: ResumeRoleStyle | null;
  },
): ResumeStyleValue | undefined {
  const base = roleBaseRatio(params.templateDefaults);
  const parent = fieldStyleEntryId(params.objectId);
  const candidates = [
    params.objectId ? domains.objectRoles[objectRoleKey(params.objectId, params.role)] : undefined,
    parent ? domains.objectRoles[objectRoleKey(parent, params.role)] : undefined,
    params.objectId ? domains.objects[parent ?? params.objectId] : undefined,
    domains.roles[params.role],
  ];
  for (const style of candidates) {
    const value = coerceStylePropValue(params.prop, style?.[params.prop]);
    if (value !== null) return displayStyleValue(params.prop, value, base);
  }
  const template = coerceStylePropValue(params.prop, params.templateDefaults?.[params.prop]);
  return template ?? STYLE_PROP_FALLBACKS[params.prop];
}
