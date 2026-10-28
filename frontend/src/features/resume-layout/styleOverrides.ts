// SPDX-License-Identifier: Apache-2.0
/**
 * W07 局部排版的**数据层**：`format_config` 的 `roles` / `objects` / `object_roles` 三个域
 * （wave2 契约 §2.3；`object_roles` 为 W3 追加）。
 *
 * ## 四层应用范围
 *
 * | 范围 | 落点 | 读法 |
 * | --- | --- | --- |
 * | 整份简历 | `format_config` 的既有扁平键（行距 / 页边距 / 颜色…） | 既有控件，不在本模块 |
 * | 同类段落（角色） | `format_config.roles.<role>` | `readRoleStyle` / `withRoleProp` |
 * | 单条内容（对象） | `format_config.objects[<object_id>]` | `readObjectStyle` / `withObjectProp` |
 * | 单条内容的某个字段（对象角色） | `format_config.object_roles["<object_id>:<role>"]` | `readObjectRoleStyle` / `withObjectRoleProp` |
 *
 * ## 三态语义：删键即继承
 *
 * - 未设置：键不存在 → 读上一层（对象角色 → 对象 → 角色 → 模板）；
 * - 已覆盖：键存在且合法 → 用该值；
 * - 恢复继承：**删除该键**（绝不写回默认值）。
 *
 * ## 唯一性
 *
 * 属性白名单 / 区间 / 枚举只来自 `utils/resumeStyleParams`（与后端 `PROP_BOUNDS` 逐键
 * 相等）；本模块只做"按域写值"与"三层读取"，不定义第二份数字。
 */
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import {
  coerceStylePropValue,
  isStylePropSet,
  readStylePropValue,
  styleIsEmpty,
  STYLE_PROP_FALLBACKS,
  type StylePropKey,
} from "../../utils/resumeStyleParams";
import { domainEntries, readFormatDomain, withFormatDomain } from "./formatDomains";
import {
  OBJECT_STYLE_PROPS,
  RESUME_ROLES,
  ROLE_STYLE_PROPS,
  type ResumeRoleKey,
} from "./styleCatalog";

/**
 * 属性来源：来自模板 / 已按排版参数调整（扁平键）/ 同类段落已调整 / 本条已调整。
 *
 * 与后端 `resume_style.source_of` 的取值逐字对齐：L2（具名版式）与 L3（记录覆盖）在
 * 调用方已经合成进同一份 format_config，后端只能报 `resume`，前端也报同一个值——
 * 两边各叫一个名字会让"来源"在检查面板与属性面板里说法不一致。
 */
export type ResumeStyleSource = "template" | "resume" | "role" | "object";

/** 一个属性值：数值 / 颜色串 / 布尔 / 枚举字面量。 */
export type ResumeStyleValue = number | string | boolean;

/** 一条覆盖：只保存**显式值**，缺键 = 未设置。 */
export type ResumeRoleStyle = Partial<Record<StylePropKey, ResumeStyleValue>>;

export interface ResumeStyleDomains {
  roles: Partial<Record<ResumeRoleKey, ResumeRoleStyle>>;
  objects: Record<string, ResumeRoleStyle>;
  /** 键为 `"<object_id>:<role>"`：该对象该字段的最高优先覆盖（W3）。 */
  objectRoles: Record<string, ResumeRoleStyle>;
}

/**
 * 扁平键 → 角色属性：与后端 `resume_style._FLAT_PROP_KEYS` **逐键相等**（来源判定）。
 *
 * 一个属性可能对应多个扁平键（颜色既有 `accent` 也有 `text_color`），任一个存在即
 * 视为"更低层设过"，与后端 `any(key in self.flat ...)` 同判据。
 */
const FLAT_PROP_KEYS: Partial<Record<StylePropKey, readonly string[]>> = {
  color: ["text_color", "accent"],
  line_height: ["line_height"],
  space_after: ["section_gap"],
  font_scale: ["font_scale_adjust"],
};

/** 对象 id 形状（与 W00/W01 的 `document_identity` 同一正则；不合规直接丢弃）。 */
const OBJECT_ID = /^[A-Za-z0-9_-]{8,32}$/;

/** `object_roles` 域的键：`"<object_id>:<role>"`（与后端 `validate_object_roles_domain` 同形）。 */
export function objectRoleKey(objectId: string, role: ResumeRoleKey): string {
  return `${objectId}:${role}`;
}

/** 拆 `"<object_id>:<role>"`；形状 / 角色不合法返回 `null`（读宽容）。 */
function splitObjectRoleKey(key: string): { objectId: string; role: ResumeRoleKey } | null {
  const separator = key.indexOf(":");
  if (separator <= 0 || key.indexOf(":", separator + 1) !== -1) return null;
  const objectId = key.slice(0, separator);
  const role = key.slice(separator + 1);
  if (!OBJECT_ID.test(objectId)) return null;
  if (!(RESUME_ROLES as readonly string[]).includes(role)) return null;
  return { objectId, role: role as ResumeRoleKey };
}

function isRecord(value: unknown): value is Record<string, unknown> {
  return typeof value === "object" && value !== null && !Array.isArray(value);
}

/** 把域里的任意对象收成一条合法覆盖：未知键 / 非法值丢弃（读宽容）。 */
function coerceStyle(raw: unknown): ResumeRoleStyle {
  if (!isRecord(raw)) return {};
  const style: ResumeRoleStyle = {};
  for (const [key, value] of Object.entries(raw)) {
    const prop = key as StylePropKey;
    const coerced = readStylePropValue(prop, value);
    if (coerced !== null) style[prop] = coerced;
  }
  return style;
}

/** 读三份风格域（roles / objects / object_roles），非法条目丢弃。 */
export function readStyleDomains(
  config: ResumeFormatConfig | undefined | null,
): ResumeStyleDomains {
  const roles: Partial<Record<ResumeRoleKey, ResumeRoleStyle>> = {};
  for (const [role, value] of Object.entries(domainEntries(readFormatDomain(config, "roles")))) {
    if (!(RESUME_ROLES as readonly string[]).includes(role)) continue;
    const style = coerceStyle(value);
    if (!styleIsEmpty(style)) roles[role as ResumeRoleKey] = style;
  }
  const objects: Record<string, ResumeRoleStyle> = {};
  for (const [objectId, value] of Object.entries(
    domainEntries(readFormatDomain(config, "objects")),
  )) {
    if (!OBJECT_ID.test(objectId)) continue;
    const style = coerceStyle(value);
    if (!styleIsEmpty(style)) objects[objectId] = style;
  }
  const objectRoles: Record<string, ResumeRoleStyle> = {};
  for (const [key, value] of Object.entries(
    domainEntries(readFormatDomain(config, "object_roles")),
  )) {
    const parsed = splitObjectRoleKey(key);
    if (!parsed) continue;
    const style = coerceStyle(value);
    if (!styleIsEmpty(style)) {
      objectRoles[objectRoleKey(parsed.objectId, parsed.role)] = style;
    }
  }
  return { roles, objects, objectRoles };
}

/** 写回三份风格域：空域删键（契约 R3）。 */
export function writeStyleDomains(
  config: ResumeFormatConfig | undefined | null,
  domains: ResumeStyleDomains,
): ResumeFormatConfig {
  const roles: Record<string, unknown> = {};
  for (const [role, style] of Object.entries(domains.roles)) {
    if (style && !styleIsEmpty(style)) roles[role] = style;
  }
  const objects: Record<string, unknown> = {};
  for (const [objectId, style] of Object.entries(domains.objects)) {
    if (style && !styleIsEmpty(style)) objects[objectId] = style;
  }
  const objectRoles: Record<string, unknown> = {};
  for (const [key, style] of Object.entries(domains.objectRoles ?? {})) {
    const parsed = splitObjectRoleKey(key);
    if (!parsed || styleIsEmpty(style)) continue;
    objectRoles[objectRoleKey(parsed.objectId, parsed.role)] = style;
  }
  const withRoles = withFormatDomain(config, "roles", Object.keys(roles).length ? roles : null);
  const withObjects = withFormatDomain(
    withRoles,
    "objects",
    Object.keys(objects).length ? objects : null,
  );
  return withFormatDomain(
    withObjects,
    "object_roles",
    Object.keys(objectRoles).length ? objectRoles : null,
  );
}

/** 某个角色的显式覆盖（没有返回空对象）。 */
export function readRoleStyle(domains: ResumeStyleDomains, role: ResumeRoleKey): ResumeRoleStyle {
  return { ...(domains.roles[role] ?? {}) };
}

/** 某个对象的显式覆盖（没有返回空对象）。 */
export function readObjectStyle(domains: ResumeStyleDomains, objectId: string): ResumeRoleStyle {
  return { ...(domains.objects[objectId] ?? {}) };
}

/** 写一个角色属性：`value === null` = 删该属性（恢复继承）。非法值不写，原样返回。 */
export function withRoleProp(
  config: ResumeFormatConfig | undefined | null,
  role: ResumeRoleKey,
  prop: StylePropKey,
  value: ResumeStyleValue | null,
): ResumeFormatConfig {
  const domains = readStyleDomains(config);
  const style = readRoleStyle(domains, role);
  if (value === null) {
    delete style[prop];
  } else {
    const coerced = coerceStylePropValue(prop, value);
    if (coerced === null) return (config ?? {}) as ResumeFormatConfig;
    style[prop] = coerced;
  }
  const roles = { ...domains.roles };
  if (styleIsEmpty(style)) delete roles[role];
  else roles[role] = style;
  return writeStyleDomains(config, { ...domains, roles });
}

/** 写一个对象属性：`value === null` = 删该属性（回到角色/模板）。 */
export function withObjectProp(
  config: ResumeFormatConfig | undefined | null,
  objectId: string,
  prop: StylePropKey,
  value: ResumeStyleValue | null,
): ResumeFormatConfig {
  const domains = readStyleDomains(config);
  const style = readObjectStyle(domains, objectId);
  if (value === null) {
    delete style[prop];
  } else {
    const coerced = coerceStylePropValue(prop, value);
    if (coerced === null) return (config ?? {}) as ResumeFormatConfig;
    style[prop] = coerced;
  }
  const objects = { ...domains.objects };
  if (styleIsEmpty(style)) delete objects[objectId];
  else objects[objectId] = style;
  return writeStyleDomains(config, { ...domains, objects });
}

/** 多选批量应用：一个补丁合并到每个目标对象的既有覆盖上（逐条保留各自其它覆盖）。 */
export function withObjectProps(
  config: ResumeFormatConfig | undefined | null,
  objectIds: readonly string[],
  patch: ResumeRoleStyle,
): ResumeFormatConfig {
  const domains = readStyleDomains(config);
  const objects = { ...domains.objects };
  for (const objectId of objectIds) {
    if (!OBJECT_ID.test(objectId)) continue;
    const style = { ...readObjectStyle(domains, objectId) };
    for (const prop of OBJECT_STYLE_PROPS) {
      const value = patch[prop];
      if (value === undefined) continue;
      const coerced = coerceStylePropValue(prop, value);
      if (coerced === null) continue;
      style[prop] = coerced;
    }
    if (styleIsEmpty(style)) delete objects[objectId];
    else objects[objectId] = style;
  }
  return writeStyleDomains(config, { ...domains, objects });
}

/** 清掉一个角色的全部覆盖（恢复继承）。 */
export function clearRole(
  config: ResumeFormatConfig | undefined | null,
  role: ResumeRoleKey,
): ResumeFormatConfig {
  const domains = readStyleDomains(config);
  const roles = { ...domains.roles };
  delete roles[role];
  return writeStyleDomains(config, { ...domains, roles });
}

/** 清掉一个对象的全部覆盖。 */
export function clearObject(
  config: ResumeFormatConfig | undefined | null,
  objectId: string,
): ResumeFormatConfig {
  const domains = readStyleDomains(config);
  const objects = { ...domains.objects };
  delete objects[objectId];
  return writeStyleDomains(config, { ...domains, objects });
}

/** 某个对象某个角色的显式覆盖（W3；没有返回空对象）。 */
export function readObjectRoleStyle(
  domains: ResumeStyleDomains,
  objectId: string,
  role: ResumeRoleKey,
): ResumeRoleStyle {
  return { ...(domains.objectRoles[objectRoleKey(objectId, role)] ?? {}) };
}

/**
 * 写一个对象**角色**属性（W3）：`value === null` = 删该属性（回到对象/角色/模板）。
 *
 * 该角色不允许的属性不写（与后端 `ROLE_PROPS[role]` 同一白名单；写进去也会被后端
 * 静默丢弃，用户会看到"设了却消失"）。
 */
export function withObjectRoleProp(
  config: ResumeFormatConfig | undefined | null,
  objectId: string,
  role: ResumeRoleKey,
  prop: StylePropKey,
  value: ResumeStyleValue | null,
): ResumeFormatConfig {
  if (!OBJECT_ID.test(objectId) || !ROLE_STYLE_PROPS[role].includes(prop)) {
    return (config ?? {}) as ResumeFormatConfig;
  }
  const domains = readStyleDomains(config);
  const style = readObjectRoleStyle(domains, objectId, role);
  if (value === null) {
    delete style[prop];
  } else {
    const coerced = coerceStylePropValue(prop, value);
    if (coerced === null) return (config ?? {}) as ResumeFormatConfig;
    style[prop] = coerced;
  }
  const objectRoles = { ...domains.objectRoles };
  const key = objectRoleKey(objectId, role);
  if (styleIsEmpty(style)) delete objectRoles[key];
  else objectRoles[key] = style;
  return writeStyleDomains(config, { ...domains, objectRoles });
}

/** 多选批量应用：一个补丁合并到每个目标对象的**该角色**覆盖上（W3；逐条保留其它属性）。 */
export function withObjectRoleProps(
  config: ResumeFormatConfig | undefined | null,
  objectIds: readonly string[],
  role: ResumeRoleKey,
  patch: ResumeRoleStyle,
): ResumeFormatConfig {
  const domains = readStyleDomains(config);
  const objectRoles = { ...domains.objectRoles };
  const allowed = ROLE_STYLE_PROPS[role];
  for (const objectId of objectIds) {
    if (!OBJECT_ID.test(objectId)) continue;
    const key = objectRoleKey(objectId, role);
    const style = { ...readObjectRoleStyle(domains, objectId, role) };
    for (const prop of allowed) {
      const value = patch[prop];
      if (value === undefined) continue;
      const coerced = coerceStylePropValue(prop, value);
      if (coerced === null) continue;
      style[prop] = coerced;
    }
    if (styleIsEmpty(style)) delete objectRoles[key];
    else objectRoles[key] = style;
  }
  return writeStyleDomains(config, { ...domains, objectRoles });
}

/** 清掉若干对象的某个角色覆盖（W3；恢复继承）。 */
export function clearObjectRole(
  config: ResumeFormatConfig | undefined | null,
  objectIds: readonly string[],
  role: ResumeRoleKey,
): ResumeFormatConfig {
  const domains = readStyleDomains(config);
  const objectRoles = { ...domains.objectRoles };
  let changed = false;
  for (const objectId of objectIds) {
    const key = objectRoleKey(objectId, role);
    if (!(key in objectRoles)) continue;
    delete objectRoles[key];
    changed = true;
  }
  if (!changed) return (config ?? {}) as ResumeFormatConfig;
  return writeStyleDomains(config, { ...domains, objectRoles });
}

/** 判定某个属性的来源（对象角色 > 对象 > 角色 > 版式扁平键 > 模板）。 */
export function styleSourceOf(
  config: ResumeFormatConfig | undefined | null,
  params: { role: ResumeRoleKey; prop: StylePropKey; objectId?: string | null },
): ResumeStyleSource {
  const domains = readStyleDomains(config);
  const objectRoleStyle = params.objectId
    ? domains.objectRoles[objectRoleKey(params.objectId, params.role)]
    : undefined;
  if (isStylePropSet(objectRoleStyle, params.prop)) return "object";
  const objectStyle = params.objectId ? domains.objects[params.objectId] : undefined;
  if (isStylePropSet(objectStyle, params.prop)) return "object";
  if (isStylePropSet(domains.roles[params.role], params.prop)) return "role";
  const flatKeys = FLAT_PROP_KEYS[params.prop] ?? [];
  if (flatKeys.some((flatKey) => config?.[flatKey] !== undefined)) return "resume";
  return "template";
}

/**
 * 角色基准字号（模板投影值）：目录 `template_role_defaults[template][role].font_scale`。
 *
 * 后端语义（`resume_style._role_rule`）：角色 `font_scale` 存的是**乘在模板基准上的系数**
 * ，真实字号 = `--fs × 系数 × 基准`。所以：
 * - **存**的值是系数（默认 1 = 不覆盖）；
 * - **显示**的生效比例 = 系数 × 基准（用户看到"1.86×"而不是"1.00×"）。
 * 两者不能混用（把 1.86 当系数写回去会把字号翻倍）。
 */
export function roleBaseRatio(templateDefaults: ResumeRoleStyle | null | undefined): number {
  const base = templateDefaults?.["font_scale"];
  return typeof base === "number" && Number.isFinite(base) && base > 0 ? base : 1;
}

/**
 * 存值 → 显示值：只有 `font_scale` 需要乘基准，其余属性存什么显示什么。
 *
 * `stored` 为 `undefined` 时返回继承显示值（基准本身）；因此"来自模板"的读数不是 1.00。
 */
export function displayStyleValue(
  prop: StylePropKey,
  stored: ResumeStyleValue | undefined,
  baseRatio: number,
): ResumeStyleValue | undefined {
  if (prop !== "font_scale") return stored;
  const coefficient = typeof stored === "number" ? stored : 1;
  return Math.round(coefficient * baseRatio * 100) / 100;
}

/** 显示值 → 存值：`font_scale` 除以基准；未设置保持 undefined。 */
export function storedStyleValue(
  prop: StylePropKey,
  displayed: ResumeStyleValue | null,
  baseRatio: number,
): ResumeStyleValue | null {
  if (displayed === null) return null;
  if (prop !== "font_scale") return displayed;
  if (typeof displayed !== "number" || !Number.isFinite(displayed) || !(baseRatio > 0)) {
    return null;
  }
  // 4 位小数：显示值 2 位小数除以基准后仍能精确还原（1.88 / 1.86 → 1.0108）。
  return Math.round((displayed / baseRatio) * 10000) / 10000;
}

/**
 * 生效值（**显示口径**）：对象角色 > 对象 > 角色 > 目录模板基准 > 中性兜底。
 *
 * `font_scale` 返回的是"系数 × 基准"的显示比例；写回时必须经
 * `storedStyleValue` 转回系数，否则会把基准重复乘一次。
 */
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
  const objectRoleStyle = params.objectId
    ? domains.objectRoles[objectRoleKey(params.objectId, params.role)]
    : undefined;
  const objectRoleValue = coerceStylePropValue(params.prop, objectRoleStyle?.[params.prop]);
  if (objectRoleValue !== null) return displayStyleValue(params.prop, objectRoleValue, base);
  const objectStyle = params.objectId ? domains.objects[params.objectId] : undefined;
  const objectValue = coerceStylePropValue(params.prop, objectStyle?.[params.prop]);
  if (objectValue !== null) return displayStyleValue(params.prop, objectValue, base);
  const roleValue = coerceStylePropValue(params.prop, domains.roles[params.role]?.[params.prop]);
  if (roleValue !== null) return displayStyleValue(params.prop, roleValue, base);
  const templateValue = coerceStylePropValue(params.prop, params.templateDefaults?.[params.prop]);
  // 模板默认本身就是"基准"：字号显示为基准比例，其余属性显示默认值。
  if (templateValue !== null) return templateValue;
  return STYLE_PROP_FALLBACKS[params.prop];
}

/**
 * 一条显式覆盖里"哪些属性是用户设过的"（格式刷差集与来源标签共用）。
 *
 * 返回的键序固定为 `OBJECT_STYLE_PROPS` 的顺序，界面按稳定顺序渲染，不随对象键序抖动。
 */
export function explicitObjectProps(style: ResumeRoleStyle): StylePropKey[] {
  return OBJECT_STYLE_PROPS.filter((prop) => isStylePropSet(style, prop));
}
