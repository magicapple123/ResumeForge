// SPDX-License-Identifier: Apache-2.0
/**
 * 照片裁剪参数的**会话级临时存储**（D09 的过渡桥）。
 *
 * ## 为什么是临时的
 *
 * 正式归属是 `format_config.photo_crop`（随版式保存 + 进历史），但后端白名单尚未放行
 * （be-render / contracts 正在定契约）。在放行之前，若把参数只放在组件 state 里，
 * 用户关掉制作台就丢——那等于做了个不能保存的功能。
 *
 * 选择 sessionStorage 而不是 localStorage：
 * - 裁剪参数是**文档数据**，不是偏好；AGENTS 只允许偏好进 localStorage；
 * - sessionStorage 在标签页关闭后消失，最坏情况是"没保存的裁剪没了"，与未保存正文同一语义。
 *
 * **契约放行后本文件删除**：读写改走 layout 保存链路（`withPhotoCrop` 生成的
 * format_config 片段），届时由 wb-core 的保存状态机负责 dirty/冲突/历史。
 */
import { parsePhotoCrop, type PhotoCropParams } from "./photoCrop";

/** 键前缀：与 `resumeforge.form-draft.v1` 同一族，标明会话级草稿。 */
export const PHOTO_CROP_STORAGE_PREFIX = "resumeforge.proview.photo-crop.v1";

export interface StorageLike {
  getItem(key: string): string | null;
  setItem(key: string, value: string): void;
  removeItem(key: string): void;
}

/** 存储键：按简历隔离（切换记录不会拿到上一份的裁剪）。 */
export function photoCropStorageKey(resumeId: number | null | undefined): string | null {
  if (typeof resumeId !== "number" || !Number.isFinite(resumeId)) return null;
  return `${PHOTO_CROP_STORAGE_PREFIX}:${resumeId}`;
}

function defaultStorage(): StorageLike | null {
  try {
    return typeof window === "undefined" ? null : window.sessionStorage;
  } catch {
    return null;
  }
}

/** 读回上次的裁剪参数；没有 / 已过期 / 非本简历的一律 `null`。 */
export function loadPhotoCrop(
  resumeId: number | null | undefined,
  storage: StorageLike | null = defaultStorage(),
): PhotoCropParams | null {
  const key = photoCropStorageKey(resumeId);
  if (!key || !storage) return null;
  try {
    const raw = storage.getItem(key);
    if (!raw) return null;
    return parsePhotoCrop(JSON.parse(raw));
  } catch {
    return null;
  }
}

/** 写入会话级裁剪参数（保存失败不是功能错误，返回是否落盘成功供测试与提示使用）。 */
export function savePhotoCrop(
  resumeId: number | null | undefined,
  params: PhotoCropParams,
  storage: StorageLike | null = defaultStorage(),
): boolean {
  const key = photoCropStorageKey(resumeId);
  if (!key || !storage) return false;
  try {
    storage.setItem(key, JSON.stringify(params));
    return true;
  } catch {
    return false;
  }
}

/** 清掉这份简历的会话级裁剪参数（恢复原图 / 移除照片时）。 */
export function clearPhotoCrop(
  resumeId: number | null | undefined,
  storage: StorageLike | null = defaultStorage(),
): void {
  const key = photoCropStorageKey(resumeId);
  if (!key || !storage) return;
  try {
    storage.removeItem(key);
  } catch {
    // 忽略：清不掉也不影响本次会话的界面状态。
  }
}
