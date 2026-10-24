// SPDX-License-Identifier: Apache-2.0
/**
 * W07 / D02 的一行属性控件：**直接输入 + 步进 + 临时放大步进 + 滑杆 + 恢复继承**。
 *
 * ## 为什么四件套都在一行
 *
 * D02 的四条要求指向同一个动作"把值改到我要的那个数"：
 * - 滑杆适合扫范围，但不适合命中 1.55 这种精确值；
 * - `InputNumber` 适合直接键入；
 * - ± 适合挪一格（`Shift` 单击 = 五倍步进，扫长距离时不用反复点）；
 * - 双击标签 / 点 ↺ = 删掉这一条覆盖，回到继承。
 * 拆成四个控件会让一行变成四行，参数栏立刻装不下。
 *
 * ## 拖动中即时反馈
 *
 * 滑杆 `onChange` 只更新本地草稿并调 `toProbeCss` 注入预览探针；`onChangeComplete`
 * 才提交一次。这样一次拖动 = 一次写配置，且松手前已经看到效果。
 *
 * ## 删键语义
 *
 * 「恢复继承」永远是 `onCommit(null)`，由数据层删键；本控件不写"默认值"。
 */
import { MinusOutlined, PlusOutlined } from "@ant-design/icons";
import {
  Button,
  ColorPicker,
  InputNumber,
  Select,
  Slider,
  Space,
  Switch,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { t } from "../../../i18n";
import type { ResumeStyleSource } from "../../../features/resume-layout/styleOverrides";
import {
  STYLE_ENUM_OPTIONS,
  STYLE_PROP_BOUNDS,
  STYLE_PROP_KINDS,
  type StylePropKey,
} from "../../../utils/resumeStyleParams";
import {
  formatStyleNumber,
  isNumberStyleProp,
  ptComparison,
  roundToStyleStep,
} from "../../../utils/resumeStyleParams";
import ParamResetButton from "../ParamResetButton";
import StyleSourceTag from "./StyleSourceTag";

export type StyleValue = number | string | boolean;

interface Props {
  prop: StylePropKey;
  /** 已 `t()` 过的标签（父组件决定用哪个词条）。 */
  label: string;
  /** 生效值（继承或覆盖）；undefined = 目录还没给基准。 */
  value: StyleValue | undefined;
  /** 显式覆盖值；undefined = 继承（决定 ↺ 是否出现）。 */
  own: StyleValue | undefined;
  source: ResumeStyleSource;
  disabled?: boolean;
  /** 字号比例：显示 pt 对照（只显示，不换算落库值）。 */
  basePx?: number;
  /** 拖动中的探针 CSS（父组件负责选择器）；不传则不注入。 */
  toProbeCss?: (value: StyleValue) => string;
  onProbe?: (css: string) => void;
  /** null = 恢复继承（删键）。 */
  onCommit: (value: StyleValue | null) => void;
  /** 测试/宿主定位用（`style-row-body-font_scale` 这种形状）。 */
  testId?: string;
}

export default function StyleValueRow({
  prop,
  label,
  value,
  own,
  source,
  disabled = false,
  basePx,
  toProbeCss,
  onProbe,
  onCommit,
  testId,
}: Props) {
  const kind = STYLE_PROP_KINDS[prop];
  const bounds = isNumberStyleProp(prop) ? STYLE_PROP_BOUNDS[prop] : null;
  const [draft, setDraft] = useState<number | null>(null);
  const debounceRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  // 父组件确认新值后交回权威值，避免滑杆停在中间态。
  const signature = `${String(value)}:${String(own)}`;
  const [prevSignature, setPrevSignature] = useState(signature);
  if (prevSignature !== signature) {
    setPrevSignature(signature);
    setDraft(null);
  }

  useEffect(
    () => () => {
      if (debounceRef.current) clearTimeout(debounceRef.current);
    },
    [],
  );

  const numeric = typeof value === "number" ? value : null;
  const shown = draft ?? numeric ?? bounds?.min ?? 0;

  const probe = (next: StyleValue) => {
    if (!toProbeCss || !onProbe) return;
    onProbe(toProbeCss(next));
  };

  const commit = (next: StyleValue | null) => {
    if (next === null) {
      onProbe?.("");
      onCommit(null);
      return;
    }
    probe(next);
    onCommit(next);
  };

  /** 步进：`Shift` 单击 = 五倍步进（D02 的"临时放大步进"）。 */
  const step = (direction: 1 | -1, amplified: boolean) => {
    if (!bounds || numeric === null) return;
    const delta = bounds.step * (amplified ? 5 : 1) * direction;
    const next = roundToStyleStep(
      Math.min(bounds.max, Math.max(bounds.min, shown + delta)),
      bounds.step,
    );
    setDraft(next);
    commit(next);
  };

  const reset = () => {
    if (own === undefined) return;
    if (debounceRef.current) {
      clearTimeout(debounceRef.current);
      debounceRef.current = null;
    }
    setDraft(null);
    commit(null);
  };

  /** 直接输入：只在失焦/回车提交一次；越界夹回区间（用户能看见值变了）。 */
  const commitTyped = (raw: number | null) => {
    if (raw === null || !bounds) return;
    const next = roundToStyleStep(Math.min(bounds.max, Math.max(bounds.min, raw)), bounds.step);
    // 没有真正改动就不提交：失焦本身不该产生一次"看起来没变"的写配置。
    if (typeof value === "number" && next === value) return;
    setDraft(next);
    commit(next);
  };

  const ptText =
    prop === "font_scale" && basePx && typeof value === "number"
      ? t("typography.value.pt", { pt: ptComparison(value, basePx) })
      : null;

  return (
    <Space size={6} wrap className="resume-wb-row resume-typography-row" data-testid={testId}>
      <Tooltip title={t("typography.row.resetHint")}>
        <span
          className="resume-measure-label"
          role="button"
          tabIndex={0}
          aria-label={t("typography.row.resetAria", { label })}
          onDoubleClick={reset}
          onKeyDown={(event) => {
            if (event.key !== "Enter" && event.key !== " ") return;
            event.preventDefault();
            reset();
          }}
        >
          {label}
        </span>
      </Tooltip>

      {kind === "number" && bounds ? (
        <Space size={2} align="center" className="resume-wb-row-controls">
          <Button
            size="small"
            type="text"
            icon={<MinusOutlined />}
            aria-label={t("typography.row.decreaseAria", { label })}
            disabled={disabled || shown <= bounds.min}
            onClick={(event) => step(-1, event.shiftKey)}
          />
          <Slider
            className="resume-wb-slider"
            min={bounds.min}
            max={bounds.max}
            step={bounds.step}
            value={shown}
            disabled={disabled}
            aria-label={t("typography.row.sliderAria", { label })}
            tooltip={{
              formatter: (current) => (current == null ? "" : formatStyleNumber(prop, current)),
            }}
            onChange={(next) => {
              const rounded = roundToStyleStep(next, bounds.step);
              setDraft(rounded);
              probe(rounded);
            }}
            onChangeComplete={(next) => {
              const rounded = roundToStyleStep(next, bounds.step);
              setDraft(rounded);
              commit(rounded);
            }}
          />
          <Button
            size="small"
            type="text"
            icon={<PlusOutlined />}
            aria-label={t("typography.row.increaseAria", { label })}
            disabled={disabled || shown >= bounds.max}
            onClick={(event) => step(1, event.shiftKey)}
          />
          <Tooltip title={t("typography.row.stepHint")}>
            <InputNumber
              size="small"
              className="resume-typography-number"
              style={{ width: 88 }}
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              value={shown}
              disabled={disabled}
              aria-label={t("typography.row.directInputAria", { label })}
              onChange={(next) => {
                if (next === null) return;
                setDraft(roundToStyleStep(next, bounds.step));
              }}
              onBlur={() => commitTyped(draft ?? numeric)}
              onPressEnter={() => commitTyped(draft ?? numeric)}
            />
          </Tooltip>
        </Space>
      ) : kind === "bool" ? (
        <Switch
          size="small"
          checked={Boolean(value)}
          disabled={disabled}
          aria-label={label}
          onChange={(checked) => commit(checked)}
        />
      ) : kind === "color" ? (
        <ColorPicker
          size="small"
          disabled={disabled}
          value={typeof value === "string" ? value : undefined}
          aria-label={label}
          onChangeComplete={(color) => commit(color.toHexString().toLowerCase())}
        />
      ) : (
        <Select
          size="small"
          style={{ minWidth: 110 }}
          value={typeof value === "string" ? value : undefined}
          disabled={disabled}
          aria-label={label}
          options={(STYLE_ENUM_OPTIONS[prop] ?? []).map((option) => ({
            value: option.value,
            label: t(option.labelKey),
          }))}
          onChange={(next) => commit(next)}
        />
      )}

      <span className="resume-measure-tail">
        <Typography.Text type="secondary" className="resume-measure-value">
          {kind === "number"
            ? `${formatStyleNumber(prop, shown)}${ptText ? ` · ${ptText}` : ""}`
            : kind === "color" && typeof value === "string"
              ? value
              : null}
        </Typography.Text>
        <StyleSourceTag source={source} />
        {own !== undefined ? <ParamResetButton label={label} onReset={reset} /> : null}
      </span>
    </Space>
  );
}
