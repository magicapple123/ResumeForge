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
  Switch,
  Tooltip,
  Typography,
} from "antd";
import { useEffect, useRef, useState } from "react";
import { t } from "../../../i18n";
import type { ResumeStyleSource } from "./styleOverrides";
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
import ParamResetButton from "./ParamResetButton";
import StyleSourceTag from "./StyleSourceTag";
import { useLocale } from "../../../i18n/i18nContext";

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
  useLocale();
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
  /**
   * R-34B：**没有显式覆盖** = 这一行是继承来的（`own === undefined`）。
   *
   * 此时 `value` 是模板/角色的基准（R-34A 之后才有真实值），把它当成"用户设成 0"来显示
   * 是错的（缩进未覆盖时读数写 0.00，用户以为模板缩进真是 0）。
   *
   * 显示层改三处：输入框留空 + 占位「继承」、尾部写「继承模板」、滑杆压暗。
   * **但滑杆与 ± 仍可操作**（只有"目录还没给基准"即 `value === undefined` 时才禁用）：
   * 它们是"从当前基准开始改"的入口——把手停在基准上、按一下就从基准挪一步，
   * 正好是这一条验收要求的那半句；把这些入口一并禁用会让"未覆盖"变成死路。
   */
  const inherited = kind === "number" && own === undefined;
  /** 有没有可以当起点的基准；没有时滑杆与 ± 都无处可依。 */
  const steppable = numeric !== null;
  const unit = prop === "line_height" ? "" : "×";
  /** R-34C：单位并入输入框（不再在尾部重复一遍数字）。 */
  const numberFormatter = (raw?: string | number): string => {
    if (raw === undefined || raw === null || raw === "") return "";
    const text = String(raw);
    return unit === "" || text.endsWith(unit) ? text : `${text}${unit}`;
  };
  const numberParser = (text?: string): string => (text ?? "").replace(/[^\d.-]/g, "");

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

  /** 步进：`Shift` 单击 = 五倍步进（D02 的"临时放大步进"）；从 `shown`（可能来自基准）起算。 */
  const step = (direction: 1 | -1, amplified: boolean) => {
    if (!bounds || !steppable) return;
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

  // 根节点是 grid 而不是 antd `Space`：数字类属性要排两行（控件行 + 值/来源行），
  // `Space` 的 wrap 只会在放不下时把尾部整段折下去、左缘回到标签列（用户截图 2）。
  // 行结构见 `styles/resume-workbench-controls.css` 的「局部排版面板：行布局」段。
  return (
    <div
      className={`resume-wb-row resume-typography-row${bounds ? " is-numeric" : " is-inline"}`}
      data-testid={testId}
    >
      <Tooltip title={t("typography.row.resetHint")}>
        <span
          className="resume-measure-label resume-typography-label"
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
        <div className="resume-typography-controls">
          <Button
            size="small"
            type="text"
            icon={<MinusOutlined />}
            aria-label={t("typography.row.decreaseAria", { label })}
            disabled={disabled || !steppable || shown <= bounds.min}
            onClick={(event) => step(-1, event.shiftKey)}
          />
          <Tooltip title={inherited ? t("typography.row.inheritedSliderHint") : ""}>
            <Slider
              className="resume-wb-slider"
              // 降级态压暗但**不 disabled**：位置停在当前基准，拖一下就落成覆盖。
              style={inherited ? { opacity: 0.55 } : undefined}
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              value={shown}
              disabled={disabled || !steppable}
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
          </Tooltip>
          <Button
            size="small"
            type="text"
            icon={<PlusOutlined />}
            aria-label={t("typography.row.increaseAria", { label })}
            disabled={disabled || !steppable || shown >= bounds.max}
            onClick={(event) => step(1, event.shiftKey)}
          />
          <Tooltip title={t("typography.row.stepHint")}>
            <InputNumber
              size="small"
              className="resume-typography-number"
              min={bounds.min}
              max={bounds.max}
              step={bounds.step}
              // 降级态：空 + 占位「继承」；一旦拖过滑杆（draft 有值）就显示那个值。
              value={inherited && draft === null ? null : shown}
              placeholder={inherited ? t("typography.row.inheritedPlaceholder") : undefined}
              formatter={numberFormatter}
              parser={numberParser}
              title={ptText ?? undefined}
              disabled={disabled}
              aria-label={t("typography.row.directInputAria", { label })}
              onChange={(next) => {
                if (next === null) return;
                // `parser` 返回字符串（带单位时不能直接给 number），这里统一收敛成数值。
                const parsed = typeof next === "string" ? Number(next) : next;
                if (!Number.isFinite(parsed)) return;
                setDraft(roundToStyleStep(parsed, bounds.step));
              }}
              onBlur={() => commitTyped(draft ?? numeric)}
              onPressEnter={() => commitTyped(draft ?? numeric)}
            />
          </Tooltip>
        </div>
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

      <span className="resume-measure-tail resume-typography-tail">
        {/* R-34C：数值只在输入框里出现一次；尾部只留"继承 / 来源 / 恢复"。 */}
        {inherited ? (
          <Typography.Text type="secondary" className="resume-measure-value">
            {t("typography.row.inherited")}
          </Typography.Text>
        ) : kind === "color" && typeof value === "string" ? (
          <Typography.Text type="secondary" className="resume-measure-value">
            {value}
          </Typography.Text>
        ) : null}
        <StyleSourceTag source={source} />
        {own !== undefined ? <ParamResetButton label={label} onReset={reset} /> : null}
      </span>
    </div>
  );
}
