// SPDX-License-Identifier: Apache-2.0
/**
 * 「条目排版」面板的**属性分组**（I-21）。
 *
 * 11 个属性平铺时，右键浮层实测高 536px：点击点 y=522、视口 900，下方只剩 378px，
 * `placeMenu` 只能把它夹到 y≈356，正好压住触发行上方的内容。300px 宽的卡里两条
 * 滑杆行 + 两条下拉行 + 四个数值行，无论怎么压间距都塞不进 360px。
 *
 * 所以浮层把行按"用户心智里的四件事"折成四组，一次只展开一组（手风琴，见
 * `ObjectStylePanel` 的 `collapsibleGroups`）：高度只跟**最高的那一组**有关，不随点击累积。
 * 左栏参数面板仍然是平铺的——那里有纵向空间，分组只是多两次点击。
 *
 * 分组口径（不是按实现分类，是按用户问的问题分类）：
 *
 * | 组 | 用户的问题 | 属性 |
 * | --- | --- | --- |
 * | text | 字长什么样 | 字号比例 / 加粗 / 颜色 |
 * | spacing | 上下留多少空 | 行距 / 段前距 / 段后距 / 缩进 |
 * | list | 怎么排 | 项目符号 / 对齐 |
 * | meta | 日期那半 | 日期位置 / 字距 |
 *
 * 覆盖面由 `objectStyleGroups.test.ts` 钉住：`OBJECT_STYLE_PROPS` 的每一项恰好落在
 * 一组里。加属性时先想清楚它归哪一组，别在面板里再 filter 一遍。
 */
import type { MessageKey } from "../../../i18n";
import type { StylePropKey } from "../../../utils/resumeStyleParams";

export type ObjectStyleGroupId = "text" | "spacing" | "list" | "meta";

export interface ObjectStyleGroup {
  id: ObjectStyleGroupId;
  /** 组头文案（单行；展开箭头由组件给）。 */
  label: MessageKey;
  props: readonly StylePropKey[];
}

export const OBJECT_STYLE_GROUP_LABELS: Record<ObjectStyleGroupId, MessageKey> = {
  text: "typography.objectGroup.text",
  spacing: "typography.objectGroup.spacing",
  list: "typography.objectGroup.list",
  meta: "typography.objectGroup.meta",
};

/** 组序 = 界面顺序 = 默认展开哪一组的依据（第一组）。 */
export const OBJECT_STYLE_GROUPS: readonly ObjectStyleGroup[] = [
  {
    id: "text",
    label: OBJECT_STYLE_GROUP_LABELS.text,
    props: ["font_scale", "bold", "color"],
  },
  {
    id: "spacing",
    label: OBJECT_STYLE_GROUP_LABELS.spacing,
    props: ["line_height", "space_before", "space_after", "indent"],
  },
  {
    id: "list",
    label: OBJECT_STYLE_GROUP_LABELS.list,
    props: ["bullet", "align"],
  },
  {
    id: "meta",
    label: OBJECT_STYLE_GROUP_LABELS.meta,
    props: ["meta_align", "letter_spacing"],
  },
];

export interface GroupedStyleRows {
  group: ObjectStyleGroup;
  /** 该组在当前作用范围下真的要显示的属性（按调用方给的顺序）。 */
  rows: StylePropKey[];
}

/**
 * 把当前作用范围的行清单折成组：**空组整块不渲染**——组头必须能点开见到东西，
 * 只剩一个空壳的组头既占高度又骗点击（单字段作用域里 `meta_align` 已被
 * `FIELD_EXCLUDED_PROPS` 去掉，灰字字段就没有「日期位置」）。
 *
 * 不在任何组里的属性兜到第一组末尾：宁可在界面上出现，也不静默吞掉一个属性
 * （覆盖面本来由测试钉住，这一支只是防御）。
 */
export function groupStyleRows(rows: readonly StylePropKey[]): GroupedStyleRows[] {
  const grouped = OBJECT_STYLE_GROUPS.map((group) => ({
    group,
    rows: rows.filter((prop) => group.props.includes(prop)),
  })).filter((entry) => entry.rows.length > 0);
  const orphans = rows.filter((prop) => !OBJECT_STYLE_GROUPS.some((g) => g.props.includes(prop)));
  if (orphans.length && grouped.length) {
    grouped[0].rows.push(...orphans);
  }
  return grouped;
}
