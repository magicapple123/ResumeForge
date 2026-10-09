/** 用户文件副本接口：列表、按来源反查、系统程序打开与 raw 直链。 */
import { buildQuery, request } from "./client";

export interface UserFileItem {
  id: number;
  original_name: string;
  mime: string;
  size: number;
  source_type: string;
  source_ref: string;
  created_at: string | null;
}

export interface UserFileListResult {
  items: UserFileItem[];
  total: number;
}

export interface UserFileLookupItem {
  id: number;
  original_name: string;
}

export function listUserFiles(
  params: {
    page?: number;
    page_size?: number;
    source_type?: string;
    keyword?: string;
  } = {},
): Promise<UserFileListResult> {
  return request(`/user-files${buildQuery(params)}`);
}

/** 按来源精确反查副本 id（结果按 id 升序，与保存顺序一致，可按下标对应原图）。 */
export function lookupUserFiles(params: {
  source_type: string;
  source_ref?: string;
  name?: string;
}): Promise<{ items: UserFileLookupItem[] }> {
  return request(`/user-files/lookup${buildQuery(params)}`);
}

/** 用系统默认程序打开该副本（后端按平台选择 startfile / open / xdg-open）。 */
export function openUserFile(id: number): Promise<{ ok: boolean }> {
  return request(`/user-files/${id}/open-in-system`, { method: "POST" });
}

/** 在文件管理器里打开该副本所在的文件夹并选中文件（explorer /select、open -R）。 */
export function revealUserFile(id: number): Promise<{ ok: boolean }> {
  return request(`/user-files/${id}/reveal`, { method: "POST" });
}

/** raw 直链：图片可直接给 antd Image，pdf 可嵌 iframe。 */
export function userFileRawUrl(id: number): string {
  return `/api/user-files/${id}/raw`;
}
