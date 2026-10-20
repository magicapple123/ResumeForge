// SPDX-License-Identifier: Apache-2.0
/** 个人照片接口：多张照片的上传、切换、重命名与删除。 */
import type { ProfilePhoto } from "../types";
import { request, uploadWithProgress } from "./client";

export function listProfilePhotos(): Promise<ProfilePhoto[]> {
  return request("/profile/photos");
}

/**
 * 上传一张照片（base64 JSON）。2 MB 的照片 base64 后近 2.7 MB，fetch 版没有上传
 * 进度——改走 XHR 进度上传（onProgress 报 0-100），面板能在按钮旁画进度条。
 */
export function createProfilePhoto(
  image: string,
  name = "",
  onProgress?: (percent: number) => void,
): Promise<ProfilePhoto> {
  return uploadWithProgress("/profile/photos", JSON.stringify({ image, name }), { onProgress });
}

/** 重命名照片，或把它设为当前使用的照片（一次只提交其中一项即可）。 */
export function updateProfilePhoto(
  id: number,
  patch: { name?: string; is_primary?: boolean },
): Promise<ProfilePhoto> {
  return request(`/profile/photos/${id}`, {
    method: "PATCH",
    body: JSON.stringify(patch),
  });
}

export function deleteProfilePhoto(id: number): Promise<void> {
  return request(`/profile/photos/${id}`, { method: "DELETE" });
}
