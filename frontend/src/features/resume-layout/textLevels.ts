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
import type { ResumeRoleStyle, ResumeStyleDomains } from "./styleOverrides";
import { readStyleDomains, withObjectProps, writeStyleDomains } from "./styleOverrides";

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

/** 级别的显示名（词条键；界面与成功提示共用，不在组件里写中文常量）。 */
export const TEXT_LEVEL_LABELS: Record<TextLevelId, MessageKey> = {
  heading1: "typography.level.heading1",
  heading2: "typography.level.heading2",
  heading3: "typography.level.heading3",
  body: "typography.level.body",
  caption: "typography.level.caption",
};

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

/** 单个对象上的级别状态（读宽容：非法值已在 `readStyleDomains` 里被丢弃）。 */
export function readObjectTextLevel(
  domains: ResumeStyleDomains,
  objectId: string,
): Exclude<TextLevelState, { kind: "mixed" }> {
  const style = domains.objects[objectId];
  if (!style) return { kind: "inherit" };
  const hasLevelProp = TEXT_LEVEL_PROPS.some((prop) => isStylePropSet(style, prop));
  if (!hasLevelProp) return { kind: "inherit" };
  const matched = TEXT_LEVEL_SPECS.find((spec) =>
    TEXT_LEVEL_PROPS.every((prop) => {
      const stored = readStylePropValue(prop, style[prop]);
      return stored !== null && stored === spec.patch[prop];
    }),
  );
  return matched ? { kind: "level", level: matched.id } : { kind: "custom" };
}

/** 一组目标的共同级别状态：全一致给那一档，否则 `mixed`；空集合按跟随模板处理。 */
export function readTextLevelState(
  domains: ResumeStyleDomains,
  objectIds: readonly string[],
): TextLevelState {
  if (objectIds.length === 0) return { kind: "inherit" };
  let first: TextLevelState | null = null;
  for (const objectId of objectIds) {
    const state = readObjectTextLevel(domains, objectId);
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
 * 应用一个级别：一次写入全部目标（多选批量 = 一次 `onChange` = 历史一步）。
 *
 * 逐条保留目标自己的其它覆盖（颜色等）；级别管理的四项被级别定义整体替换。
 */
export function applyTextLevel(
  config: ResumeFormatConfig | undefined | null,
  objectIds: readonly string[],
  level: TextLevelId,
): ResumeFormatConfig {
  if (objectIds.length === 0) return (config ?? {}) as ResumeFormatConfig;
  return withObjectProps(config, objectIds, textLevelPatch(level));
}

/**
 * 恢复跟随模板：只删级别管理的四项（保留颜色/缩进等手动取舍），空对象条目整条删掉。
 *
 * 与"写回默认值"不同：删键才是继承（契约 R3）；写 0/1/false 会把"跟随模板"固化成覆盖。
 */
export function clearTextLevel(
  config: ResumeFormatConfig | undefined | null,
  objectIds: readonly string[],
): ResumeFormatConfig {
  const domains = readStyleDomains(config);
  const objects = { ...domains.objects };
  let changed = false;
  for (const objectId of objectIds) {
    const style = objects[objectId];
    if (!style) continue;
    const next: ResumeRoleStyle = { ...style };
    for (const prop of TEXT_LEVEL_PROPS) delete next[prop];
    if (styleIsEmpty(next)) delete objects[objectId];
    else objects[objectId] = next;
    changed = true;
  }
  if (!changed) return (config ?? {}) as ResumeFormatConfig;
  return writeStyleDomains(config, { roles: domains.roles, objects });
}
