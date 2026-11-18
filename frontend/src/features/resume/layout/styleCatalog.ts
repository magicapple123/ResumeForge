// SPDX-License-Identifier: Apache-2.0
/**
 * W07 局部排版的**角色目录**：五个段落角色、每个角色可用的属性、对象级属性、角色名。
 *
 * 与操作层（`styleOverrides.ts`）拆开的理由：这张表是"界面做减法"的数据，被角色面板、
 * 对象面板、来源标签共用；操作层只负责按域读写。两张表混在一个文件里时，
 * 改一条属性可用性要滚过 300 行读写逻辑才能确认改的是唯一一份。
 *
 * 可用属性与后端 `resume_style_schema.STYLE_PROPS` 的"可用角色"列逐项相等
 * （wave2 契约 §2.2）；后端 W07-BE 落地后由两侧测试各钉一份。
 */
import type { MessageKey } from "../../../i18n";
import type { StylePropKey } from "../../../utils/resumeStyleParams";

/**
 * 五个段落角色（与后端 `resume_style_schema.ROLES` 逐字相等）。
 *
 * Q15 删掉了 emphasis（「重点文字」）：planner 从不产出该角色、模板也没有对应
 * `data-role`，PDF/Word 从不查询它——留着只会让用户在面板里调一个永不生效的项。
 */
export const RESUME_ROLES = [
  "name",
  "section_title",
  "entry_title",
  "body",
  "meta",
  "field_label",
] as const;

export type ResumeRoleKey = (typeof RESUME_ROLES)[number];

/**
 * 每个角色可用的属性（顺序即面板行序）。
 *
 * "姓名字号不会让你调行距、正文不会让你调字距"——替用户做减法就靠这张表。
 */
export const ROLE_STYLE_PROPS: Record<ResumeRoleKey, readonly StylePropKey[]> = {
  name: ["font_scale", "color", "bold", "letter_spacing"],
  section_title: [
    "font_scale",
    "color",
    "bold",
    "space_before",
    "space_after",
    "align",
    "letter_spacing",
  ],
  entry_title: [
    "font_scale",
    "color",
    "bold",
    "space_before",
    "space_after",
    "line_height",
    "align",
    // Q11：字距放开到条目头（HTML / Word / PDF 三个出口都能表达）。
    "letter_spacing",
  ],
  body: [
    "font_scale",
    "color",
    "bold",
    "space_before",
    "space_after",
    "line_height",
    "indent",
    "bullet",
    "align",
    // Q11：字距放开到正文。
    "letter_spacing",
  ],
  meta: ["font_scale", "color", "bold", "meta_align"],
  field_label: ["font_scale", "color", "bold", "letter_spacing"],
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
  field_label: "typography.role.field_label",
};

/**
 * 字段作用域（`object_roles["<字段路径>:<role>"]`）里**没有落点**的属性（DF-8）。
 *
 * 只列 `meta_align`：它写的是条目头 flex 容器的 `justify-content`，字段层没有这个容器，
 * PDF / Word 也从不按字段路径读它。面板给滑杆只会"拖了没反应"。
 * 与后端 `resume_style_schema.FIELD_EXCLUDED_PROPS` **逐项相等**（`styleParity.test.ts` 钉住）。
 */
export const FIELD_EXCLUDED_PROPS: readonly StylePropKey[] = ["meta_align"];

/**
 * 字段作用域真正有落点的属性 = 角色属性去掉 `FIELD_EXCLUDED_PROPS`。
 *
 * 与后端 `resume_style_schema.FIELD_ROLE_PROPS` 逐项相等。`indent` / `bullet` 有落点：
 * 后端把它们写到承载字段的 `li` / `p.body-paragraph` 上（DF-8），所以能留在面板里。
 *
 * 由 `ROLE_STYLE_PROPS` **推导**而不是逐角色手写六行：手写那版把角色名当实参
 * （`body: reachableForField("body")`），
 * 属性名 `body` 恰在 `COPY_PROPERTIES` 里、而值又是调用表达式，AST 文案守卫会把这个
 * 技术枚举值当成"新增产品文案"（`cjkRatchet.test.ts`：unregistered product copy）。
 * 循环里没有字面量，既不会被误判，也不会漏掉将来新增的角色。
 */
export const FIELD_STYLE_PROPS: Record<ResumeRoleKey, readonly StylePropKey[]> = (() => {
  const result = {} as Record<ResumeRoleKey, readonly StylePropKey[]>;
  for (const role of Object.keys(ROLE_STYLE_PROPS) as ResumeRoleKey[]) {
    result[role] = ROLE_STYLE_PROPS[role].filter((prop) => !FIELD_EXCLUDED_PROPS.includes(prop));
  }
  return result;
})();

/**
 * 角色 → 「控制纸面哪里」的一句说明（F25）。
 *
 * 只写名字时用户分不清「字段名」调的是值前面的「技术栈：」还是值本身；这六句是
 * 折叠头第二行的常驻小字，**必须能在收起状态看到**，所以放在这里而不是展开后的正文。
 * 每条 ≤14 字：一行放得下，窄栏也不会折成三行。
 */
export const ROLE_HINTS: Record<ResumeRoleKey, MessageKey> = {
  name: "typography.role.hint.name",
  section_title: "typography.role.hint.section_title",
  entry_title: "typography.role.hint.entry_title",
  body: "typography.role.hint.body",
  meta: "typography.role.hint.meta",
  field_label: "typography.role.hint.field_label",
};
