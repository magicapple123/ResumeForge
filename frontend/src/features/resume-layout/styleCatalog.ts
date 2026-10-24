// SPDX-License-Identifier: Apache-2.0
/**
 * W07 局部排版的**角色目录**：六个段落角色、每个角色可用的属性、对象级属性、角色名。
 *
 * 与操作层（`styleOverrides.ts`）拆开的理由：这张表是"界面做减法"的数据，被角色面板、
 * 对象面板、格式刷、来源标签共用；操作层只负责按域读写。两张表混在一个文件里时，
 * 改一条属性可用性要滚过 300 行读写逻辑才能确认改的是唯一一份。
 *
 * 可用属性与后端 `resume_style_schema.STYLE_PROPS` 的"可用角色"列逐项相等
 * （wave2 契约 §2.2）；后端 W07-BE 落地后由两侧测试各钉一份。
 */
import type { MessageKey } from "../../i18n";
import type { StylePropKey } from "../../utils/resumeStyleParams";

/** 六个段落角色（与后端 `resume_style_schema.ROLES` 逐字相等）。 */
export const RESUME_ROLES = [
  "name",
  "section_title",
  "entry_title",
  "body",
  "meta",
  "emphasis",
] as const;

export type ResumeRoleKey = (typeof RESUME_ROLES)[number];

/**
 * 每个角色可用的属性（顺序即面板行序）。
 *
 * "姓名字号不会让你调行距、正文不会让你调字距"——替用户做减法就靠这张表。
 */
export const ROLE_STYLE_PROPS: Record<ResumeRoleKey, readonly StylePropKey[]> = {
  name: ["font_scale", "color", "bold", "italic", "letter_spacing"],
  section_title: [
    "font_scale",
    "color",
    "bold",
    "italic",
    "space_before",
    "space_after",
    "align",
    "letter_spacing",
  ],
  entry_title: [
    "font_scale",
    "color",
    "bold",
    "italic",
    "space_before",
    "space_after",
    "line_height",
    "align",
  ],
  body: [
    "font_scale",
    "color",
    "bold",
    "italic",
    "space_before",
    "space_after",
    "line_height",
    "indent",
    "bullet",
    "align",
  ],
  meta: ["font_scale", "color", "bold", "italic", "meta_align"],
  emphasis: ["font_scale", "color", "bold", "italic", "space_before", "space_after", "line_height"],
};

/**
 * 对象级可调属性：与后端 `resume_style_schema.OBJECT_PROPS` **逐键相等**（= 全部 12 项）。
 *
 * 注意语义：对象上的 `font_scale` 同样是"乘在对象基准上的系数"（后端 `entry_style_css`
 * 的 base_ratios 对对象恒为 1.0），不是绝对比例。
 */
export const OBJECT_STYLE_PROPS: readonly StylePropKey[] = [
  "font_scale",
  "color",
  "bold",
  "italic",
  "space_before",
  "space_after",
  "line_height",
  "indent",
  "bullet",
  "align",
  "meta_align",
  "letter_spacing",
];

/** 角色名（词条键；界面上不许出现中文常量）。 */
export const ROLE_LABELS: Record<ResumeRoleKey, MessageKey> = {
  name: "typography.role.name",
  section_title: "typography.role.section_title",
  entry_title: "typography.role.entry_title",
  body: "typography.role.body",
  meta: "typography.role.meta",
  emphasis: "typography.role.emphasis",
};
