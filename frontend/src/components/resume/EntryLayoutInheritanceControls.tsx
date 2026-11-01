// SPDX-License-Identifier: Apache-2.0
/**
 * 条目字段排版的「分栏」控件（列数 / 对齐方式 / 列间距）。
 *
 * R-11（审计）改造：
 * - 「继承」变成每个控件的**第一个选项**（列数：继承 / 1 / 2 / 3，对齐：继承 / 等宽列 /
 *   按内容排），选它就等于把 `entry.layout.X` 置回 `null`，不再靠右侧的
 *   SourceBadge + 逐项「恢复继承」按钮——那套标记在 360px 左栏里挤掉了控件本身；
 * - Segmented 的 `value` **不能用 `null`**（antd 会当成"没有选中项"），所以用哨兵
 *   字符串 `"inherit"`；
 * - 列间距仍用 `InputNumber`（清空 = 继承），因为它没有天然的三选一形态。
 *
 * 板块级（`overrides === null`）没有"继承"可选：板块层就是来源本身。
 */
import { InputNumber, Segmented } from "antd";
import { t } from "../../i18n";
import type {
  EntryLayoutOverrides,
  LayoutAlign,
  LayoutColumns,
} from "../../features/resume-layout/entryLayoutModel";
import type { EntryLayout, SectionLayout } from "../../types/resumeDocument";
import { useLocale } from "../../i18n/i18nContext";

/**
 * 面板级的布局 patch。条目级三项可写 `null`（= 恢复继承），所以这里把 `columns` /
 * `align` 单独放宽：`Partial<SectionLayout> & Partial<EntryLayout>` 的交集会收窄掉 null。
 */
export type LayoutPatch = Partial<Omit<SectionLayout, "columns" | "align">> &
  Partial<Omit<EntryLayout, "columns" | "align">> & {
    columns?: LayoutColumns | null;
    align?: LayoutAlign | null;
  };

interface Props {
  columns: LayoutColumns;
  align: LayoutAlign;
  gap: number | null;
  /** null = 板块级（没有可继承项，「继承」选项禁用）。 */
  overrides: EntryLayoutOverrides | null;
  disabled: boolean;
  /** 面板宽度 ≤420px：分段控件竖排（antd 的 vertical，纯 CSS 会让选中态失高亮）。 */
  narrow?: boolean;
  onPatch: (patch: LayoutPatch) => void;
}

/** Segmented 的"继承"哨兵值：antd 的 value 不能用 null。 */
const INHERIT = "inherit";

const COLUMN_VALUES: LayoutColumns[] = [1, 2, 3];

export default function EntryLayoutInheritanceControls({
  columns,
  align,
  gap,
  overrides,
  disabled,
  narrow = false,
  onPatch,
}: Props) {
  useLocale();
  const inheritable = overrides !== null;
  const columnsInherited = inheritable && !overrides.columns;
  const alignInherited = inheritable && !overrides.align;
  // 条目级：覆盖项显示自己的值，没覆盖时显示哨兵值。
  const columnsValue = columnsInherited ? INHERIT : String(columns);
  const alignValue = alignInherited ? INHERIT : align;

  const columnOptions = [
    // 板块级没有可继承的对象：保留这一项（禁用）而不是删掉——选项数变化会让
    // 360px 竖排的分段控件高度变 28px，切范围时面板就跟着跳（R-11 验收）。
    { value: INHERIT, label: t("structure.layout.inherit"), disabled: !inheritable },
    ...COLUMN_VALUES.map((value) => ({ value: String(value), label: String(value) })),
  ];
  const alignOptions = [
    { value: INHERIT, label: t("structure.layout.inherit"), disabled: !inheritable },
    { value: "equal", label: t("structure.layout.align.equal") },
    { value: "flow", label: t("structure.layout.align.flow") },
  ];

  return (
    <>
      <div className="rf-entry-layout-row">
        <span className="rf-entry-layout-label">{t("structure.layout.columns")}</span>
        <Segmented
          className="rf-entry-layout-control"
          size="small"
          block
          vertical={narrow}
          value={columnsValue}
          disabled={disabled}
          aria-label={t("structure.layout.columns")}
          options={columnOptions}
          onChange={(value) => {
            if (value === INHERIT) {
              onPatch({ columns: null });
              return;
            }
            onPatch({ columns: Number(value) as LayoutColumns });
          }}
        />
      </div>
      <div className="rf-entry-layout-row">
        <span className="rf-entry-layout-label">{t("structure.layout.align")}</span>
        <Segmented
          className="rf-entry-layout-control"
          size="small"
          block
          vertical={narrow}
          value={alignValue}
          disabled={disabled}
          aria-label={t("structure.layout.align")}
          options={alignOptions}
          onChange={(value) => {
            if (value === INHERIT) {
              onPatch({ align: null });
              return;
            }
            onPatch({ align: value as LayoutAlign });
          }}
        />
      </div>
      <div className="rf-entry-layout-row">
        <span className="rf-entry-layout-label">{t("structure.layout.gap")}</span>
        <InputNumber
          size="small"
          min={0}
          max={4}
          step={0.25}
          value={gap ?? undefined}
          placeholder={t("structure.layout.inherit")}
          disabled={disabled}
          aria-label={t("structure.layout.gap")}
          onChange={(value) => onPatch({ gap: typeof value === "number" ? value : null })}
        />
      </div>
    </>
  );
}
