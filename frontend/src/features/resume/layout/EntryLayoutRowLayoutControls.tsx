// SPDX-License-Identifier: Apache-2.0
/**
 * 「分栏」控件组 + 「对象」切换 + 「分布」开关（问题 4）。
 *
 * ## 为什么要多一层「对象」
 *
 * v2 原来只有一套 `columns / align / gap`，正文前（lead）与正文后（trail）共用——"正文前
 * 排 2 列、正文后排 3 列"做不到。现在两侧各能带一份 `RowLayout`，但**控件不铺三遍**：
 * 顶部一个「对象：共用 / 正文前 / 正文后」，切过去之后复用同一组控件（列数 / 对齐 /
 * 分布 / 列间距 / 逐列宽度 / 逐间隔），只是显示的值与写回的目标层不同：
 *
 * - `shared`：写 `entry.layout.X`（条目级）或 `section.layout.X`（板块级）——旧口径；
 * - `lead` / `trail`：写 `entry.layout.lead.X` / `section.layout.lead.X`（`patchRowLayout`）。
 *
 * 「继承」哨兵仍然逐项生效：条目级选「继承」= 把该项置回 `null`；板块级那一档没有可
 * 继承的对象（选项保留但禁用，面板高度不跳）。
 *
 * ## 「分布」（justify）
 *
 * - `start`：现状，列宽按内容、整体靠左；
 * - `between`：剩余空白均分到列之间，**最后一列的右缘落在内容区右边界**（HTML
 *   `space-between` / PDF 均摊 gap / Word 表格铺满版心 + 末列右对齐）。
 *
 * 只在 `equal` + 多列 + **没有**显式逐列宽度时可用：宽度合计 100% 时没有剩余空间，
 * 开关无效就必须禁用并说明原因（`structure.layout.justifyUnavailable`），而不是让它
 * 看起来能点却没反应。
 *
 * 该侧一个灰字段都没有时，对应的「对象」选项不出现（避免"调了没反应"）。
 */
import { Segmented } from "antd";
import { useState } from "react";
import { t } from "../../../i18n";
// 模块级 `t()` 不消费 React context：`localeStore` 变了以后必须靠这一行订阅才会重渲染，
// 否则切到 English 时这一组控件（对象 / 分栏 / 分布）会停在上一种语言（`localeSubscription` 守卫）。
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeDocument, ResumeEntry, RowLayout } from "../../../types/resumeDocument";
import {
  effectiveAlign,
  effectiveColumnGaps,
  effectiveColumns,
  effectiveColumnWidths,
  effectiveGap,
  effectiveJustify,
  entryLayoutOverrides,
} from "./entryLayoutModel";
import {
  effectiveSideAlign,
  effectiveSideColumnGaps,
  effectiveSideColumns,
  effectiveSideColumnWidths,
  effectiveSideGap,
  effectiveSideJustify,
  entrySideOverrides,
  justifyAvailable,
  patchRowLayout,
  sideHasFields,
} from "./entryRowLayout";
import type { LayoutJustify, LayoutSide, RowSide } from "./entryRowLayout";
import EntryLayoutInheritanceControls from "./EntryLayoutInheritanceControls";
import type { LayoutPatch } from "./EntryLayoutInheritanceControls";

/** Segmented 的"继承"哨兵值（antd 的 value 不能用 null）。 */
const INHERIT = "inherit";

/** 「分布」的三个选项值（含继承哨兵）。 */
type JustifyValue = LayoutJustify | typeof INHERIT;

interface Props {
  document: ResumeDocument;
  section: ResumeDocument["sections"][number];
  entry: ResumeEntry | null;
  /** true = 写条目级（`entry.layout.*`）；false = 写板块级（`section.layout.*`）。 */
  entryScoped: boolean;
  disabled: boolean;
  narrow?: boolean;
  /** 共用那一档的写回（面板已有实现：`patchEntryLayout` / `patchSectionLayout`）。 */
  onPatchShared: (patch: LayoutPatch) => void;
  onChange: (next: ResumeDocument) => void;
}

/**
 * 把面板 patch 收窄成 `RowLayout` 的 patch。
 *
 * 只搬「分侧也有的」这六个键：`head` / 分页开关属于条目自身而不是某一侧的列布局；
 * `undefined` 表示这一次没改这一项，必须跳过（否则会把另一侧的覆盖顺手抹掉）。
 */
export function toRowPatch(patch: LayoutPatch): Partial<RowLayout> {
  const rowKeys = ["columns", "align", "justify", "gap", "column_widths", "column_gaps"] as const;
  const out: Record<string, unknown> = {};
  for (const key of rowKeys) {
    if (patch[key] !== undefined) out[key] = patch[key];
  }
  return out as Partial<RowLayout>;
}

export default function EntryLayoutRowLayoutControls({
  document,
  section,
  entry,
  entryScoped,
  disabled,
  narrow = false,
  onPatchShared,
  onChange,
}: Props) {
  // 订阅语言变化（与同目录的 `EntryLayoutShortFields` / `EntryLayoutPagination` 一致）：
  // 本文件用的是模块级 `t()`，不订阅的话切语言后这一块不会重新求值。
  useLocale();
  const sides: RowSide[] = (["lead", "trail"] as const).filter((side) =>
    sideHasFields(entry, side),
  );
  const [object, setObject] = useState<LayoutSide>("shared");
  // 切条目 / 切板块后回到「共用」：否则上一侧的选择会带到一条没有该侧字段的条目上，
  // 表现为"控件都不见了"。渲染期对齐（与面板对齐 entryId 同一模式，不进 effect）。
  const objectKey = `${section.key}|${entry?.id ?? ""}`;
  const [lastObjectKey, setLastObjectKey] = useState(objectKey);
  if (lastObjectKey !== objectKey) {
    setLastObjectKey(objectKey);
    if (object !== "shared" && !sides.includes(object as RowSide)) setObject("shared");
  }
  // 侧别字段被删光后，「对象」不能停在一个已不存在的侧上。
  if (object !== "shared" && !sides.includes(object as RowSide)) setObject("shared");

  const side: RowSide | null = object === "shared" ? null : (object as RowSide);
  const scopedEntry = entryScoped ? entry : null;

  const columns = side
    ? effectiveSideColumns(section, scopedEntry, side)
    : effectiveColumns(section, scopedEntry);
  const align = side
    ? effectiveSideAlign(section, scopedEntry, side)
    : effectiveAlign(section, scopedEntry);
  const gap = side
    ? effectiveSideGap(section, scopedEntry, side)
    : effectiveGap(section, scopedEntry);
  const justify = side
    ? effectiveSideJustify(section, scopedEntry, side)
    : effectiveJustify(section, scopedEntry);
  const columnWidths = side
    ? effectiveSideColumnWidths(section, scopedEntry, side)
    : effectiveColumnWidths(section, scopedEntry);
  const columnGaps = side
    ? effectiveSideColumnGaps(section, scopedEntry, side)
    : effectiveColumnGaps(section, scopedEntry);

  const overrides =
    entryScoped && entry
      ? side
        ? entrySideOverrides(entry, side)
        : entryLayoutOverrides(entry)
      : null;
  const justifyInherited = overrides !== null && !overrides.justify;

  /** 某一侧的写回：`entryId = null` 表示写板块级（与 `patchRowLayout` 的约定一致）。 */
  const patchSide = (patch: LayoutPatch) => {
    if (!side) return;
    const entryId = entryScoped ? (entry?.id ?? null) : null;
    onChange(patchRowLayout(document, section.key, entryId, side, toRowPatch(patch)));
  };

  const handlePatch = (patch: LayoutPatch) => {
    if (side) {
      patchSide(patch);
      return;
    }
    onPatchShared(patch);
  };

  const objectOptions: { value: LayoutSide; label: string }[] = [
    { value: "shared", label: t("structure.layout.object.shared") },
    ...sides.map((value) => ({
      value: value as LayoutSide,
      label:
        value === "lead" ? t("structure.layout.object.lead") : t("structure.layout.object.trail"),
    })),
  ];

  const justifyUsable = justifyAvailable(columns, align, columnWidths);
  const justifyValue: JustifyValue = justifyInherited ? INHERIT : justify;
  const justifyOptions = [
    {
      value: INHERIT as JustifyValue,
      label: t("structure.layout.inherit"),
      disabled: !entryScoped,
    },
    { value: "start" as JustifyValue, label: t("structure.layout.justify.start") },
    { value: "between" as JustifyValue, label: t("structure.layout.justify.between") },
  ];

  return (
    <>
      {sides.length > 0 ? (
        <>
          <div className="rf-entry-layout-row">
            <span className="rf-entry-layout-label">{t("structure.layout.object")}</span>
            <Segmented
              className="rf-entry-layout-control"
              size="small"
              block
              vertical={narrow}
              value={object}
              disabled={disabled}
              aria-label={t("structure.layout.object")}
              data-row-object="1"
              options={objectOptions}
              onChange={(value) => setObject(value as LayoutSide)}
            />
          </div>
          {object === "shared" ? (
            <span className="rf-entry-layout-note" data-row-object-hint="1">
              {t("structure.layout.objectHint")}
            </span>
          ) : null}
        </>
      ) : null}

      <EntryLayoutInheritanceControls
        columns={columns}
        align={align}
        gap={gap}
        justify={justify}
        columnWidths={columnWidths}
        columnGaps={columnGaps}
        overrides={overrides}
        disabled={disabled}
        narrow={narrow}
        onPatch={handlePatch}
      />

      {/* 分布只在「等宽 + 多列」时有意义：flow 是一行顺排、单列没有列间空白。 */}
      {columns > 1 && align === "equal" ? (
        <>
          <div className="rf-entry-layout-row">
            <span className="rf-entry-layout-label">{t("structure.layout.justify")}</span>
            <Segmented
              className="rf-entry-layout-control"
              size="small"
              block
              vertical={narrow}
              value={justifyValue}
              disabled={disabled || !justifyUsable}
              aria-label={t("structure.layout.justify")}
              data-row-justify="1"
              options={justifyOptions}
              onChange={(value) => {
                if (value === INHERIT) {
                  handlePatch({ justify: null });
                  return;
                }
                handlePatch({ justify: value as LayoutJustify });
              }}
            />
          </div>
          <span className="rf-entry-layout-note" data-row-justify-note="1">
            {justifyUsable
              ? t("structure.layout.justifyHint")
              : t("structure.layout.justifyUnavailable")}
          </span>
        </>
      ) : null}
    </>
  );
}
