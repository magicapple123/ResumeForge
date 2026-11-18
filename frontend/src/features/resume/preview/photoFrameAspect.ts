// SPDX-License-Identifier: Apache-2.0
/**
 * 照片画框比例（I-37）：把"当前模板的画框有多宽"折算成裁剪弹窗的默认比例与一句提示。
 *
 * ## 为什么需要它
 *
 * 模板里的画框是 `object-fit: contain`（如 `width: 6.3fs; height: 8fs` → 0.7875），
 * 而裁剪预设只有 `1:1 / 3:4(0.75) / 4:5(0.8)`，没有一个等于画框比例。竖版照片按高度
 * 贴合后，左右会各留 4–5px 的纸色；用户看到的是"照片缩在框里"，却不知道这是比例差，
 * 不是系统的 padding。
 *
 * 这一组函数只做两件事：
 * 1. 按**实测**的画框宽高比选最接近的预设（默认模板 → `4:5`，`resume_modern` 的
 *    1:1 画框 → `1:1`），不写死 4:5；
 * 2. 把实测比例写成"6.3:8"这样的短标签给提示文案用（不写死模板系数）。
 *
 * 不改 `contain`、不改模板比例：`cover` 会在服务端派生裁剪图之后**再裁一次**
 * （`backend/app/services/pdf_exporter/media.py`），`contain` 是刻意的。
 */
import { useEffect, useState } from "react";
import type { RefObject } from "react";

/** 裁剪预设里参与"最近比例"比较的三档（`free` 不参与）。 */
export type PresetCropAspect = "1:1" | "3:4" | "4:5";

/** 顺序即比较顺序：绝对差相同时取更靠前的一档（结果可复现）。 */
export const PRESET_CROP_ASPECTS: readonly PresetCropAspect[] = ["1:1", "3:4", "4:5"];

/** 三档预设在像素空间的宽高比。 */
export const PRESET_CROP_RATIOS: Record<PresetCropAspect, number> = {
  "1:1": 1,
  "3:4": 3 / 4,
  "4:5": 4 / 5,
};

function isPositive(value: number | null | undefined): value is number {
  return typeof value === "number" && Number.isFinite(value) && value > 0;
}

/**
 * 画框比例 → 最接近的裁剪预设。
 *
 * 用**绝对差**而不是比值或对数：`contain` 的可见留白正比于 `|画框 − 照片|`（贴合方向
 * 上的比例差），绝对差最小就是留白最小的预设。非法的比例（量不到 iframe、0、NaN）
 * 返回 `null`——调用方据此保持原来的"原图"默认，不替用户瞎猜。
 */
export function nearestCropAspect(frameRatio: number | null | undefined): PresetCropAspect | null {
  if (!isPositive(frameRatio)) return null;
  let best: PresetCropAspect = "1:1";
  let bestDiff = Number.POSITIVE_INFINITY;
  for (const aspect of PRESET_CROP_ASPECTS) {
    const diff = Math.abs(frameRatio - PRESET_CROP_RATIOS[aspect]);
    if (diff < bestDiff) {
      best = aspect;
      bestDiff = diff;
    }
  }
  return best;
}

/** 一位小数、去掉无意义的 `.0`：`6.3003 → "6.3"`、`8 → "8"`。 */
function oneDecimal(value: number): string {
  return String(Math.round(value * 10) / 10);
}

/**
 * 画框比例 → 提示里的短标签（`"6.3:8"` / `"8:6"` / `"1:1"`）。
 *
 * 归一化到长边 8（默认模板的 `height: 8fs` 就是这个 8），只保留一位小数：写"3:4"
 * 会把 0.7875 四舍五入成 0.75，反而诱导用户去选错的预设。正方形画框（`resume_modern`
 * / `resume_editorial` / `resume_scholar`）直接写 `1:1`，`8:8` 读起来像笔误。
 */
export function frameRatioLabel(ratio: number | null | undefined): string {
  if (!isPositive(ratio)) return "";
  if (Math.abs(ratio - 1) < 0.005) return "1:1";
  if (ratio < 1) return `${oneDecimal(ratio * 8)}:8`;
  return `8:${oneDecimal(8 / ratio)}`;
}

/**
 * 从一段 DOM 里读出画框宽高比：取所有 `.profile-photo` 里**最宽**的那个。
 *
 * 为什么是"最宽"而不是第一个：制作台同时挂着可见纸面与 `height: 0` 的测量 iframe
 * （`ResumePreview.tsx` 的 `measuringOnly`），两者的照片都排版过；可见的那份更宽，
 * 取它更接近用户看到的画框。`object-fit: contain` 只影响内容盒，不影响元素盒子，
 * 所以 `getBoundingClientRect()` 的宽高就是画框的宽高（实测 0.7875 = 6.3:8）。
 */
export function readFrameAspect(root: ParentNode | null | undefined): number | undefined {
  if (!root) return undefined;
  let widest = 0;
  let ratio: number | undefined;
  for (const frame of root.querySelectorAll<HTMLIFrameElement>("iframe")) {
    const image = frame.contentDocument?.querySelector<HTMLImageElement>(".profile-photo");
    const rect = image?.getBoundingClientRect();
    if (!rect || !(rect.width > 0) || !(rect.height > 0)) continue;
    if (rect.width > widest) {
      widest = rect.width;
      ratio = rect.width / rect.height;
    }
  }
  return ratio;
}

/**
 * 打开裁剪弹窗时量一次当前画框比例（不轮询）。
 *
 * `viewportRef` 有就只看这块预览容器（`PhotoCropModal` 在纸面里）；没有就在整个
 * 文档里找纸面 iframe（制作台的 `PhotoCropDialog` 与预览同页）。iframe 可能还在排版，
 * 打开后再补量两次；量不到返回 `undefined`，弹窗保持"原图"默认。
 */
export function usePhotoFrameAspect(
  open: boolean,
  viewportRef?: RefObject<HTMLElement | null>,
): number | undefined {
  const [ratio, setRatio] = useState<number | undefined>(undefined);
  useEffect(() => {
    // 关着的时候不测量；返回值也按 `open` 屏蔽上一次的旧值，于是不需要在 effect 里清 state。
    if (!open) return;
    const measure = () => {
      const next = readFrameAspect(viewportRef?.current ?? document);
      if (next) setRatio(next);
    };
    measure();
    const first = setTimeout(measure, 350);
    const second = setTimeout(measure, 1200);
    return () => {
      clearTimeout(first);
      clearTimeout(second);
    };
  }, [open, viewportRef]);
  return open ? ratio : undefined;
}
