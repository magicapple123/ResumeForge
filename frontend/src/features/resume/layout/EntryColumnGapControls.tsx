// SPDX-License-Identifier: Apache-2.0
/**
 * 条目「列间距」控件：一个总间距滑杆 +（可选）逐间隔自定义。
 *
 * 两个非显然点：
 * - 存的是 **em 比例**、显示的是 **mm**：`fontPx` 未知（模板还没定字号）时两者换不出来，
 *   滑杆与数值一起禁用，而不是显示一个假的 0；
 * - `columnGaps` 只有长度正好 `columns - 1` 时才算数：换过栏数或旧数据长度对不上时回落
 *   到初始值，避免"三栏的间距被套到两栏上"。
 */
import { UndoOutlined } from "@ant-design/icons";
import { Button, Checkbox, Slider, Tooltip } from "antd";
import { useState, type ReactNode } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import {
  gapGeometry,
  initialGaps,
  MAX_GAP_MM,
  millimetersToRatio,
  ratioToMillimeters,
} from "./entryColumnGeometry";
import "./entry-column-controls.css";

interface Props {
  columns: number;
  gap: number | null;
  columnGaps: number[] | null;
  fontPx: number | null;
  contentPx: number | null;
  justify: "start" | "between";
  showCustom: boolean;
  inheritable: boolean;
  disabled: boolean;
  onPatch: (patch: { gap?: number | null; column_gaps?: number[] | null }) => void;
}

export default function EntryColumnGapControls({
  columns,
  gap,
  columnGaps,
  fontPx,
  contentPx,
  justify,
  showCustom,
  inheritable,
  disabled,
  onPatch,
}: Props) {
  useLocale();
  const [customOpen, setCustomOpen] = useState(false);
  // 长度对不上按"没有自定义"处理：否则 map 出来的滑杆会比真实间隔多/少一根。
  const gaps = columnGaps?.length === columns - 1 ? columnGaps : initialGaps(columns, gap);
  const geometry = gapGeometry(columns, gap, fontPx, contentPx, justify);

  /**
   * 一条间距行：`[滑杆][读数][↺]`。
   *
   * I-05 / I-07（2026-11-18）把「恢复继承」从下方独立一行搬进本行：原来它挂在
   * `.rf-entry-layout-stack` 里，`align-items: stretch` 把它拉成整行宽并居中，行高
   * 94px（同面板「列数」行 30px）。恢复按钮只在**有覆盖值**时渲染——继承态没有可恢复
   * 的东西，读数里的「继承」已经说明状态（此前同一个词在一行里出现两次）。
   * 布局全部交给 CSS 网格区（见 `entry-column-controls.css`）：宽档三列一行，窄档
   * 滑杆独占一行、读数左 / ↺ 右，**不做条件渲染**，拖宽拖窄时按钮不重挂。
   */
  const gapSlider = (
    ratio: number | null,
    name: string,
    onChange: (value: number) => void,
    reset?: ReactNode,
  ) => {
    // null 的两种含义都落在文案上：ratio 为 null = 跟随模板（继承），有 ratio 但 fontPx
    // 缺失 = 暂时算不出 mm（显示「—」），后者不该被说成"继承"。
    const mm = ratio === null ? null : ratioToMillimeters(ratio, fontPx);
    return (
      <div className="rf-entry-column-gap-row">
        <Slider
          min={0}
          max={MAX_GAP_MM}
          step={0.1}
          value={mm === null ? 0 : Math.min(MAX_GAP_MM, mm)}
          disabled={disabled || fontPx === null || undefined}
          aria-label={name}
          tooltip={{
            formatter: (value) =>
              t("structure.layout.gapMillimeters", { value: value?.toFixed(2) ?? "" }),
          }}
          onChange={(value) => {
            const next = millimetersToRatio(value, fontPx);
            if (next !== null) onChange(next);
          }}
        />
        <span className="rf-entry-column-gap-value" data-gap-mm={mm ?? ""}>
          {mm === null
            ? ratio === null
              ? t("structure.layout.inherit")
              : "—"
            : t("structure.layout.gapMillimeters", { value: mm.toFixed(2) })}
        </span>
        {reset}
      </div>
    );
  };

  /* 恢复继承：只在「本层有覆盖值」时出现。文案用「恢复继承列间距」而不是
     `ParamResetButton` 的「恢复到打开时的值」——那颗 ↺ 是快照语义，这里的动作是
     **清除覆盖、回到继承**，两件事不能共用一句提示。 */
  const gapReset =
    inheritable && gap !== null ? (
      <Tooltip title={t("structure.layout.restore.gap")}>
        <Button
          size="small"
          type="text"
          className="rf-entry-column-gap-reset resume-param-restore"
          icon={<UndoOutlined />}
          aria-label={t("structure.layout.restore.gap")}
          disabled={disabled || undefined}
          onClick={() => onPatch({ gap: null })}
        />
      </Tooltip>
    ) : null;

  return (
    <>
      <div className="rf-entry-layout-row">
        {/* I-07：标签去掉单位（读数 `{value} mm` 已经带单位），72px 里一行放得下；
            `gapMmAria` 不变，滑杆的无障碍名仍播报单位。 */}
        <span className="rf-entry-layout-label">{t("structure.layout.gap")}</span>
        <div className="rf-entry-layout-control">
          {gapSlider(
            gap,
            t("structure.layout.gapMmAria"),
            (value) => onPatch({ gap: value }),
            gapReset,
          )}
        </div>
      </div>
      {showCustom ? (
        <div className="rf-entry-layout-stack">
          <Checkbox
            checked={customOpen}
            disabled={disabled || undefined}
            onChange={(event) => setCustomOpen(event.target.checked)}
          >
            {t("structure.layout.customGaps")}
          </Checkbox>
          {customOpen ? (
            <div role="group" aria-label={t("structure.layout.gaps")}>
              {gaps.map((ratio, index) => (
                <div key={index} className="rf-entry-layout-row">
                  <span className="rf-entry-layout-label">{index + 1}</span>
                  {gapSlider(ratio, `${t("structure.layout.gapMmAria")} ${index + 1}`, (value) =>
                    onPatch({
                      column_gaps: gaps.map((item, position) =>
                        position === index ? value : item,
                      ),
                    }),
                  )}
                </div>
              ))}
              <Button
                size="small"
                type="link"
                disabled={disabled || undefined}
                onClick={() => onPatch({ column_gaps: null })}
              >
                {t("structure.layout.gapsReset")}
              </Button>
            </div>
          ) : null}
        </div>
      ) : null}
      {geometry.tooNarrow ? (
        <div className="rf-entry-column-gap-warning" role="status">
          {t("structure.layout.gapTooWide", {
            px: geometry.columnPx === null ? "" : String(Math.round(geometry.columnPx)),
          })}
        </div>
      ) : null}
    </>
  );
}
