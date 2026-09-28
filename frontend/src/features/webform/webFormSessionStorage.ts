import type { WebFormFillResult, WebFormPreview, WebFormSnapshot } from "../../types";

export const WEB_FORM_SESSION_STORAGE_KEY = "resumeforge:webform-session:v1";

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

export function loadWebFormSession(): WebFormSessionState {
  if (!storageAvailable()) return { ...EMPTY_SESSION };
  try {
    const raw = window.sessionStorage.getItem(WEB_FORM_SESSION_STORAGE_KEY);
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

export function saveWebFormSession(state: WebFormSessionState): void {
  if (!storageAvailable()) return;
  try {
    window.sessionStorage.setItem(
      WEB_FORM_SESSION_STORAGE_KEY,
      JSON.stringify({ ...state, selected: [...state.selected] }),
    );
  } catch {
    // sessionStorage 满或被浏览器策略禁用时，页面内状态仍可继续使用。
  }
}

export function clearWebFormSession(): void {
  if (!storageAvailable()) return;
  try {
    window.sessionStorage.removeItem(WEB_FORM_SESSION_STORAGE_KEY);
  } catch {
    // 清理失败不应阻止用户结束本次填写。
  }
}

export { EMPTY_SESSION };
