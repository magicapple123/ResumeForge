// SPDX-License-Identifier: Apache-2.0
/**
 * 照片「边框与位置」（R-07 / R-10）：一个弹层，五个字段。
 *
 * ## 为什么是弹层而不是五行滑杆
 *
 * 制作台左栏是 380–640px 的可拖窄栏，五条新滑杆会把「照片大小」之后的所有分组推下去
 * 两屏；这五项又都是低频调整。折成一枚按钮 + 弹层，既保留可发现性，也不改变左栏节奏。
 *
 * ## 弹层里为什么是「滑杆 + 数字框」而不是纯数字框
 *
 * 纯数字框微调只能点箭头或敲数字，和同一栏「层次与间距」的手感不一致。滑杆给连续手感，
 * 右侧 68px 数字框保留精确输入与上下方向键；拖动只改本地草稿，120ms 后才写版式，
 * 拖动中的纸面反馈由 `photoFrameProbeCss` 直接注入（不等后端重排）。
 *
 * ## 默认值 = 模板现值（产品已拍板）
 *
 * 模板 CSS 一直是「1px 实线 + `var(--line)` + 4px 圆角」，而 PDF/Word 从来没画过它。
 * 现在三个出口都按同一组默认值画；只有用户**动过**某一项才写 `format_config`，
 * 因此「没调过」的旧简历 HTML 一个字节都不变。
 *
 * ## 为什么单位是 px / mm 而不是"系数"
 *
 * 边框、圆角是**像素**（模板写的就是 px），偏移是**毫米**（纸面坐标，PDF/Word 只在 mm
 * 这一层有共同语言）。前端不做换算，换算只发生在后端渲染器里。
 */
import { Button, ColorPicker, InputNumber, Popover, Slider, Space, Typography } from "antd";
import type { Color } from "antd/es/color-picker";
import { useEffect, useRef, useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeFormatConfig } from "../../../types/resumeFormat";
import { photoFrameProbeCss } from "../../../utils/resumeFormatProbe";

/**
 * 提交防抖（毫秒）。与照片系数 / 行距 / 页边距同值：一次提交就要后端重渲染一次。
 * 拖动中的反馈不靠它——`photoFrameProbeCss` 先把规则注入预览 iframe。
 */
const COMMIT_DEBOUNCE_MS = 120;

export const PHOTO_FRAME_KEYS = [
  "photo_border_width",
  "photo_border_color",
  "photo_radius",
  "photo_offset_x",
  "photo_offset_y",
] as const;

/** 与后端 `FORMAT_FIELDS` 逐项一致（改一处必须改两处）。 */
export const PHOTO_FRAME_BOUNDS: Record<
  (typeof PHOTO_FRAME_KEYS)[number],
  { min: number; max: number; step: number; fallback: number }
> = {
  photo_border_width: { min: 0, max: 8, step: 1, fallback: 1 },
  photo_border_color: { min: 0, max: 0, step: 0, fallback: 0 },
  photo_radius: { min: 0, max: 24, step: 1, fallback: 4 },
  photo_offset_x: { min: -20, max: 20, step: 0.5, fallback: 0 },
  photo_offset_y: { min: -20, max: 20, step: 0.5, fallback: 0 },
};

/** 当前值（没设过就用模板默认）。 */
export function readPhotoFrame(config: ResumeFormatConfig | null | undefined): {
  width: number;
  color: string;
  radius: number;
  offsetX: number;
  offsetY: number;
} {
  const number = (key: (typeof PHOTO_FRAME_KEYS)[number]) => {
    const raw = config?.[key];
    return typeof raw === "number" && Number.isFinite(raw) ? raw : PHOTO_FRAME_BOUNDS[key].fallback;
  };
  const rawColor = config?.photo_border_color;
  return {
    width: number("photo_border_width"),
    color: typeof rawColor === "string" ? rawColor : "",
    radius: number("photo_radius"),
    offsetX: number("photo_offset_x"),
    offsetY: number("photo_offset_y"),
  };
}

/** 写回一项；值等于模板默认时**删键**（"没调过"只有一种形态）。 */
export function withPhotoFrame(
  config: ResumeFormatConfig | null | undefined,
  key: (typeof PHOTO_FRAME_KEYS)[number],
  value: number | string | null,
): ResumeFormatConfig {
  const next: ResumeFormatConfig = { ...(config ?? {}) };
  if (value === null || value === "") {
    delete next[key];
    return next;
  }
  if (key === "photo_border_color") {
    next[key] = String(value).toLowerCase();
    return next;
  }
  const bounds = PHOTO_FRAME_BOUNDS[key];
  const number = Number(value);
  if (!Number.isFinite(number)) delete next[key];
  else if (number === bounds.fallback) delete next[key];
  else next[key] = number;
  return next;
}

/** 是否动过任意一项（决定按钮上要不要提示"已调整"）。 */
export function photoFrameCustomized(config: ResumeFormatConfig | null | undefined): boolean {
  return PHOTO_FRAME_KEYS.some((key) => {
    const raw = config?.[key];
    if (raw === undefined || raw === null || raw === "") return false;
    if (key === "photo_border_color") return true;
    return Number(raw) !== PHOTO_FRAME_BOUNDS[key].fallback;
  });
}

interface FrameNumberRowProps {
  label: string;
  suffix: string;
  value: number;
  min: number;
  max: number;
  step: number;
  precision?: number;
  disabled: boolean;
  onChange: (value: number | null) => void;
}

/**
 * 一行「标签 + 滑杆 + 数字框」。
 *
 * 数字框保留是为了**可键盘输入精确值**（滑杆拖不到 0.5mm 的细活）；但它只有 68px，
 * 所以关掉步进按钮（`controls={false}`）——antd 的 InputNumber 即使不显示按钮，
 * 上下方向键仍然按 `step` 步进，键盘能力一项不少。
 */
function FrameNumberRow({
  label,
  suffix,
  value,
  min,
  max,
  step,
  precision,
  disabled,
  onChange,
}: FrameNumberRowProps) {
  return (
    <div className="resume-photo-frame-row">
      <span className="resume-photo-frame-label">{label}</span>
      <Slider
        className="resume-photo-frame-slider"
        min={min}
        max={max}
        step={step}
        value={value}
        disabled={disabled}
        // 右侧常驻读数，再弹气泡会盖住面板（与照片系数的差异就在这里）。
        tooltip={{ open: false }}
        aria-label={label}
        ariaLabelForHandle={label}
        onChange={(next) => onChange(typeof next === "number" ? next : null)}
      />
      <InputNumber
        className="resume-photo-frame-number"
        size="small"
        min={min}
        max={max}
        step={step}
        precision={precision}
        controls={false}
        suffix={suffix}
        disabled={disabled || undefined}
        aria-label={label}
        value={value}
        onChange={(next) => onChange(typeof next === "number" ? next : null)}
      />
    </div>
  );
}

interface Props {
  formatConfig?: ResumeFormatConfig | null;
  disabled?: boolean;
  hasPhoto?: boolean;
  onChange: (next: ResumeFormatConfig) => void;
  /** 拖动中的即时反馈：`.profile-photo { … }`。空串 = 清掉探针。 */
  onProbe?: (css: string) => void;
}

export default function PhotoFrameControl({
  formatConfig,
  disabled = false,
  hasPhoto,
  onChange,
  onProbe,
}: Props) {
  useLocale();
  const [open, setOpen] = useState(false);
  /**
   * 本地草稿：**连续改多个字段时以草稿为基底**，而不是以上一次渲染的 props 为基底。
   *
   * 实机复现过：先改「左右偏移」再改「上下偏移」，第二次的 `formatConfig` 还是旧 props，
   * 于是第一个偏移被覆盖掉。父层保存是异步的，props 追不上连续输入；草稿在组件内
   * 同步累加，props 回来时再对齐（签名比较，与制作台其它面板同一模式）。
   */
  const signature = JSON.stringify(formatConfig ?? {});
  const [draft, setDraft] = useState<ResumeFormatConfig>(formatConfig ?? {});
  const [draftSignature, setDraftSignature] = useState(signature);
  if (draftSignature !== signature) {
    setDraftSignature(signature);
    setDraft(formatConfig ?? {});
  }
  const frame = readPhotoFrame(draft);
  const customized = photoFrameCustomized(draft);
  const noPhoto = hasPhoto === false;
  const locked = disabled || noPhoto;

  // 挂起的那一次提交：拖动中只攒最后一次，到点（或关面板时）才写版式。
  const pendingRef = useRef<ResumeFormatConfig | null>(null);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);
  const onChangeRef = useRef(onChange);
  // 卸载时 flush 用的是"最后一次渲染的那份 onChange"：在 effect 里同步，避免渲染期写 ref。
  useEffect(() => {
    onChangeRef.current = onChange;
  });

  const clearTimer = () => {
    if (timerRef.current) clearTimeout(timerRef.current);
    timerRef.current = null;
  };

  /** 把挂起的那一次立刻送出去（关闭面板 / 卸载时调用，否则最后一步拖动会丢）。 */
  const flush = () => {
    clearTimer();
    const pending = pendingRef.current;
    pendingRef.current = null;
    if (pending) onChangeRef.current(pending);
  };

  useEffect(() => () => flush(), []); // eslint-disable-line react-hooks/exhaustive-deps -- 只读 ref

  /**
   * 滑杆 / 数字框：草稿立刻更新（拖动跟手），120ms 后才写版式。
   * 探针先于提交——它写的就是后端 `format_css` 会写的那条 `.profile-photo` 规则。
   */
  const commitLater = (key: (typeof PHOTO_FRAME_KEYS)[number], value: number | null) => {
    const next = withPhotoFrame(draft, key, value);
    setDraft(next);
    pendingRef.current = next;
    onProbe?.(photoFrameProbeCss(readPhotoFrame(next)));
    clearTimer();
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      const pending = pendingRef.current;
      pendingRef.current = null;
      if (pending) onChangeRef.current(pending);
    }, COMMIT_DEBOUNCE_MS);
  };

  /** 颜色 / 跟随分隔线是离散选择：立刻落库，顺手把挂起的数字改动一起送出。 */
  const commitNow = (key: (typeof PHOTO_FRAME_KEYS)[number], value: string | null) => {
    const next = withPhotoFrame(draft, key, value);
    setDraft(next);
    pendingRef.current = null;
    clearTimer();
    onProbe?.(photoFrameProbeCss(readPhotoFrame(next)));
    onChange(next);
  };

  const body = (
    <div className="resume-photo-frame-panel">
      <FrameNumberRow
        label={t("resume.photo.frame.width")}
        suffix="px"
        min={PHOTO_FRAME_BOUNDS.photo_border_width.min}
        max={PHOTO_FRAME_BOUNDS.photo_border_width.max}
        step={PHOTO_FRAME_BOUNDS.photo_border_width.step}
        precision={0}
        value={frame.width}
        disabled={locked}
        onChange={(value) => commitLater("photo_border_width", value)}
      />
      <div className="resume-photo-frame-row">
        <span className="resume-photo-frame-label">{t("resume.photo.frame.color")}</span>
        <Space size={6} className="resume-photo-frame-color">
          <ColorPicker
            size="small"
            disabled={locked || undefined}
            aria-label={t("resume.photo.frame.color")}
            value={frame.color || "#e7ebf0"}
            onChange={(color: Color) => commitNow("photo_border_color", color.toHexString())}
          />
          {frame.color ? (
            <Button size="small" type="link" onClick={() => commitNow("photo_border_color", null)}>
              {t("resume.photo.frame.followLine")}
            </Button>
          ) : (
            <Typography.Text type="secondary" className="resume-photo-frame-hint">
              {t("resume.photo.frame.followLineHint")}
            </Typography.Text>
          )}
        </Space>
      </div>
      <FrameNumberRow
        label={t("resume.photo.frame.radius")}
        suffix="px"
        min={PHOTO_FRAME_BOUNDS.photo_radius.min}
        max={PHOTO_FRAME_BOUNDS.photo_radius.max}
        step={PHOTO_FRAME_BOUNDS.photo_radius.step}
        precision={0}
        value={frame.radius}
        disabled={locked}
        onChange={(value) => commitLater("photo_radius", value)}
      />
      <FrameNumberRow
        label={t("resume.photo.frame.offsetX")}
        suffix="mm"
        min={PHOTO_FRAME_BOUNDS.photo_offset_x.min}
        max={PHOTO_FRAME_BOUNDS.photo_offset_x.max}
        step={PHOTO_FRAME_BOUNDS.photo_offset_x.step}
        value={frame.offsetX}
        disabled={locked}
        onChange={(value) => commitLater("photo_offset_x", value)}
      />
      <FrameNumberRow
        label={t("resume.photo.frame.offsetY")}
        suffix="mm"
        min={PHOTO_FRAME_BOUNDS.photo_offset_y.min}
        max={PHOTO_FRAME_BOUNDS.photo_offset_y.max}
        step={PHOTO_FRAME_BOUNDS.photo_offset_y.step}
        value={frame.offsetY}
        disabled={locked}
        onChange={(value) => commitLater("photo_offset_y", value)}
      />
      {/* 单位写在数字框后缀里，步进写在这里：0.5mm 的细活靠滑杆拖不出来，
          用户需要知道该去数字框敲。 */}
      <Typography.Text type="secondary" className="resume-photo-frame-hint">
        {t("resume.photo.frame.stepHint")}
      </Typography.Text>
      {noPhoto ? (
        <Typography.Text type="secondary" className="resume-photo-frame-hint">
          {t("resume.photo.scale.noPhoto")}
        </Typography.Text>
      ) : null}
    </div>
  );

  return (
    <Space size={6}>
      <span className="resume-measure-label">{t("resume.photo.frame.label")}</span>
      <Popover
        open={open}
        trigger="click"
        placement="leftTop"
        onOpenChange={(next) => {
          // 关闭时先把挂起的那一次写进去，再清探针——否则最后一个 120ms 内的拖动会丢。
          if (next) {
            setOpen(true);
            return;
          }
          flush();
          onProbe?.("");
          setOpen(false);
        }}
        content={body}
      >
        <Button size="small" disabled={disabled || noPhoto || undefined} aria-expanded={open}>
          {customized ? t("resume.photo.frame.openCustom") : t("resume.photo.frame.open")}
        </Button>
      </Popover>
    </Space>
  );
}
