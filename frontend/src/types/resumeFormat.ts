// SPDX-License-Identifier: Apache-2.0
/** 版式覆盖的类型定义，单独成文件是为了避免 `resume.ts` ↔ `templateMarket.ts`
 *  互相引用（resume.ts 已经引用了 TemplateMarketPreset）。
 *
 *  键取自 `ResumeFormatField.key`，值都是数值（颜色也是十六进制字符串）。
 *  例外是 `section_order`：它是一串分区键，不是 CSS 数值（见 utils/resumeSectionOrder.ts）。 */
export type ResumeFormatConfig = Record<string, number | string | string[]>;

export interface ResumeFormatField {
  key: string;
  label: string;
  /**
   * 英文显示名（后端附加键，旧目录没有）。
   *
   * 只在英文界面用，取不到回落 `label`——判断只有一处，见
   * `utils/resumeFormatLabels.ts::formatFieldLabel`。
   */
  label_en?: string;
  type: "color" | "number";
  min?: number;
  max?: number;
  step?: number;
  description?: string;
  /** `description` 的英文版，规则同 `label_en`。 */
  description_en?: string;
  /**
   * 编辑器分区名（后端附加键，定义在 `resume_format_groups.py`）。
   *
   * 它**既是中文分组正名也是分区键**：同一 `group` 的字段连成一片，分区顺序 =
   * 字段在目录里**首次出现的顺序**（前端不另维护一份组顺序，否则会和后端的字段
   * 顺序漂成两套）。旧后端不下发时为空串，归入"无组头"的收尾区照常渲染。
   */
  group?: string;
  /** `group` 的英文名，规则同 `label_en`（为空串时回落到 `group`）。 */
  group_en?: string;
  /**
   * 这一项依赖的模板能力。目前只有一种：`"header_border"` = 模板必须带页眉线，
   * 否则改它不会有任何效果（`header_rule_gap`）。
   *
   * 有值时前端按当前模板的 `header_border_width > 0`（目录 `template_layouts`）
   * 决定是否禁用；**后端不据此校验**，它只是展示元数据。
   */
  requires?: string;
}
