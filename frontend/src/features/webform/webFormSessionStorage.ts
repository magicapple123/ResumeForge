// SPDX-License-Identifier: Apache-2.0
import type { WebFormFillResult, WebFormPreview, WebFormSnapshot } from "../../types";

/**
 * 网申会话草稿的 sessionStorage 作用域（RF-13）：key 按数据集隔离。
 *
 * 此前 key 是全局唯一的 `"resumeforge:webform-session:v1"`，切换数据集（整页
 * reload）后 A 数据集的草稿会残留在 B 数据集的界面里。现在 key 拼上数据集 id
 * （无 id 回落 "main"）。**旧 key 的存量草稿自然失效**——刻意不迁移、不清理：
 * 草稿本身是"没填完的临时内容"，跨数据集恢复它才是错误行为；旧 key 里的残留
 * 会话会随标签页关闭而消失，不会影响新 key 的读写。
 */
const WEB_FORM_SESSION_STORAGE_PREFIX = "resumeforge:webform-session:v1";
const DEFAULT_DATASET_SCOPE = "main";

export function webFormSessionStorageKey(datasetId: string | null | undefined): string {
  const scope = (datasetId ?? "").trim() || DEFAULT_DATASET_SCOPE;
  return `${WEB_FORM_SESSION_STORAGE_PREFIX}:${scope}`;
}

export interface WebFormSessionState {
  sessionActive: boolean;
  snapshot: WebFormSnapshot | null;
  preview: WebFormPreview | null;
  selected: number[];
  values: Record<number, string>;
  result: WebFormFillResult | null;
  aiEnabled: boolean;
  liveOptOut: boolean;
}

const EMPTY_SESSION: WebFormSessionState = {
  sessionActive: false,
  snapshot: null,
  preview: null,
  selected: [],
  values: {},
  result: null,
  aiEnabled: true,
  liveOptOut: false,
};

function storageAvailable(): boolean {
  return typeof window !== "undefined" && Boolean(window.sessionStorage);
}

function recordOfStrings(value: unknown): Record<number, string> {
  if (!value || typeof value !== "object") return {};
  const result: Record<number, string> = {};
  for (const [key, item] of Object.entries(value)) {
    if (typeof item !== "string") continue;
    const numericKey = Number(key);
    if (Number.isInteger(numericKey)) result[numericKey] = item;
  }
  return result;
}

export function loadWebFormSession(
  datasetId: string | null | undefined = DEFAULT_DATASET_SCOPE,
): WebFormSessionState {
  if (!storageAvailable()) return { ...EMPTY_SESSION };
  try {
    const raw = window.sessionStorage.getItem(webFormSessionStorageKey(datasetId));
    if (!raw) return { ...EMPTY_SESSION };
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return { ...EMPTY_SESSION };
    const value = parsed as Record<string, unknown>;
    return {
      sessionActive: value.sessionActive === true,
      snapshot: (value.snapshot as WebFormSnapshot | null | undefined) ?? null,
      preview: (value.preview as WebFormPreview | null | undefined) ?? null,
      selected: Array.isArray(value.selected)
        ? value.selected.filter((item): item is number => Number.isInteger(item))
        : [],
      values: recordOfStrings(value.values),
      result: (value.result as WebFormFillResult | null | undefined) ?? null,
      aiEnabled: value.aiEnabled !== false,
      liveOptOut: value.liveOptOut === true,
    };
  } catch {
    return { ...EMPTY_SESSION };
  }
}

export function saveWebFormSession(
  state: WebFormSessionState,
  datasetId: string | null | undefined = DEFAULT_DATASET_SCOPE,
): void {
  if (!storageAvailable()) return;
  try {
    window.sessionStorage.setItem(
      webFormSessionStorageKey(datasetId),
      JSON.stringify({ ...state, selected: [...state.selected] }),
    );
  } catch {
    // sessionStorage 满或被浏览器策略禁用时，页面内状态仍可继续使用。
  }
}

export function clearWebFormSession(
  datasetId: string | null | undefined = DEFAULT_DATASET_SCOPE,
): void {
  if (!storageAvailable()) return;
  try {
    window.sessionStorage.removeItem(webFormSessionStorageKey(datasetId));
  } catch {
    // 清理失败不应阻止用户结束本次填写。
  }
}

export { EMPTY_SESSION };
