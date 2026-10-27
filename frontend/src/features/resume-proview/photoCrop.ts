// SPDX-License-Identifier: Apache-2.0
/**
 * 照片**非破坏裁剪**的参数模型（D09）。
 *
 * ## 形状与后端冻结契约逐字一致
 *
 * `resume_photo_crop.py` 的域（Wave2 第 3 册 §7.1）：
 *
 * ```text
 * photo_crop = {
 *   "version": 1,
 *   "source": {"sha256": "<64 位小写 hex>", "width": int, "height": int},
 *   "rect": {"x": 0..1, "y": 0..1, "w": 0<w<=1, "h": 0<h<=1},
 *   "aspect": "free" | "1:1" | "4:5" | "3:4",
 * }
 * ```
 *
 * 两个容易写错、但会让保存静默失效的点（本文件按后端校准过）：
 * 1. **哈希键是 `sha256`，且哈希的是"照片 data URL 字符串"本身**（不解码）；
 * 2. **矩形键是 `x/y/w/h`**（不是 width/height），`aspect` 取值只有四个串。
 *
 * ## 非破坏边界
 *
 * - 原图引用不动：`content.photo`（data URL）始终是**原图**；裁剪只产生参数。
 * - 渲染时按 rect 派生裁剪图（HTML/PDF/Word 消费同一份），原图仍可恢复。
 * - 前端**不再**在纸面 iframe 上叠 `object-view-box`（2026-10 #10）：那份纸面 HTML 的
 *   照片已经由后端按同一参数派生过，再叠一层会二次裁切、取景错位。
 *
 * ## 读写走 v1 域协议
 *
 * 写：`withPhotoCrop` → `features/resume-layout/formatDomains.withFormatDomain`；读：
 * `readFormatDomain`（更高版本整域丢弃）。各域各写一份 config 会出现"空域落库 / 版本处置"
 * 两套语义，这里不重复。
 */
import type { ResumeFormatConfig } from "../../types/resumeFormat";
import { readFormatDomain, withFormatDomain } from "../resume-layout/formatDomains";
import { sha256Hex } from "./sha256";

/** 后端 `ASPECTS` 的四个取值；`free` = 不锁定（跟随原图比例）。 */
export type PhotoAspect = "free" | "1:1" | "4:5" | "3:4";

/** 归一化裁剪矩形（相对原图，0–1）。键名与后端 `rect` 逐字一致。 */
export interface CropRect {
  x: number;
  y: number;
  w: number;
  h: number;
}

/** 来源信息：哈希是照片 data URL 字符串的 sha256（后端 `photo_sha256` 同口径）。 */
export interface PhotoSourceInfo {
  sha256: string;
  width: number;
  height: number;
}

export interface PhotoCropParams {
  version: 1;
  source: PhotoSourceInfo;
  rect: CropRect;
  aspect: PhotoAspect;
}

/** 界面上的三个自由量（比例、取景大小、位置），提交时才换算成矩形。 */
export interface PhotoCropDraft {
  aspect: PhotoAspect;
  /** 取景大小：1 = 最大可用区域，越小越"放大"。 */
  zoom: number;
  /** 位置：-1 = 靠左/靠上，0 = 居中，1 = 靠右/靠下。 */
  offsetX: number;
  offsetY: number;
}

export const PHOTO_CROP_FORMAT_KEY = "photo_crop";
export const PHOTO_CROP_VERSION = 1;
export const MIN_CROP_ZOOM = 0.35;
export const MAX_CROP_ZOOM = 1;
export const DEFAULT_CROP_DRAFT: PhotoCropDraft = {
  aspect: "free",
  zoom: 1,
  offsetX: 0,
  offsetY: 0,
};

/** 界面可选的锁定比例（顺序即分段控件顺序）。 */
export const PHOTO_CROP_ASPECTS: readonly PhotoAspect[] = ["free", "1:1", "3:4", "4:5"];

/** 固定比例档位（宽/高）；`free` 由原图决定。 */
export const FIXED_ASPECT_RATIOS: Record<Exclude<PhotoAspect, "free">, number> = {
  "1:1": 1,
  "3:4": 3 / 4,
  "4:5": 4 / 5,
};

/** 后端 `MAX_SIDE`。 */
const MAX_SIDE = 20_000;

function clamp01(value: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(1, Math.max(0, value));
}

function round4(value: number): number {
  return Math.round(value * 10000) / 10000;
}

function clampBetween(value: number, min: number, max: number): number {
  if (!Number.isFinite(value)) return 0;
  return Math.min(max, Math.max(min, value));
}

/** 原图宽高比；来源尺寸不合法时返回 1（正方形），让调用方仍能画出裁剪框。 */
export function sourceAspect(source: PhotoSourceInfo | null | undefined): number {
  if (!source || !(source.width > 0) || !(source.height > 0)) return 1;
  return source.width / source.height;
}

/** 目标比例（宽/高）；`free` = 跟随原图。 */
export function targetAspectRatio(
  aspect: PhotoAspect,
  source: PhotoSourceInfo | null | undefined,
): number {
  if (aspect === "free") return sourceAspect(source);
  return FIXED_ASPECT_RATIOS[aspect];
}

/** 比例 r 下"刚好装进原图"的最大归一化矩形（未放大）。 */
function baseRectForRatio(imageRatio: number, rectRatio: number): CropRect {
  const ratio = rectRatio > 0 ? rectRatio : imageRatio;
  if (ratio >= imageRatio) {
    const h = imageRatio / ratio;
    return { x: 0, y: (1 - h) / 2, w: 1, h };
  }
  const w = ratio / imageRatio;
  return { x: (1 - w) / 2, y: 0, w, h: 1 };
}

/** 草稿 → 归一化矩形（核心几何；纯函数）。 */
export function computeCropRect(source: PhotoSourceInfo, draft: PhotoCropDraft): CropRect {
  const imageRatio = sourceAspect(source);
  const rectRatio = targetAspectRatio(draft.aspect, source);
  const base = baseRectForRatio(imageRatio, rectRatio);
  const zoom = Math.min(MAX_CROP_ZOOM, Math.max(MIN_CROP_ZOOM, draft.zoom || MAX_CROP_ZOOM));
  const w = clamp01(base.w * zoom);
  const h = clamp01(base.h * zoom);
  const maxShiftX = Math.max(0, 1 - w) / 2;
  const maxShiftY = Math.max(0, 1 - h) / 2;
  const x = clamp01(maxShiftX * (1 + clampBetween(draft.offsetX, -1, 1)));
  const y = clamp01(maxShiftY * (1 + clampBetween(draft.offsetY, -1, 1)));
  return {
    x: round4(Math.min(x, 1 - w)),
    y: round4(Math.min(y, 1 - h)),
    w: round4(w),
    h: round4(h),
  };
}

/** 草稿 → 可保存参数（带来源哈希与像素尺寸）。 */
export function createPhotoCropParams(
  source: PhotoSourceInfo,
  draft: PhotoCropDraft,
): PhotoCropParams {
  return {
    version: PHOTO_CROP_VERSION,
    aspect: draft.aspect,
    rect: computeCropRect(source, draft),
    source: { ...source },
  };
}

/** 已保存参数 → 草稿（重新打开裁剪弹窗时还原滑块位置）。 */
export function draftFromParams(params: PhotoCropParams): PhotoCropDraft {
  const imageRatio = sourceAspect(params.source);
  const rectRatio =
    params.rect.h > 0
      ? (params.rect.w * params.source.width) / (params.rect.h * params.source.height)
      : imageRatio;
  const base = baseRectForRatio(imageRatio, rectRatio);
  const zoom =
    base.w > 0 ? clampBetween(params.rect.w / base.w, MIN_CROP_ZOOM, MAX_CROP_ZOOM) : MAX_CROP_ZOOM;
  const maxShiftX = Math.max(0, 1 - params.rect.w) / 2;
  const maxShiftY = Math.max(0, 1 - params.rect.h) / 2;
  return {
    aspect: params.aspect,
    zoom,
    offsetX: maxShiftX > 0 ? clampBetween(params.rect.x / maxShiftX - 1, -1, 1) : 0,
    offsetY: maxShiftY > 0 ? clampBetween(params.rect.y / maxShiftY - 1, -1, 1) : 0,
  };
}

/** 全幅（没有真正裁剪）：等价于"恢复原图"。 */
export function isFullFrame(params: PhotoCropParams): boolean {
  const { rect } = params;
  return rect.x <= 0.0001 && rect.y <= 0.0001 && rect.w >= 0.9999 && rect.h >= 0.9999;
}

function isUnit(value: unknown): value is number {
  return typeof value === "number" && Number.isFinite(value);
}

function readRect(value: unknown): CropRect | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const x = record.x;
  const y = record.y;
  const w = record.w;
  const h = record.h;
  if (!isUnit(x) || !isUnit(y) || !isUnit(w) || !isUnit(h)) return null;
  if (x < 0 || y < 0 || x > 1 || y > 1) return null;
  if (w <= 0 || h <= 0 || w > 1 || h > 1) return null;
  if (x + w > 1 + 1e-6 || y + h > 1 + 1e-6) return null;
  return { x, y, w, h };
}

function readSource(value: unknown): PhotoSourceInfo | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  const sha = record.sha256;
  const width = record.width;
  const height = record.height;
  if (typeof sha !== "string" || !/^[0-9a-f]{64}$/.test(sha)) return null;
  if (typeof width !== "number" || typeof height !== "number") return null;
  if (!Number.isInteger(width) || !Number.isInteger(height)) return null;
  if (width < 1 || height < 1 || width > MAX_SIDE || height > MAX_SIDE) return null;
  return { sha256: sha, width, height };
}

/**
 * 解析保存过的裁剪参数（后端冻结形状；旧版本 / 畸形数据一律当作"没有裁剪"）。
 *
 * `aspect` 非法时按后端行为回落 `free`（不整域丢弃）：矩形才是决定性数据。
 */
export function parsePhotoCrop(value: unknown): PhotoCropParams | null {
  if (!value || typeof value !== "object") return null;
  const record = value as Record<string, unknown>;
  if (record.version !== PHOTO_CROP_VERSION) return null;
  const rect = readRect(record.rect);
  const source = readSource(record.source);
  if (!rect || !source) return null;
  const aspect = record.aspect;
  const normalizedAspect: PhotoAspect =
    aspect === "1:1" || aspect === "3:4" || aspect === "4:5" ? aspect : "free";
  return { version: PHOTO_CROP_VERSION, source, rect, aspect: normalizedAspect };
}

/** 照片字符串的 sha256（后端 `photo_sha256` 同口径；空串返回空串）。 */
export function photoSha256(photo: string | null | undefined): string {
  return photo ? sha256Hex(photo) : "";
}

/** 从照片 data URL + 像素尺寸构造来源信息。 */
export function buildPhotoSource(photo: string, width: number, height: number): PhotoSourceInfo {
  return { sha256: photoSha256(photo), width, height };
}

/** 从 `format_config` 读裁剪参数（走 v1 域协议；更高版本整域丢弃）。 */
export function readPhotoCropFromFormatConfig(
  config: ResumeFormatConfig | null | undefined,
): PhotoCropParams | null {
  return parsePhotoCrop(readFormatDomain(config, PHOTO_CROP_FORMAT_KEY));
}

/**
 * 把裁剪参数并入 `format_config`（`null` = 删除域，恢复原图）。
 *
 * **写路径统一走 `features/resume-layout/formatDomains` 的 v1 域协议**：域固定带
 * `version: 1`、空域删键（R3）、版本处置与 W07/W08 域一致。
 */
export function withPhotoCrop(
  config: ResumeFormatConfig | null | undefined,
  params: PhotoCropParams | null,
): ResumeFormatConfig {
  return withFormatDomain(
    config,
    PHOTO_CROP_FORMAT_KEY,
    params ? (params as unknown as Record<string, unknown>) : null,
  );
}
