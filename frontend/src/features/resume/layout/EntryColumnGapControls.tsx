// SPDX-License-Identifier: Apache-2.0
/**
 * 条目「列间距」控件：一个总间距滑杆 +（可选）逐间隔自定义。
 *
 * 两个非显然点：
 * - 存的是 **em 比例**、显示的是 **mm**：`fontPx` 未知（模板还没定字号）时两者换不出来，
 *   滑杆与数值一起禁用，而不是显示一个假的 0；
 * - `columnGaps` 只有长度正好 `columns - 1` 时才算数：换过栏数或旧数据长度对不上时回落
 *   到初始值，避免"三栏的间距被套到两栏上"。
 *
 * ## 为什么拖动要本地草稿 + 防抖（WF-15）
 *
 * 每次 `onPatch` 都是 `onEditDocument → commitDocument`：**一整份文档**入历史栈并触发重排。
 * 旧实现把滑杆的每个 step（0.1mm）都提交一次，拖满全程几十次提交，手感就是"卡"+历史栈被
 * 灌满（撤销一次只退一格）。现在与 `PhotoScaleControl` 同模式：拖动中只更新本地读数，
 * 120ms 防抖后提交一次，`onChangeComplete`（松手）立即 flush。
 *
 * 读数格子因此必须**定宽**（见 `entry-column-controls.css`）：本地读数在
 * `1.0 mm → 7.60 mm` 之间变长时不能借用滑杆的宽度，否则行宽/行高一变，左栏滚动位置
 * 就跟着抖——`usePanelScrollAnchor` 只在 `document` 变化时补偿，管不到本地 state 引起的
 * 高度变化。
 */
import { UndoOutlined } from "@ant-design/icons";
import { Button, Checkbox, Slider, Tooltip } from "antd";
import { useEffect, useRef, useState, type ReactNode } from "react";
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

/** 提交防抖（毫秒）。与照片大小 / 页边距同值：一次提交就要后端重渲染一次。 */
const COMMIT_DEBOUNCE_MS = 120;

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

interface GapRowProps {
  /** 滑杆的无障碍名（总间距 / 第 N 个间隔）。 */
  name: string;
  /** 生效读数（mm）；`null` 用 `fallback` 说明（继承 / 暂时算不出）。 */
  mm: number | null;
  fallback: string;
  disabled: boolean;
  /** 拖动中的即时读数文案（`x.xx mm`）。 */
  formatMm: (mm: number) => string;
  /** 提交一个 mm 值（父层负责换成 em 比例）。 */
  onCommit: (mm: number) => void;
  /** 「恢复继承」：只在有覆盖值时由父层给出。 */
  reset?: ReactNode;
}

/**
 * 一条间距行：`[滑杆][读数][↺]`。本地草稿只活在这一层，父层不必为拖动重渲染。
 *
 * 父层确认新值后签名变化 → 清掉草稿，交回权威值（与 `PhotoScaleControl` 同一模式）：
 * 后端若把值夹了范围，界面不会停在中间态。
 */
function GapSliderRow({ name, mm, fallback, disabled, formatMm, onCommit, reset }: GapRowProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const pendingRef = useRef<number | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const commitRef = useRef(onCommit);

  // 渲染期不能写 ref（react-hooks/refs）：每次渲染后用 effect 同步最新闭包，
  // 定时器与 flush 都从 ref 读，避免 120ms 后调到旧 props 上的 onCommit。
  useEffect(() => {
    commitRef.current = onCommit;
  });

  const signature = `${mm}:${fallback}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setDragging(null);
  }

  useEffect(
    () => () => {
      if (timerRef.current) clearTimeout(timerRef.current);
    },
    [],
  );

  /** 把挂起的那一次立刻送出（松手 / 卸载前）。 */
  const flush = () => {
    if (timerRef.current) {
      clearTimeout(timerRef.current);
      timerRef.current = null;
    }
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending !== null) commitRef.current(pending);
  };

  const handleChange = (value: number) => {
    setDragging(value);
    pendingRef.current = value;
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending !== null) commitRef.current(pending);
    }, COMMIT_DEBOUNCE_MS);
  };

  const shown = dragging ?? mm;
  return (
    <div className="rf-entry-column-gap-row">
      <Slider
        min={0}
        max={MAX_GAP_MM}
        step={0.1}
        value={shown === null ? 0 : Math.min(MAX_GAP_MM, shown)}
        disabled={disabled}
        aria-label={name}
        // antd 把 `aria-label` 挂在轨道上，真正可聚焦的是手柄：手柄没有名字时，
        // 键盘 / 读屏用户听到的是一颗无名的 slider（`ariaLabelForHandle` 才是手柄的名字）。
        ariaLabelForHandle={name}
        tooltip={{
          formatter: (value) =>
            t("structure.layout.gapMillimeters", { value: value?.toFixed(2) ?? "" }),
        }}
        onChange={handleChange}
        onChangeComplete={flush}
      />
      <span className="rf-entry-column-gap-value" data-gap-mm={shown ?? ""}>
        {shown === null ? fallback : formatMm(shown)}
      </span>
      {reset}
    </div>
  );
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

  /** em 比例 → mm 读数；写成一份，总间距与逐间隔共用。 */
  const toMm = (ratio: number | null): number | null =>
    ratio === null ? null : ratioToMillimeters(ratio, fontPx);
  /** 拖动读数：与旧实现同一句文案（`x.xx mm`）。 */
  const formatMm = (value: number) =>
    t("structure.layout.gapMillimeters", { value: value.toFixed(2) });
  /** 滑杆写回：mm → em 比例（换算不出来就不写，避免下发一个假值）。 */
  const commitMm = (value: number, write: (ratio: number) => void) => {
    const next = millimetersToRatio(value, fontPx);
    if (next !== null) write(next);
  };
  const locked = disabled || fontPx === null;

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
          <GapSliderRow
            name={t("structure.layout.gapMmAria")}
            mm={toMm(gap)}
            // null 的两种含义都落在文案上：ratio 为 null = 跟随模板（继承），有 ratio 但
            // fontPx 缺失 = 暂时算不出 mm（显示「—」），后者不该被说成"继承"。
            fallback={gap === null ? t("structure.layout.inherit") : "—"}
            disabled={locked}
            formatMm={formatMm}
            onCommit={(value) => commitMm(value, (ratio) => onPatch({ gap: ratio }))}
            reset={gapReset}
          />
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
                  <GapSliderRow
                    name={`${t("structure.layout.gapMmAria")} ${index + 1}`}
                    mm={toMm(ratio)}
                    fallback={ratio === null ? t("structure.layout.inherit") : "—"}
                    disabled={locked}
                    formatMm={formatMm}
                    onCommit={(value) =>
                      commitMm(value, (next) =>
                        onPatch({
                          column_gaps: gaps.map((item, position) =>
                            position === index ? next : item,
                          ),
                        }),
                      )
                    }
                  />
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
