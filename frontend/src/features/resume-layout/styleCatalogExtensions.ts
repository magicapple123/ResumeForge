// SPDX-License-Identifier: Apache-2.0
/**
 * W07 的可选目录扩展：`GET /api/resumes/templates` 上的 `role_fields` /
 * `template_role_defaults`（wave2 契约 §2.8）。
 *
 * ## 为什么"可选读取"而不是改共享类型
 *
 * 这三个字段由后端 W07-BE 新增、`types/resume.ts` 的 `ResumeTemplateCatalog` 尚未声明
 * （那份类型是全仓共用，改动归 lead/wb-core）。前端在这里**收窄一次**：
 * 缺字段 → 用契约里的 `ROLE_STYLE_PROPS` 与中性兜底值，面板照样能用，只是"来自模板"
 * 的具体数值显示不出来（界面上会提示目录暂缺）。
 *
 * ## 不做第二份真相
 *
 * 后端下发的 `role_fields.props` 只能**收窄**契约表（交集），不能被它放宽：前端在面板里
 * 画出一个后端不认的属性，用户改完会被 validate 丢掉，是更坏的一种"以为生效了"。
 */
import type { ResumeTemplateCatalog } from "../../types";
import { readStylePropValue, type StylePropKey } from "../../utils/resumeStyleParams";
import { RESUME_ROLES, ROLE_STYLE_PROPS, type ResumeRoleKey } from "./styleCatalog";
import type { ResumeRoleStyle } from "./styleOverrides";

export type TemplateRoleDefaults = Partial<Record<ResumeRoleKey, ResumeRoleStyle>>;

export interface ResumeStyleCatalog {
  /** 每个角色实际可调的属性（契约表 ∩ 目录下发；目录缺省时就是契约表）。 */
  roleProps: Record<ResumeRoleKey, readonly StylePropKey[]>;
  /** 模板 → 角色 → 模板基准值（`template_role_defaults`）。 */
  templateDefaults: Record<string, TemplateRoleDefaults>;
  /** 目录是否真的下发了模板基准（false 时界面要说明"滑杆起点为中性值"）。 */
  hasTemplateDefaults: boolean;
}

const ROLE_PROP_SET: Record<ResumeRoleKey, readonly StylePropKey[]> = ROLE_STYLE_PROPS;

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

function isRole(value: unknown): value is ResumeRoleKey {
  return typeof value === "string" && (RESUME_ROLES as readonly string[]).includes(value);
}

/** 把目录里的一个角色覆盖收成合法值（未知键 / 越界值丢弃）。 */
function readRoleStyle(raw: unknown, role: ResumeRoleKey): ResumeRoleStyle {
  if (!isRecord(raw)) return {};
  const allowed = ROLE_PROP_SET[role];
  const style: ResumeRoleStyle = {};
  for (const [key, value] of Object.entries(raw)) {
    const prop = key as StylePropKey;
    if (!allowed.includes(prop)) continue;
    const coerced = readStylePropValue(prop, value);
    if (coerced !== null) style[prop] = coerced;
  }
  return style;
}

function readRoleProps(raw: unknown): Partial<Record<ResumeRoleKey, readonly StylePropKey[]>> {
  if (!Array.isArray(raw)) return {};
  const found: Partial<Record<ResumeRoleKey, readonly StylePropKey[]>> = {};
  for (const entry of raw) {
    if (!isRecord(entry) || !isRole(entry["role"])) continue;
    const role = entry["role"];
    const props = Array.isArray(entry["props"]) ? entry["props"] : [];
    const narrowed = ROLE_PROP_SET[role].filter((prop) => props.some((item) => item === prop));
    // 目录下发空列表 = 这个角色确实没有可调属性；不要回落到契约表（那会画出后端不认的行）。
    found[role] = narrowed;
  }
  return found;
}

function readTemplateDefaults(raw: unknown): Record<string, TemplateRoleDefaults> {
  if (!isRecord(raw)) return {};
  const templates: Record<string, TemplateRoleDefaults> = {};
  for (const [template, roles] of Object.entries(raw)) {
    if (!isRecord(roles)) continue;
    const defaults: TemplateRoleDefaults = {};
    for (const [role, style] of Object.entries(roles)) {
      if (!isRole(role)) continue;
      const parsed = readRoleStyle(style, role);
      if (Object.keys(parsed).length > 0) defaults[role] = parsed;
    }
    if (Object.keys(defaults).length > 0) templates[template] = defaults;
  }
  return templates;
}

/** 读目录扩展；任何形状问题都退化成"契约默认"，不抛异常（目录是网络数据）。 */
export function readStyleCatalog(
  catalog: ResumeTemplateCatalog | undefined | null,
): ResumeStyleCatalog {
  const raw = (catalog ?? {}) as unknown as Record<string, unknown>;
  const fromCatalog = readRoleProps(raw["role_fields"]);
  const roleProps = {} as Record<ResumeRoleKey, readonly StylePropKey[]>;
  for (const role of RESUME_ROLES) {
    roleProps[role] = fromCatalog[role] ?? ROLE_STYLE_PROPS[role];
  }
  const templateDefaults = readTemplateDefaults(raw["template_role_defaults"]);
  return {
    roleProps,
    templateDefaults,
    hasTemplateDefaults: Object.keys(templateDefaults).length > 0,
  };
}

/** 某个模板下某角色的模板基准值（没有就是空对象 = 只能用中性兜底）。 */
export function templateRoleDefaults(
  catalog: ResumeStyleCatalog,
  template: string,
  role: ResumeRoleKey,
): ResumeRoleStyle {
  return { ...(catalog.templateDefaults[template]?.[role] ?? {}) };
}

/** 某个角色实际可调的属性（面板行序来自契约表，取舍来自目录）。 */
export function roleStyleProps(
  catalog: ResumeStyleCatalog,
  role: ResumeRoleKey,
): readonly StylePropKey[] {
  return catalog.roleProps[role] ?? ROLE_STYLE_PROPS[role];
}
