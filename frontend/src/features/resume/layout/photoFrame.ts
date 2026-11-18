// SPDX-License-Identifier: Apache-2.0
/**
 * 照片框（边框 / 圆角 / 偏移）的纯函数与常量（I-01 从 `PhotoFrameControl.tsx` 抽出）。
 *
 * 抽出原因：I-01 的右键「照片框…」浮层与左栏「边框与位置」弹层要共用同一份读写语义，
 * 复制一份必然漂移（`PhotoFrameControl.tsx` 仍在 re-export，既有 import 路径不变）。
 *
 * ## 默认值 = 模板现值（产品已拍板）
 *
 * 模板 CSS 一直是「1px 实线 + `var(--line)` + 4px 圆角」，而 PDF/Word 从来没画过它。
 * 现在三个出口都按同一组默认值画；只有用户**动过**某一项才写 `format_config`，
 * 因此「没调过」的旧简历 HTML 一个字节都不变。
 */
import type { ResumeFormatConfig } from "../../../types/resumeFormat";

/**
 * 提交防抖（毫秒）。与照片系数 / 行距 / 页边距同值：一次提交就要后端重渲染一次。
 * 拖动中的反馈不靠它——`photoFrameProbeCss` 先把规则注入预览 iframe。
 */
export const COMMIT_DEBOUNCE_MS = 120;

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
  // I-32：与后端 FORMAT_FIELDS 逐项对齐（此前这里是 8 / 24 / ±20 的旧区间，
  // 后端放宽后不同步会重现"拖不过去"——正是本条要消灭的症状）。
  photo_border_width: { min: 0, max: 16, step: 1, fallback: 1 },
  photo_border_color: { min: 0, max: 0, step: 0, fallback: 0 },
  photo_radius: { min: 0, max: 48, step: 1, fallback: 4 },
  photo_offset_x: { min: -40, max: 40, step: 0.5, fallback: 0 },
  photo_offset_y: { min: -40, max: 40, step: 0.5, fallback: 0 },
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
