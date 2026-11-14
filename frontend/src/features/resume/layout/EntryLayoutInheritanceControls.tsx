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
 *
 * ## 任务 10：列间距的单位与上限
 *
 * `gap` 的单位是**字号倍数**（后端 `column-gap: calc(var(--fs) * gap)`），不是像素。
 * 所以：上限从 4 放宽到 8，并在旁边显示换算（`4.00 倍字宽 ≈ 56px`），让用户知道
 * 自己调的是"几倍字宽"；三列且每列已被挤到 60px 以下时给一句提示，而不是静默溢出。
 * **不能**改成 px：旧数据里 4 表示 4 倍字宽，改语义会让所有已存的排版错位。
 *
 * ## 问题 4：上限 8 → 16，且「两端」分布下不再误报过窄
 *
 * 需求要求列间距能调到 16 倍字宽（后端 `EntryLayout.gap` 的 `le=16`，分区级仍是 30）。
 * 另外 `justify = "between"` 时剩余空白均分到列之间、`gap` 退化为"最小间距"，**不再
 * 挤压列宽**——所以换算每列宽度时按 0 计，否则调大 gap 会给出"列宽不足"的假警报。
 */
import { Button, InputNumber, Segmented } from "antd";
import { useEffect, useState } from "react";
import { t } from "../../../i18n";
import { columnWidthSum, equalWidths, normalizeColumnWidths } from "./entryColumnGeometry";
import EntryColumnGapControls from "./EntryColumnGapControls";
import EntryColumnSplitControl from "./EntryColumnSplitControl";
import { readPaperMetrics, type PaperMetrics } from "./entryColumnPaperMetrics";
import "./entry-column-controls.css";
import type {
  EntryLayoutOverrides,
  LayoutAlign,
  LayoutColumns,
  LayoutJustify,
} from "./entryLayoutModel";
import type { EntryLayout, SectionLayout } from "../../../types/resumeDocument";
import { useLocale } from "../../../i18n/i18nContext";

/**
 * 面板级的布局 patch。条目级三项可写 `null`（= 恢复继承），所以这里把 `columns` /
 * `align` 单独放宽：`Partial<SectionLayout> & Partial<EntryLayout>` 的交集会收窄掉 null。
 */
export type LayoutPatch = Partial<Omit<SectionLayout, "columns" | "align" | "justify">> &
  Partial<Omit<EntryLayout, "columns" | "align" | "justify">> & {
    columns?: LayoutColumns | null;
    align?: LayoutAlign | null;
    justify?: LayoutJustify | null;
    column_widths?: number[] | null;
    column_gaps?: number[] | null;
  };

interface Props {
  columns: LayoutColumns;
  align: LayoutAlign;
  gap: number | null;
  /** 当前「分布」（问题 4）：只影响过窄提示的换算口径，控件本身在父组件里。 */
  justify?: LayoutJustify;
  /** 逐列宽度（百分比）/ 逐间隔（字号倍数）的生效值；null = 等宽 + 统一 gap。 */
  columnWidths?: number[] | null;
  columnGaps?: number[] | null;
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

export { columnWidthSum, equalWidths, gapGeometry, initialGaps } from "./entryColumnGeometry";
export type { GapGeometry } from "./entryColumnGeometry";

export default function EntryLayoutInheritanceControls({
  columns,
  align,
  gap,
  justify = "start",
  columnWidths = null,
  columnGaps = null,
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

  /**
   * 纸面的两个尺寸（字号基准 + 内容宽）。每次渲染后重读一次：档位/系数改了、栏宽改了、
   * 换模板了都会体现在这里，而组件拿不到 layout 通道（只经 `onPatch` 往上写）。
   * `setState` 传函数并比对旧值，读到的数字没变时 React 会直接 bail out，不会死循环。
   */
  const [paperPx, setPaperPx] = useState<PaperMetrics>({ font: null, content: null });
  useEffect(() => {
    const next = readPaperMetrics();
    setPaperPx((prev) => (prev.font === next.font && prev.content === next.content ? prev : next));
  });

  /**
   * 逐列宽度 / 逐间隔的草稿（任务 13）。
   *
   * 为什么要草稿：这两行是"填几个数再一起应用"，每键都写回会把单列改成 33% 的瞬间
   * 状态落进文档、纸面跟着跳。草稿用**渲染期对齐**（不写 effect）：外部值一变
   * （切板块、切范围、恢复等宽）就用签名比对重置，与 `EntryLayoutPanel` 对齐 entryId
   * 的做法同一个模式。
   */
  const geometrySignature = JSON.stringify([columns, columnWidths, columnGaps, gap]);
  const [draftKey, setDraftKey] = useState(geometrySignature);
  const [draftWidths, setDraftWidths] = useState<number[]>(columnWidths ?? equalWidths(columns));
  if (draftKey !== geometrySignature) {
    setDraftKey(geometrySignature);
    setDraftWidths(columnWidths ?? equalWidths(columns));
  }
  const widthTotal = columnWidthSum(draftWidths);
  const canApplyWidths = Math.abs(widthTotal - 100) <= 0.5 && !disabled;

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
      {columns > 1 && align === "equal" ? (
        <>
          <div className="rf-entry-layout-row">
            <span className="rf-entry-layout-label">{t("structure.layout.widths")}</span>
            <div className="rf-entry-layout-stack">
              <EntryColumnSplitControl
                widths={columnWidths?.length === columns ? columnWidths : equalWidths(columns)}
                disabled={disabled}
                onChange={(widths) => onPatch({ column_widths: widths })}
              />
              <div
                className="rf-entry-layout-number-row"
                role="group"
                aria-label={t("structure.layout.widths")}
                // 归一化只在**焦点离开整组**时做：每个输入框各自 onBlur 会在
                // "输入第一格 → 点第二格"的瞬间就归一化，把第一格刚填的数按旧值缩放，
                // 于是 33/33 永远输不进去（2026-11-13 实机复现）。
                onBlur={(event) => {
                  const next = event.relatedTarget as Node | null;
                  if (next && event.currentTarget.contains(next)) return;
                  setDraftWidths((prev) => normalizeColumnWidths(prev));
                }}
              >
                {draftWidths.map((value, index) => (
                  <InputNumber
                    key={index}
                    size="small"
                    min={10}
                    max={90}
                    step={1}
                    value={value}
                    disabled={disabled}
                    aria-label={t("structure.layout.widths")}
                    onChange={(next) =>
                      setDraftWidths((prev) =>
                        prev.map((item, position) =>
                          position === index ? (typeof next === "number" ? next : item) : item,
                        ),
                      )
                    }
                  />
                ))}
                <Button
                  size="small"
                  type="primary"
                  disabled={!canApplyWidths}
                  onClick={() => onPatch({ column_widths: normalizeColumnWidths(draftWidths) })}
                >
                  {t("structure.layout.widthsApply")}
                </Button>
                <Button
                  size="small"
                  type="link"
                  disabled={disabled}
                  onClick={() => onPatch({ column_widths: null })}
                >
                  {t("structure.layout.widthsReset")}
                </Button>
              </div>
              <span className="rf-entry-layout-note" data-width-sum={widthTotal}>
                {t("structure.layout.widthsSum", { total: String(widthTotal) })}
              </span>
            </div>
          </div>
        </>
      ) : null}
      <EntryColumnGapControls
        columns={columns}
        gap={gap}
        columnGaps={columnGaps}
        fontPx={paperPx.font}
        contentPx={paperPx.content}
        justify={justify}
        showCustom={columns > 1 && align === "equal"}
        inheritable={inheritable}
        disabled={disabled}
        onPatch={onPatch}
      />
    </>
  );
}
