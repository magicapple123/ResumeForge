// SPDX-License-Identifier: Apache-2.0
/**
 * 参数 · **层次与间距**组（简历制作台左栏）：区块间距 / 条目间距 / 姓名大小 / 小节标题大小。
 *
 * ## 四个键分成两类，但外观完全一致
 *
 * | 键 | 语义 | 区间/步长来源 | 默认值 |
 * |---|---|---|---|
 * | `section_gap` | `.section` 的 `margin-bottom = calc(var(--fs) * N)` | 目录 `format_fields` | `template_layouts[t].section_gap` |
 * | `entry_gap` | `.entry` 的下边距系数 | `SCALE_BOUNDS` | 常量 1 |
 * | `name_scale` | 姓名基准的乘子 | `SCALE_BOUNDS` | 常量 1 |
 * | `section_title_scale` | 小节标题基准的乘子 | `SCALE_BOUNDS` | 常量 1 |
 *
 * 区间与步长**一处都不在这写**：`section_gap` 吃目录下发的那份（后端 `FORMAT_FIELDS`），
 * 三个系数吃 `utils/resumeScaleParams.ts`（与后端 `_SCALE_MIN_MAX` / `SCALE_STEPS` 逐键
 * 相等，两边各有测试钉住）。控件里再抄一份数字的老教训见那份文件的头注释。
 *
 * ## 交互与既有度量控件同一套
 *
 * "标签 + ± + 滑杆 + 读数 + 来源胶囊"，双击标题（或 Enter / 空格）恢复默认；拖动时把
 * 探针 CSS 即时注入预览（零网络往返），静置 120ms 才提交一次。恢复默认 = **删键**，
 * 不是写回默认值：以后模板基准调整时这些简历要跟着变。
 */
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import { Button, Slider, Space, Tooltip, Typography } from "antd";
import { useEffect, useMemo, useRef, useState } from "react";
import type { RefObject } from "react";
import type { ResumeLayout, ResumeTemplateCatalog } from "../../types";
import type { ResumePreviewHandle } from "../ResumePreview";
import { t } from "../../i18n";
import {
  DEFAULT_SCALE,
  SCALE_BOUNDS,
  SECTION_GAP_FALLBACK_BOUNDS,
  catalogNumberBounds,
  clampScale,
  roundToStep,
  templateSectionGap,
  withScale,
  type ScaleBounds,
  type ScaleKey,
} from "../../utils/resumeScaleParams";
import { scaleProbeCss, sectionGapProbeCss } from "../../utils/resumeFormatProbe";

/** 提交防抖（毫秒）：与行距 / 页边距同一档，一次拖动折叠成一次重渲染请求。 */
const COMMIT_DEBOUNCE_MS = 120;

interface Props {
  layout: ResumeLayout;
  catalog?: ResumeTemplateCatalog;
  disabled?: boolean;
  /** 拖动中的即时反馈通道（与制作台右栏的预览句柄是同一个）。 */
  previewRef?: RefObject<ResumePreviewHandle | null>;
  onChange: (layout: ResumeLayout) => void;
}

interface RowProps {
  label: string;
  /** 权威值（父组件解析后的生效值）。 */
  value: number;
  bounds: ScaleBounds;
  customized: boolean;
  defaultHint: string;
  disabled: boolean;
  /** 读数格式（含 `×`）：拖动中跟着手指走，所以是函数而不是字符串。 */
  format: (value: number) => string;
  /** 拖动中注入预览的探针 CSS（与后端逐字一致，见 `utils/resumeFormatProbe`）。 */
  probe: (value: number) => string;
  onProbe: (css: string) => void;
  /** 防抖到点后提交一次（已落在步长网格上）。 */
  onCommit: (next: number) => void;
  /** 恢复默认（父组件负责删键）。 */
  onReset: () => void;
}

/** 一行：标签（可双击复位）+ ± + 滑杆 + 读数 + 来源胶囊。 */
function SpacingRow({
  label,
  value,
  bounds,
  customized,
  defaultHint,
  disabled,
  format,
  probe,
  onProbe,
  onCommit,
  onReset,
}: RowProps) {
  const [dragging, setDragging] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 父组件确认了新值（提交成功或外部改动）后交回权威值，避免滑块停在中间态。
  const signature = `${value}:${customized}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setDragging(null);
  }

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const shown = roundToStep(dragging ?? value, bounds.step);

  const commit = (next: number) => {
    // 夹进区间再落到步长网格：越界值会被后端**静默丢弃**，表现为"松手后跳回去"。
    const rounded = roundToStep(Math.min(bounds.max, Math.max(bounds.min, next)), bounds.step);
    setDragging(rounded);
    // 即时反馈先于提交：探针与最终渲染必须是同一条规则的同一种数字格式。
    onProbe(probe(rounded));
    if (debounceRef.current) clearTimeout(debounceRef.current);
    debounceRef.current = setTimeout(() => {
      debounceRef.current = null;
      onCommit(rounded);
    }, COMMIT_DEBOUNCE_MS);
  };

  const reset = () => {
    // 本来就没设过覆盖 → 复位是空操作，不该产生一次"看起来没变"的请求。
    if (!customized) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setDragging(null);
    onProbe("");
    onReset();
  };

  return (
    <Space size={6} wrap className="resume-wb-row">
      <Tooltip title={t("workbench.param.reset")}>
        <span
          className="resume-measure-label"
          role="button"
          tabIndex={0}
          aria-label={t("workbench.param.resetLabel", { label })}
          onDoubleClick={reset}
          onKeyDown={(event) => {
            // 只接管 Enter / 空格：其它按键必须留给滑块的既有键盘行为。
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            reset();
          }}
        >
          {label}
        </span>
      </Tooltip>
      <Space size={2} align="center" className="resume-wb-row-controls">
        <Button
          size="small"
          type="text"
          icon={<MinusOutlined />}
          aria-label={t("workbench.param.decreaseAria", { label })}
          disabled={disabled || shown <= bounds.min}
          onClick={() => commit(shown - bounds.step)}
        />
        <Slider
          className="resume-wb-slider"
          min={bounds.min}
          max={bounds.max}
          step={bounds.step}
          value={shown}
          disabled={disabled}
          aria-label={t("workbench.param.sliderAria", { label })}
          ariaLabelForHandle={label}
          tooltip={{ formatter: (current) => (current == null ? "" : format(current)) }}
          onChange={commit}
        />
        <Button
          size="small"
          type="text"
          icon={<PlusOutlined />}
          aria-label={t("workbench.param.increaseAria", { label })}
          disabled={disabled || shown >= bounds.max}
          onClick={() => commit(shown + bounds.step)}
        />
      </Space>
      {/* 读数与来源胶囊各占一列（定宽，见 resume-workbench.css）：四个读数落在同一条竖线上。 */}
      <span className="resume-measure-tail">
        <Typography.Text type="secondary" className="resume-measure-value">
          {format(shown)}
        </Typography.Text>
        <span className={`resume-measure-source${customized ? " is-empty" : ""}`}>
          {customized ? "" : defaultHint}
        </span>
      </span>
    </Space>
  );
}

export default function ResumeSpacingControls({
  layout,
  catalog,
  disabled = false,
  previewRef,
  onChange,
}: Props) {
  // 与 `ResumeMeasureControls` 同一个理由：防抖回调在松手之后才跑，提交时必须读
  // "提交那一刻"的 layout，否则会把这段时间里父组件改的其它版式（页数、模板）覆盖回去。
  const layoutRef = useRef(layout);
  useEffect(() => {
    layoutRef.current = layout;
  });

  const config = layout.format_config;
  // 版式预设（`format_presets`）盖掉模板默认：模板 < 版式 < 手动微调，与行距/页边距同序。
  const presetConfig = catalog?.format_presets?.find(
    (item) => item.name === layout.format_name,
  )?.config;
  const presetNumber = (key: string): number | null => {
    const raw = presetConfig?.[key];
    return typeof raw === "number" ? raw : null;
  };
  const defaultHint = presetConfig
    ? t("resume.measure.hintPreset")
    : t("resume.measure.hintTemplate");
  const applyProbe = (css: string) => {
    previewRef?.current?.setLiveProbe(css);
  };

  const gapBounds = useMemo(
    () => catalogNumberBounds(catalog, "section_gap", SECTION_GAP_FALLBACK_BOUNDS),
    [catalog],
  );
  // 区块间距是**绝对覆盖**：没设过时停在"当前模板的基准"，写死会让滑块与渲染不一致。
  const ownGap = typeof config?.["section_gap"] === "number" ? Number(config["section_gap"]) : null;
  const gapValue =
    ownGap ?? presetNumber("section_gap") ?? templateSectionGap(catalog, layout.template);
  const gapLabel =
    catalog?.format_fields?.find((field) => field.key === "section_gap")?.label ??
    t("workbench.param.section-gap");

  /** 写区块间距：`null` = 删键（回到随模板）；否则夹紧后落库。 */
  const writeGap = (next: number | null) => {
    const current = layoutRef.current;
    const rest = { ...(current.format_config ?? {}) };
    if (next === null) {
      delete rest["section_gap"];
    } else {
      rest["section_gap"] = roundToStep(
        Math.min(gapBounds.max, Math.max(gapBounds.min, next)),
        gapBounds.step,
      );
    }
    onChange({ ...current, format_config: rest });
  };

  /** 三个系数：缺键 → `DEFAULT_SCALE`（= 没设过）；越界 → 夹紧。 */
  const scaleValue = (key: ScaleKey): number => {
    const own = config?.[key];
    if (typeof own === "number") return clampScale(key, own);
    return clampScale(key, presetNumber(key) ?? DEFAULT_SCALE);
  };

  /** 写系数：`null` 或 ≈1 = 删键（不写回 1），语义在 `withScale` 里只有一份。 */
  const writeScale = (key: ScaleKey, next: number | null) => {
    const current = layoutRef.current;
    onChange({ ...current, format_config: withScale(current.format_config, key, next) });
  };

  /** 系数读数：两位小数 + `×`（系数是乘子，不写 `%`，见设计 §7.1）。 */
  const formatScale = (value: number): string => `${roundToStep(value, 0.01).toFixed(2)}×`;

  return (
    <div className="resume-wb-rows">
      <SpacingRow
        label={gapLabel}
        value={gapValue}
        bounds={gapBounds}
        customized={ownGap !== null}
        defaultHint={defaultHint}
        disabled={disabled}
        format={(value) => `${Number(value.toFixed(1))}×`}
        probe={sectionGapProbeCss}
        onProbe={applyProbe}
        onCommit={writeGap}
        onReset={() => writeGap(null)}
      />
      <SpacingRow
        label={t("workbench.param.entry-gap")}
        value={scaleValue("entry_gap")}
        bounds={SCALE_BOUNDS["entry_gap"]}
        customized={typeof config?.["entry_gap"] === "number"}
        defaultHint={defaultHint}
        disabled={disabled}
        format={formatScale}
        probe={(value) => scaleProbeCss("entry_gap", value)}
        onProbe={applyProbe}
        onCommit={(value) => writeScale("entry_gap", value)}
        onReset={() => writeScale("entry_gap", null)}
      />
      <SpacingRow
        label={t("workbench.param.name-scale")}
        value={scaleValue("name_scale")}
        bounds={SCALE_BOUNDS["name_scale"]}
        customized={typeof config?.["name_scale"] === "number"}
        defaultHint={defaultHint}
        disabled={disabled}
        format={formatScale}
        probe={(value) => scaleProbeCss("name_scale", value)}
        onProbe={applyProbe}
        onCommit={(value) => writeScale("name_scale", value)}
        onReset={() => writeScale("name_scale", null)}
      />
      <SpacingRow
        label={t("workbench.param.section-title-scale")}
        value={scaleValue("section_title_scale")}
        bounds={SCALE_BOUNDS["section_title_scale"]}
        customized={typeof config?.["section_title_scale"] === "number"}
        defaultHint={defaultHint}
        disabled={disabled}
        format={formatScale}
        probe={(value) => scaleProbeCss("section_title_scale", value)}
        onProbe={applyProbe}
        onCommit={(value) => writeScale("section_title_scale", value)}
        onReset={() => writeScale("section_title_scale", null)}
      />
    </div>
  );
}
