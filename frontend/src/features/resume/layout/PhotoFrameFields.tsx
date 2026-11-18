// SPDX-License-Identifier: Apache-2.0
/**
 * 照片框的六行参数（I-01 从 `PhotoFrameControl.tsx` 抽出的**唯一一份**逻辑）。
 *
 * 两个宿主共用：
 * - 左栏「边框与位置」弹层（`PhotoFrameControl.tsx`：标签 + Popover + 本组件）；
 * - 字段右键「照片框…」浮层（`editor/PhotoFramePopover.tsx`）。
 *
 * ## 为什么是「滑杆 + 数字框」而不是纯数字框
 *
 * 纯数字框微调只能点箭头或敲数字，和同一栏「层次与间距」的手感不一致。滑杆给连续手感，
 * 右侧 68px 数字框保留精确输入与上下方向键；拖动只改本地草稿，120ms 后才写版式，
 * 拖动中的纸面反馈由 `photoFrameProbeCss` 直接注入（不等后端重排）。
 *
 * ## 本地草稿
 *
 * 连续改多个字段时以草稿为基底，而不是以上一次渲染的 props 为基底：父层保存是异步的，
 * props 追不上连续输入（实机复现过"先改左右偏移再改上下偏移，第一个被覆盖"）。
 */
import { Button, ColorPicker, InputNumber, Slider, Space, Typography } from "antd";
import type { Color } from "antd/es/color-picker";
import { useEffect, useRef, useState } from "react";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ResumeFormatConfig } from "../../../types/resumeFormat";
import { photoFrameProbeCss } from "../../../utils/resumeFormatProbe";
import {
  COMMIT_DEBOUNCE_MS,
  PHOTO_FRAME_BOUNDS,
  PHOTO_FRAME_KEYS,
  readPhotoFrame,
  withPhotoFrame,
} from "./photoFrame";

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

export interface PhotoFrameFieldsProps {
  formatConfig?: ResumeFormatConfig | null;
  disabled?: boolean;
  hasPhoto?: boolean;
  onChange: (next: ResumeFormatConfig) => void;
  /** 拖动中的即时反馈：`.profile-photo { … }`。空串 = 清掉探针。 */
  onProbe?: (css: string) => void;
  /** 是否显示「照片可以越界压住正文」的提示（两个宿主都显示）。 */
  showOverlapHint?: boolean;
  /**
   * 把 `flush`（立刻送出挂起的那次提交）交回宿主：弹层关闭时要先落库再清探针，
   * 否则最后 120ms 内的拖动会等到定时器才写（旧行为就是关闭即提交）。
   */
  flushRef?: { current: (() => void) | null };
}

export default function PhotoFrameFields({
  formatConfig,
  disabled = false,
  hasPhoto,
  onChange,
  onProbe,
  showOverlapHint = true,
  flushRef,
}: PhotoFrameFieldsProps) {
  // 模块级 `t()` 不会因为切语言重渲染：这里订阅语言变化（守卫见
  // `i18n/localeSubscription.test.ts`）。
  useLocale();
  const signature = JSON.stringify(formatConfig ?? {});
  const [draft, setDraft] = useState<ResumeFormatConfig>(formatConfig ?? {});
  const [draftSignature, setDraftSignature] = useState(signature);
  if (draftSignature !== signature) {
    setDraftSignature(signature);
    setDraft(formatConfig ?? {});
  }
  const frame = readPhotoFrame(draft);
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

  // 把 flush 交给宿主（弹层关闭 = "立刻落库"）；每次渲染换掉引用，调用方永远拿到最新闭包。
  useEffect(() => {
    if (!flushRef) return;
    flushRef.current = flush;
    return () => {
      flushRef.current = null;
    };
  });

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

  return (
    <div className="resume-photo-frame-panel" data-photo-frame-fields="">
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
      {/* I-31：照片脱流后允许压住正文，这条提示是"越界"的唯一出口——不写在这里，
          用户只会看到文字被照片盖住却不知道能改什么。字号 11px（与其它提示同档）。 */}
      {showOverlapHint && !noPhoto ? (
        <Typography.Text
          type="secondary"
          className="resume-photo-frame-hint"
          style={{ fontSize: 11 }}
          data-testid="photo-frame-overlap-hint"
        >
          {t("resume.photo.frame.overlapHint")}
        </Typography.Text>
      ) : null}
    </div>
  );
}
