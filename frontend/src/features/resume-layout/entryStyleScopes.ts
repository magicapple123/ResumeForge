// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目排版」的**作用范围**（Q12）：一条内容可以整体调，也可以只调条目头 / 正文 / 灰字。
 *
 * ## 为什么需要作用范围
 *
 * 之前「条目排版」的 8 个属性都写进 `format_config.objects[<entryId>]`（= 整条）：想只把
 * 日期靠右、只给正文加缩进，结果标题、日期一起动；反过来有些项在整条上本来就没什么用。
 * Q12 把同一块面板按范围拆分，落点各自独立：
 *
 * | 范围 | 落点 | 读法（PDF/Word/HTML 同一口径） |
 * | --- | --- | --- |
 * | 整条 | `objects[<entryId>]`（兼容旧数据，不迁移） | 对象层 |
 * | 条目头 | `object_roles["<id>:entry_title"]` | effective(entry_title, id) |
 * | 正文 | `object_roles["<id>:body"]` | effective(body, id) |
 * | 灰字 | `object_roles["<id>:meta"]` | effective(meta, id) |
 *
 * ## 行清单从角色白名单推导
 *
 * 每个范围显示哪些属性不是手写第二份清单：取该范围角色的 `ROLE_STYLE_PROPS`（与后端
 * `resume_style_schema.ROLE_PROPS` 逐项相等），再去掉「文字级别」已经管理的四项——
 * 两个控件写同一个键会互相覆盖（2026-10-29 用户反馈"手改的不生效"的根因）。
 */
import type { MessageKey } from "../../i18n";
import type { StylePropKey } from "../../utils/resumeStyleParams";
import type { ResumeEntry } from "../../types/resumeDocument";
import { getItemPlacement } from "../resume-document/placement";
import { OBJECT_STYLE_PROPS, ROLE_STYLE_PROPS, type ResumeRoleKey } from "./styleCatalog";
import { TEXT_LEVEL_PROPS, type TextLevelScope } from "./textLevels";

/** 作用范围就是「条目内部实际存在的三个角色」+ 整条（与文字级别的范围同一套取值）。 */
export type EntryStyleScope = TextLevelScope;

export const ENTRY_STYLE_SCOPES: readonly EntryStyleScope[] = [
  "object",
  "entry_title",
  "body",
  "meta",
];

export const ENTRY_STYLE_SCOPE_LABELS: Record<EntryStyleScope, MessageKey> = {
  object: "typography.entryStyle.scope.object",
  entry_title: "typography.entryStyle.scope.entry_title",
  body: "typography.entryStyle.scope.body",
  meta: "typography.entryStyle.scope.meta",
};

/** 段控下方的一句范围说明：说清"这次只动哪一块"，不写操作步骤。 */
export const ENTRY_STYLE_SCOPE_HINTS: Record<EntryStyleScope, MessageKey> = {
  object: "typography.entryStyle.scopeHint.object",
  entry_title: "typography.entryStyle.scopeHint.entry_title",
  body: "typography.entryStyle.scopeHint.body",
  meta: "typography.entryStyle.scopeHint.meta",
};

/** 来源胶囊：这个范围当前是"已调整"还是"跟随模板"。 */
export const ENTRY_STYLE_SCOPE_SOURCES: Record<EntryStyleScope, MessageKey> = {
  object: "typography.entryStyle.source.object",
  entry_title: "typography.entryStyle.source.entry_title",
  body: "typography.entryStyle.source.body",
  meta: "typography.entryStyle.source.meta",
};

/** 作用范围 → 后端角色；`null` = 整条（写 `objects` 域）。 */
export function entryStyleScopeRole(scope: EntryStyleScope): ResumeRoleKey | null {
  return scope === "object" ? null : scope;
}

/** 条目排版面板管理的属性（= 对象级属性去掉文字级别已管理的四项）。 */
const PANEL_PROPS: readonly StylePropKey[] = OBJECT_STYLE_PROPS.filter(
  (prop) => !TEXT_LEVEL_PROPS.includes(prop),
);

/**
 * 某个作用范围下「条目排版」面板的行清单（按后端角色白名单收窄）。
 *
 * 整条 = 8 项（与 Q12 前逐项一致）；条目头 = 颜色 / 斜体 / 行距 / 对齐 / 字距；
 * 正文 = 颜色 / 斜体 / 行距 / 缩进 / 项目符号 / 对齐 / 字距；灰字 = 颜色 / 斜体 / 日期位置。
 */
export function entryStyleScopeProps(scope: EntryStyleScope): readonly StylePropKey[] {
  if (scope === "object") return PANEL_PROPS;
  const roleProps = ROLE_STYLE_PROPS[scope];
  return PANEL_PROPS.filter((prop) => roleProps.includes(prop));
}

export interface EntryStyleAvailability {
  /** 条目里有没有日期 / 学籍 / 地点这类灰字（决定「日期位置」是否出现）。 */
  hasMeta: boolean;
  /** 条目里有没有正文内容。 */
  hasBody: boolean;
  /** 正文里有没有真正会排成项目符号的块（列表 / body_style=bullet 的字段）。 */
  hasBullets: boolean;
}

/** 条目内容 → 面板可用性（无日期字段不显示日期位置；无要点时项目符号灰显说明）。 */
export function entryStyleAvailability(
  entry: ResumeEntry | null | undefined,
): EntryStyleAvailability {
  let hasMeta = false;
  let hasBody = false;
  let hasBullets = false;
  for (const item of entry?.items ?? []) {
    const placement = getItemPlacement(item);
    if (placement === "meta" || placement === "lead" || placement === "trail") hasMeta = true;
    if (placement !== "body") continue;
    hasBody = true;
    if (item.kind === "list") hasBullets = true;
    if (item.kind === "field" && item.body_style === "bullet") hasBullets = true;
    // TextItem 的正文风格字段叫 style（没有 placement，hidden 时是 hidden）。
    if (item.kind === "text" && item.style === "bullet") hasBullets = true;
  }
  return { hasMeta, hasBody, hasBullets };
}
