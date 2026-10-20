// SPDX-License-Identifier: Apache-2.0
/**
 * 当前数据集 id 的前端落脚点（RF-13 webform 草稿作用域的前提）。
 *
 * 页头（AppHeaderContext）是唯一知道"当前数据集是哪份"的地方，但它不落全局
 * 状态；而网申草稿需要在**首帧同步**读到一个数据集 id（restore 发生在
 * useState 初始化里，等不了接口）。所以页头把 active id 写进 localStorage，
 * 这里只做读写两个纯函数——读不到（首次启动 / 被清理）回落 "main"，
 * 与草稿 key 的无 id 回落语义一致。
 */

const ACTIVE_DATASET_STORAGE_KEY = "resumeforge:active-dataset";

export const DEFAULT_DATASET_SCOPE = "main";

export function readActiveDatasetId(): string {
  if (typeof window === "undefined") return DEFAULT_DATASET_SCOPE;
  try {
    const value = window.localStorage.getItem(ACTIVE_DATASET_STORAGE_KEY);
    const trimmed = (value ?? "").trim();
    return trimmed || DEFAULT_DATASET_SCOPE;
  } catch {
    return DEFAULT_DATASET_SCOPE;
  }
}

export function saveActiveDatasetId(datasetId: string | null | undefined): void {
  if (typeof window === "undefined") return;
  try {
    const trimmed = (datasetId ?? "").trim();
    if (trimmed) {
      window.localStorage.setItem(ACTIVE_DATASET_STORAGE_KEY, trimmed);
    }
  } catch {
    // localStorage 被禁用时草稿作用域退回默认值，页面内状态不受影响。
  }
}
