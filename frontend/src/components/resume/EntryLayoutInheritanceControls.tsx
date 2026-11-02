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
import { t } from "../../i18n";
import type {
  EntryLayoutOverrides,
  LayoutAlign,
  LayoutColumns,
  LayoutJustify,
} from "../../features/resume-layout/entryLayoutModel";
import type { EntryLayout, SectionLayout } from "../../types/resumeDocument";
import { useLocale } from "../../i18n/i18nContext";

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

/**
 * 列间距上限（字号倍数）。问题 4 从 8 放宽到 16：8 倍仍不够把内容推开，而「两端」
 * 分布才是贴边的正解，这里只是把"确实需要很松"的上限一起放宽（后端 `le=16` 同值）。
 */
const MAX_GAP = 16;

/** 每列低于这个宽度就该提示：再窄中文会一字一行。 */
const MIN_COLUMN_PX = 60;

/**
 * 纸面的字号基准（`--fs` = 后端 `FONT_SCALES[tier].base_px` × 字体系数）。
 *
 * gap 的单位是"几倍字宽"，面板要显示 `≈ 56px` 就必须知道这个基准。它是**运行时**值
 * （模板 / 档位 / 系数都会改它），唯一权威来源是画布 iframe 的 `:root`——所以读 DOM，
 * 不在这里复制一份常量表。读不到（只读宿主没有画布 / 跨域）返回 `null`，
 * 界面退化成只显示倍数，绝不显示一个猜出来的数字。
 */
function readPaperFontPx(): number | null {
  const frames = document.querySelectorAll<HTMLIFrameElement>(".resume-wb-canvas iframe");
  for (const frame of frames) {
    try {
      const root = frame.contentDocument?.documentElement;
      if (!root) continue;
      const px = Number.parseFloat(getComputedStyle(root).getPropertyValue("--fs"));
      if (Number.isFinite(px) && px > 0) return px;
    } catch {
      // 跨域 / 已被卸载：换下一帧。
    }
  }
  return null;
}

/**
 * 纸面内容宽（px）：优先量已存在的灰字段行，其次量条目卡。
 * 用于判断"三列时每列还剩多少"，量不到就返回 `null`（不提示，避免误报）。
 */
function readPaperContentPx(): number | null {
  const frames = document.querySelectorAll<HTMLIFrameElement>(".resume-wb-canvas iframe");
  for (const frame of frames) {
    try {
      const doc = frame.contentDocument;
      if (!doc) continue;
      const row =
        doc.querySelector<HTMLElement>(".entry .sub-row") ??
        doc.querySelector<HTMLElement>(".entry");
      const width = row?.getBoundingClientRect().width ?? 0;
      if (width > 0) return width;
    } catch {
      // 同上。
    }
  }
  return null;
}

/** 一行参数的换算结果（纯函数，单测直接调；DOM 读取只在组件里）。 */
export interface GapGeometry {
  /** gap 换算成的像素（读不到字号基准时为 null）。 */
  gapPx: number | null;
  /** 当前列数下每列的宽度（读不到尺子时为 null）。 */
  columnPx: number | null;
  /** 三列且每列已被挤到 `MIN_COLUMN_PX` 以下。 */
  tooNarrow: boolean;
}

/**
 * 换算 gap / 每列宽度。
 *
 * `gap` 的单位是字号倍数，所以像素值 = `gap × 字号基准`；每列宽度 = `(内容宽 − 间隔总和) / 列数`。
 * 任一输入缺失都返回 null 而不是猜一个数字——面板宁可少显示一行，也不显示错的换算。
 *
 * `justify = "between"` 时 `gap` 只是**最小间距**、剩余空白由分布均分，列宽不再被 gap
 * 挤压（HTML 的 `space-between` / PDF 的剩余空间均摊 / Word 的铺满表格都是这个语义），
 * 所以这里按 0 计——否则 gap 一大就误报"列宽不足 60px"。
 */
export function gapGeometry(
  columns: number,
  gap: number | null,
  fontPx: number | null,
  contentPx: number | null,
  justify: LayoutJustify = "start",
): GapGeometry {
  const gapPx = gap !== null && fontPx !== null ? Math.round(gap * fontPx) : null;
  const squeeze = justify === "between" ? 0 : (gap ?? 0);
  const columnPx =
    contentPx !== null && fontPx !== null && columns > 0
      ? (contentPx - Math.max(0, columns - 1) * squeeze * fontPx) / columns
      : null;
  return {
    gapPx,
    columnPx,
    tooNarrow: columns === 3 && columnPx !== null && columnPx < MIN_COLUMN_PX,
  };
}

/** 等分宽度（整数百分比，合计正好 100）：3 列 → 34/33/33，2 列 → 50/50。 */
export function equalWidths(columns: number): number[] {
  const base = Math.floor(100 / columns);
  const widths = Array.from({ length: columns }, () => base);
  widths[0] += 100 - base * columns;
  return widths;
}

/** 逐列宽度合计（面板上要显示；≠100 时禁用「应用」）。 */
export function columnWidthSum(widths: number[]): number {
  return widths.reduce((total, width) => total + width, 0);
}

/** 逐间隔的草稿初值：没有逐间隔时按统一 gap 铺满 N−1 个。 */
export function initialGaps(columns: number, gap: number | null): number[] {
  return Array.from({ length: Math.max(0, columns - 1) }, () => gap ?? 1.2);
}

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
  const [paperPx, setPaperPx] = useState<{ font: number | null; content: number | null }>({
    font: null,
    content: null,
  });
  useEffect(() => {
    const next = { font: readPaperFontPx(), content: readPaperContentPx() };
    setPaperPx((prev) => (prev.font === next.font && prev.content === next.content ? prev : next));
  });

  const geometry = gapGeometry(columns, gap, paperPx.font, paperPx.content, justify);
  const { columnPx, tooNarrow } = geometry;

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
  const [draftGaps, setDraftGaps] = useState<number[]>(initialGaps(columns, gap));
  if (draftKey !== geometrySignature) {
    setDraftKey(geometrySignature);
    setDraftWidths(columnWidths ?? equalWidths(columns));
    setDraftGaps(initialGaps(columns, gap));
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
      <div className="rf-entry-layout-row">
        <span className="rf-entry-layout-label">{t("structure.layout.gap")}</span>
        <InputNumber
          size="small"
          min={0}
          max={MAX_GAP}
          step={0.25}
          value={gap ?? undefined}
          placeholder={t("structure.layout.inherit")}
          disabled={disabled}
          aria-label={t("structure.layout.gap")}
          onChange={(value) => onPatch({ gap: typeof value === "number" ? value : null })}
        />
        {/* 单位是**字号倍数**（`column-gap: calc(var(--fs) * gap)`），这里把换算摆出来：
            用户才知道 4 不是 4px。px 由纸面真实 `--fs` 算出；读不到时只显示倍数。 */}
        {gap !== null ? (
          <span
            style={{
              color: "var(--rf-text-tertiary)",
              fontSize: 12,
              lineHeight: "18px",
              whiteSpace: "nowrap",
            }}
          >
            {t("structure.layout.gapValue", { value: gap.toFixed(2) })}
            {geometry.gapPx !== null
              ? ` ${t("structure.layout.gapPx", { px: geometry.gapPx })}`
              : ""}
          </span>
        ) : null}
      </div>
      {columns > 1 && align === "equal" ? (
        <>
          <div className="rf-entry-layout-row">
            <span className="rf-entry-layout-label">{t("structure.layout.widths")}</span>
            <div className="rf-entry-layout-stack">
              <div
                className="rf-entry-layout-number-row"
                role="group"
                aria-label={t("structure.layout.widths")}
              >
                {draftWidths.map((value, index) => (
                  <InputNumber
                    key={index}
                    size="small"
                    min={5}
                    max={95}
                    step={5}
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
                  onClick={() => onPatch({ column_widths: draftWidths })}
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
          <div className="rf-entry-layout-row">
            <span className="rf-entry-layout-label">{t("structure.layout.gaps")}</span>
            <div className="rf-entry-layout-stack">
              <div
                className="rf-entry-layout-number-row"
                role="group"
                aria-label={t("structure.layout.gaps")}
              >
                {draftGaps.map((value, index) => (
                  <InputNumber
                    key={index}
                    size="small"
                    min={0}
                    max={MAX_GAP}
                    step={0.25}
                    value={value}
                    disabled={disabled}
                    aria-label={t("structure.layout.gaps")}
                    onChange={(next) =>
                      setDraftGaps((prev) =>
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
                  disabled={disabled}
                  onClick={() => onPatch({ column_gaps: draftGaps })}
                >
                  {t("structure.layout.gapsApply")}
                </Button>
                <Button
                  size="small"
                  type="link"
                  disabled={disabled}
                  onClick={() => onPatch({ column_gaps: null })}
                >
                  {t("structure.layout.gapsReset")}
                </Button>
              </div>
            </div>
          </div>
        </>
      ) : null}
      {tooNarrow ? (
        <div
          role="status"
          style={{
            marginTop: 4,
            padding: "4px 6px",
            borderRadius: 4,
            background: "var(--rf-warning-bg)",
            color: "var(--rf-warning-text)",
            fontSize: 12,
            lineHeight: "18px",
          }}
        >
          {t("structure.layout.gapTooWide", {
            px: columnPx === null ? "" : String(Math.round(columnPx)),
          })}
        </div>
      ) : null}
    </>
  );
}
