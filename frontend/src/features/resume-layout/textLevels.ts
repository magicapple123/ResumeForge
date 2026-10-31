// SPDX-License-Identifier: Apache-2.0
/**
 * W07-TL「文字级别」的**规则层**：把「一级标题 / 二级标题 / 三级标题 / 正文 / 次要说明」
 * 五个固定级别映射成既有的对象级样式覆盖（`format_config.objects[<object_id>]`）。
 *
 * ## 为什么不新增第二种数据
 *
 * 级别不是新的文档结构，也不该另存一个 `level` 字段：对象覆盖已经是"这一条和同类段落
 * 不一样"的唯一落点。级别 = 一组**固定的覆盖值**，应用级别 = 用 `withObjectProps` 把
 * 这组值并进目标对象；撤销沿用宿主的 layout 提交（W03 历史的一步），重载/导出仍只读
 * `format_config`，所以数据库、`ResumeContent`、PDF/Word 渲染器都不需要改。
 *
 * ## 哪些属性属于"级别"
 *
 * 只有 `TEXT_LEVEL_PROPS` 四项（字号比例 / 加粗 / 段前距 / 段后距）。级别**不碰**颜色、
 * 缩进、项目符号等属性：那些是用户在对象面板里的单独取舍，应用级别不该把它们冲掉；
 * 反过来"恢复跟随模板"也只删这四项，保留用户其它局部调整。
 *
 * ## 级别是"读出来的"，不是"存下来的"
 *
 * 存进库里的只有覆盖值，没有级别名。当前级别由对象上的显式覆盖**反推**（见
 * `readObjectTextLevel`）：四项全部等于某个级别的定义 = 该级别；有级别属性但对不上
 * = 自定义（手改过）；一项都没有 = 跟随模板。这样旧记录、别处手动改过的对象都不会
 * 出现"名字叫一级标题、实际不是"的假状态。
 *
 * ## 不许自动缩字号
 *
 * 级别里的 `font_scale` 是**用户显式选的一个系数**（与对象面板同一个落库语义），
 * 不是"装不下就压小"的自动缩放。渲染侧一个字都不用改。
 */
import type { MessageKey } from "../../i18n";
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import type { StylePropKey } from "../../utils/resumeStyleParams";
import { isStylePropSet, readStylePropValue, styleIsEmpty } from "../../utils/resumeStyleParams";
import { OBJECT_STYLE_PROPS, ROLE_STYLE_PROPS, type ResumeRoleKey } from "./styleCatalog";
import type { ResumeRoleStyle, ResumeStyleDomains } from "./styleOverrides";
import {
  objectRoleKey,
  readObjectRoleStyle,
  readStyleDomains,
  withObjectProps,
  withObjectRoleProps,
  writeStyleDomains,
} from "./styleOverrides";

/** 五个固定级别的 id（与界面顺序、词条键一一对应；落库时不出现这些字符串）。 */
export const TEXT_LEVELS = ["heading1", "heading2", "heading3", "body", "caption"] as const;

export type TextLevelId = (typeof TEXT_LEVELS)[number];

/** 级别管理的四个属性（对象级全部可用；不碰颜色/缩进/项目符号等单独取舍）。 */
export const TEXT_LEVEL_PROPS: readonly StylePropKey[] = [
  "font_scale",
  "bold",
  "space_before",
  "space_after",
];

/**
 * 对象层里**级别不管**的那部分属性：细调面板（`ObjectStylePanel`）只列这些。
 *
 * 为什么取差集而不是各自写一份清单：级别与细调面板写的是同一个
 * `format_config.objects[<id>]`。两边都列字号 / 加粗 / 段前 / 段后时，用户拖着细调
 * 滑杆到 1.15×、再点「二级标题」，整组四项会被级别定义**整体替换**——看起来像
 * "手改的不生效"，实际是两个控件抢同一批键（2026-10-29 用户截图反馈的正是这块）。
 *
 * 口径只有这一处：加属性时先想清楚它归级别还是归细调，别在面板里再 filter 一遍。
 */
export const OBJECT_EXTRA_STYLE_PROPS: readonly StylePropKey[] = OBJECT_STYLE_PROPS.filter(
  (prop) => !TEXT_LEVEL_PROPS.includes(prop),
);

/** 级别的显示名（词条键；界面与成功提示共用，不在组件里写中文常量）。 */
export const TEXT_LEVEL_LABELS: Record<TextLevelId, MessageKey> = {
  heading1: "typography.level.heading1",
  heading2: "typography.level.heading2",
  heading3: "typography.level.heading3",
  body: "typography.level.body",
  caption: "typography.level.caption",
};

/**
 * 「作用范围」的界面取值（W3）：`object` = 整个条目（既有行为），其余是段落角色。
 *
 * 只开放条目内部实际存在的三个角色：条目标题 / 正文 / 元信息（灰字）。name、
 * section_title 不在条目子树里，选它们只会写出一条永远匹配不到的覆盖。
 */
export type TextLevelScope = "object" | "entry_title" | "body" | "meta";

export const TEXT_LEVEL_SCOPES: readonly TextLevelScope[] = [
  "object",
  "entry_title",
  "body",
  "meta",
];

export const TEXT_LEVEL_SCOPE_LABELS: Record<TextLevelScope, MessageKey> = {
  object: "typography.level.scope.object",
  entry_title: "typography.level.scope.entry_title",
  body: "typography.level.scope.body",
  meta: "typography.level.scope.meta",
};

/**
 * 每个作用范围的一句说明（Q13）：段控下方常驻，避免"作用范围"只是个标签。
 *
 * 文案只说会影响哪里，不写操作步骤（不写"点这里"）；四个键与 TEXT_LEVEL_SCOPES 一一对应。
 */
export const TEXT_LEVEL_SCOPE_HINTS: Record<TextLevelScope, MessageKey> = {
  object: "typography.level.scopeHint.object",
  entry_title: "typography.level.scopeHint.entry_title",
  body: "typography.level.scopeHint.body",
  meta: "typography.level.scopeHint.meta",
};

/** 作用范围 → 后端角色；`null` = 整个条目（写 `objects` 域）。 */
export function textLevelScopeRole(scope: TextLevelScope): ResumeRoleKey | null {
  return scope === "object" ? null : scope;
}

/**
 * 纸面字段（`data-resume-path` 的**叶子段**）→ 作用范围。
 *
 * 为什么要这张表：用户点纸面上的"上海财经大学"（`education.0.school`）时，他要调的是
 * **条目标题**的字号，而不是整条——面板默认停在"整个条目"等于让他每次再手动点一次
 * 范围（2026-10-29 反馈"作用范围没有随我选择的字段改变"）。
 *
 * 叶子名来自后端模板真实输出的 `data-resume-path`（`rg 'data-resume-path' templates/`
 * 可核对），不是猜的：条目身份字段（学校/专业/公司/职位）落在 `entry_title`，
 * 时间与学籍类（起止、GPA、排名、院系、导师、形式、类型）落在 `meta`（"说明"），
 * 列表型正文（课程 / 成果 / 要点）落在 `body`。表里没有的（个人信息标量、板块标题）
 * 一律回落到"整个条目"——它们本来就不在条目子树里，给一个更窄的范围只会写出空覆盖。
 */
const FIELD_PATH_SCOPE: Record<string, TextLevelScope> = {
  // 条目标题：这一行的主角（学校 / 公司 / 项目名 / 奖项名 + 专业 / 职位）
  school: "entry_title",
  major: "entry_title",
  degree: "entry_title",
  company: "entry_title",
  role: "entry_title",
  project_name: "entry_title",
  award: "entry_title",
  title: "entry_title",
  // 说明：标题行右侧与下方的时间、学籍、量化信息
  start_date: "meta",
  end_date: "meta",
  gpa: "meta",
  rank: "meta",
  study_form: "meta",
  degree_type: "meta",
  department: "meta",
  advisor: "meta",
  research_direction: "meta",
  experience_kind: "meta",
  // 正文：条目里的列表型内容
  achievements: "body",
  courses: "body",
  description: "body",
  highlights: "body",
  bullets: "body",
  summary: "body",
};

/** 从纸面路径推默认作用范围；推不出来就是"整个条目"（既有行为）。 */
export function scopeForFieldPath(path: string | null | undefined): TextLevelScope {
  if (!path) return "object";
  const leaf =
    path
      .split(".")
      .filter((part) => part.length > 0 && !/^\d+$/.test(part))
      .pop() ?? "";
  return FIELD_PATH_SCOPE[leaf] ?? "object";
}

/** 某个作用范围下级别实际管理的属性：整条目 = 四项；字段范围 = 该角色允许的交集。 */
export function textLevelPropsForScope(role: ResumeRoleKey | null): readonly StylePropKey[] {
  if (role === null) return TEXT_LEVEL_PROPS;
  return TEXT_LEVEL_PROPS.filter((prop) => ROLE_STYLE_PROPS[role].includes(prop));
}

/** 一级别 = 一组显式覆盖（值必须落在 `resumeStyleParams` 的区间内，写入时会再夹紧一次）。 */
interface TextLevelSpec {
  id: TextLevelId;
  patch: ResumeRoleStyle;
}

/**
 * 级别定义。层级靠**字号系数 + 加粗 + 段距**三件事叠加，不使用颜色（颜色随模板强调色，
 * 硬编码色值会让换模板后不一致）也不用行高（行高随整份简历的行距设置走）。
 *
 * 字号系数是"乘在对象基准上"的系数（对象基准恒为 1，见后端 `entry_style_css`），
 * 因此 1.4 就是"比正文大 40%"，不是绝对字号——整份简历的字号档位仍由上面的排版参数决定。
 */
const TEXT_LEVEL_SPECS: readonly TextLevelSpec[] = [
  {
    id: "heading1",
    patch: { font_scale: 1.4, bold: true, space_before: 0.4, space_after: 0.2 },
  },
  {
    id: "heading2",
    patch: { font_scale: 1.2, bold: true, space_before: 0.3, space_after: 0.15 },
  },
  {
    id: "heading3",
    patch: { font_scale: 1.08, bold: true, space_before: 0.2, space_after: 0.1 },
  },
  { id: "body", patch: { font_scale: 1, bold: false, space_before: 0, space_after: 0 } },
  { id: "caption", patch: { font_scale: 0.9, bold: false, space_before: 0, space_after: 0 } },
];

/** 级别定义（副本；调用方改它不会污染模块级表）。 */
export function textLevelPatch(level: TextLevelId): ResumeRoleStyle {
  const spec = TEXT_LEVEL_SPECS.find((item) => item.id === level);
  if (!spec) return {};
  return { ...spec.patch };
}

/** 当前级别状态：跟随模板 / 某个级别 / 自定义（手改过）/ 多个目标不一致。 */
export type TextLevelState =
  | { kind: "inherit" }
  | { kind: "level"; level: TextLevelId }
  | { kind: "custom" }
  | { kind: "mixed" };

/**
 * 级别补丁按作用范围收窄：整条目 = 原样四项；字段范围只保留该角色允许的属性
 * （meta 只有字号/加粗，段距写进去也会被后端丢弃）。
 */
function levelPatchForScope(level: TextLevelId, role: ResumeRoleKey | null): ResumeRoleStyle {
  const patch = textLevelPatch(level);
  if (role === null) return patch;
  const narrowed: ResumeRoleStyle = {};
  for (const prop of textLevelPropsForScope(role)) {
    const value = patch[prop];
    if (value !== undefined) narrowed[prop] = value;
  }
  return narrowed;
}

/** 单个对象（可选：某个角色）上的级别状态（读宽容：非法值已在 readStyleDomains 里丢弃）。 */
export function readObjectTextLevel(
  domains: ResumeStyleDomains,
  objectId: string,
  role: ResumeRoleKey | null = null,
): Exclude<TextLevelState, { kind: "mixed" }> {
  const style =
    role === null ? domains.objects[objectId] : readObjectRoleStyle(domains, objectId, role);
  if (!style) return { kind: "inherit" };
  const props = textLevelPropsForScope(role);
  const hasLevelProp = props.some((prop) => isStylePropSet(style, prop));
  if (!hasLevelProp) return { kind: "inherit" };
  const matched = TEXT_LEVEL_SPECS.find((spec) =>
    props.every((prop) => {
      const stored = readStylePropValue(prop, style[prop]);
      return stored !== null && stored === spec.patch[prop];
    }),
  );
  return matched ? { kind: "level", level: matched.id } : { kind: "custom" };
}

/** 一组目标的共同级别状态：全一致给那一档，否则 mixed；空集合按跟随模板处理。 */
export function readTextLevelState(
  domains: ResumeStyleDomains,
  objectIds: readonly string[],
  role: ResumeRoleKey | null = null,
): TextLevelState {
  if (objectIds.length === 0) return { kind: "inherit" };
  let first: TextLevelState | null = null;
  for (const objectId of objectIds) {
    const state = readObjectTextLevel(domains, objectId, role);
    if (first === null) {
      first = state;
      continue;
    }
    if (state.kind !== first.kind) return { kind: "mixed" };
    if (state.kind === "level" && first.kind === "level" && state.level !== first.level) {
      return { kind: "mixed" };
    }
  }
  return first ?? { kind: "inherit" };
}

/** 状态比较键（测试 / 展示判断用；两个状态相等当且仅当键相等）。 */
export function textLevelStateKey(state: TextLevelState): string {
  return state.kind === "level" ? `level:${state.level}` : state.kind;
}

/**
 * 应用一个级别（整个条目；既有行为，与 W3 前逐字节一致）。
 *
 * 逐条保留目标自己的其它覆盖（颜色等）；级别管理的四项被级别定义整体替换。
 */
export function applyTextLevel(
  config: ResumeFormatConfig | undefined | null,
  objectIds: readonly string[],
  level: TextLevelId,
): ResumeFormatConfig {
  return applyTextLevelToScope(config, objectIds, null, level);
}

/**
 * 按作用范围应用级别（W3）：role=null 写 objects 域（既有行为）；否则只写
 * object_roles["<id>:<role>"]，并收窄成该角色允许的属性。
 *
 * 一次调用只提交一次 onChange（多选批量 = 历史一步）；不适用该角色的对象自然无变化。
 */
export function applyTextLevelToScope(
  config: ResumeFormatConfig | undefined | null,
  objectIds: readonly string[],
  role: ResumeRoleKey | null,
  level: TextLevelId,
): ResumeFormatConfig {
  if (objectIds.length === 0) return (config ?? {}) as ResumeFormatConfig;
  const patch = levelPatchForScope(level, role);
  if (role === null) return withObjectProps(config, objectIds, patch);
  return withObjectRoleProps(config, objectIds, role, patch);
}

/** 恢复跟随模板（整个条目；既有行为）。 */
export function clearTextLevel(
  config: ResumeFormatConfig | undefined | null,
  objectIds: readonly string[],
): ResumeFormatConfig {
  return clearTextLevelScope(config, objectIds, null);
}

/**
 * 按作用范围恢复跟随模板（W3）：只删该范围下级别管理的属性。
 *
 * role=null 与既有 clearTextLevel 逐字节相同（删 objects 里的四项，保留其它局部调整，
 * 空条目整条删掉）；字段范围只删 object_roles 里该角色允许的级别属性，不碰整条目级别。
 * 删键才是继承（契约 R3）；没有可清的目标时返回原配置引用（宿主据此不写库）。
 */
export function clearTextLevelScope(
  config: ResumeFormatConfig | undefined | null,
  objectIds: readonly string[],
  role: ResumeRoleKey | null,
): ResumeFormatConfig {
  const domains = readStyleDomains(config);
  const props = textLevelPropsForScope(role);
  const entries: Record<string, ResumeRoleStyle> =
    role === null ? { ...domains.objects } : { ...domains.objectRoles };
  let changed = false;
  for (const objectId of objectIds) {
    const key = role === null ? objectId : objectRoleKey(objectId, role);
    const style = entries[key];
    if (!style) continue;
    const next: ResumeRoleStyle = { ...style };
    for (const prop of props) delete next[prop];
    if (styleIsEmpty(next)) delete entries[key];
    else entries[key] = next;
    changed = true;
  }
  if (!changed) return (config ?? {}) as ResumeFormatConfig;
  if (role === null) return writeStyleDomains(config, { ...domains, objects: entries });
  return writeStyleDomains(config, { ...domains, objectRoles: entries });
}
