// SPDX-License-Identifier: Apache-2.0
/**
 * 表单草稿的存储层：**只写 `sessionStorage`**。
 *
 * ## 为什么不是 `localStorage`
 *
 * 草稿正文包含简历内容、个人信息、JD 原文。`localStorage` 是**长期明文落盘**、同源任意页面
 * 可读、没有过期机制；桌面壳里更是"关掉软件还在"。`sessionStorage` 的作用域恰好是"这个标签页
 * 这次没填完的东西"，刷新保留、关标签即清。
 *
 * 代价是跨重启不恢复草稿——这是刻意接受的（见方案 §5.4 不做清单第 5 条）。
 *
 * ## key 为什么带 datasetId
 *
 * 漏传一次就会把 A 数据集的草稿恢复到 B 数据集（RF-13 的既有教训）。所以 datasetId 由
 * 本模块内部读 `readActiveDatasetId()`，**调用方不用传、也传不进来**。
 */
import { readActiveDatasetId } from "./datasetScope";

export const DRAFT_KEY_PREFIX = "resumeforge.form-draft.v1";
/** 单份草稿的序列化上限；超了不写（避免 QuotaExceeded 影响整个标签页）。 */
export const DRAFT_MAX_BYTES = 32 * 1024;
/** 超过这个年龄的草稿不再恢复（同标签页长期挂着也可能很旧）。 */
export const DRAFT_TTL_MS = 24 * 60 * 60 * 1000;

export interface StoredDraft {
  values: Record<string, unknown>;
  savedAt: number;
}

export type DraftWriteResult = "ok" | "too-large" | "unavailable";

/** 凭据类字段名：命中即整键剔除，不许进草稿。 */
const SENSITIVE_KEY = /api[-_]?key|token|secret|password|passwd|credential/i;

/** `resumeforge.form-draft.v1:<scope>@<datasetId>`。 */
export function draftStorageKey(scope: string): string {
  return `${DRAFT_KEY_PREFIX}:${scope}@${readActiveDatasetId()}`;
}

function storage(): Storage | null {
  if (typeof window === "undefined") return null;
  try {
    return window.sessionStorage ?? null;
  } catch {
    // 隐私模式下访问 sessionStorage 本身就可能抛 SecurityError。
    return null;
  }
}

/** UTF-8 字节数。不依赖 `TextEncoder`（旧 Safari 与部分测试环境没有）。 */
function byteLength(text: string): number {
  let bytes = 0;
  for (let index = 0; index < text.length; index += 1) {
    const code = text.charCodeAt(index);
    if (code < 0x80) bytes += 1;
    else if (code < 0x800) bytes += 2;
    else if (code >= 0xd800 && code <= 0xdbff) {
      bytes += 4;
      index += 1; // 代理对占两个码元，跳过低位
    } else bytes += 3;
  }
  return bytes;
}

/**
 * 剔除凭据类字段。`omit` 是调用方额外指定的字段名（如附件字段）。
 *
 * 只做**浅层**遍历：草稿存的就是表单值的一层对象；深层结构里出现 `apiKey` 的概率远低于
 * "为了它写一个递归遍历、然后递归里漏了数组"。键名判定用大小写不敏感的正则。
 */
export function stripSensitive(
  values: Record<string, unknown>,
  omit: readonly string[] = [],
): Record<string, unknown> {
  const omitted = new Set(omit);
  const result: Record<string, unknown> = {};
  for (const [key, value] of Object.entries(values)) {
    if (omitted.has(key)) continue;
    if (SENSITIVE_KEY.test(key)) continue;
    result[key] = value;
  }
  return result;
}

export function readDraft(scope: string, now: number = Date.now()): StoredDraft | null {
  const store = storage();
  if (!store) return null;
  try {
    const raw = store.getItem(draftStorageKey(scope));
    if (!raw) return null;
    const parsed: unknown = JSON.parse(raw);
    if (!parsed || typeof parsed !== "object") return null;
    const value = parsed as Record<string, unknown>;
    const values = value.values;
    const savedAt = value.savedAt;
    if (typeof savedAt !== "number" || !Number.isFinite(savedAt)) return null;
    if (!values || typeof values !== "object" || Array.isArray(values)) return null;
    // 过期的草稿就地清掉：留着只会让下次读到它再判一次。
    if (now - savedAt > DRAFT_TTL_MS) {
      store.removeItem(draftStorageKey(scope));
      return null;
    }
    return { values: values as Record<string, unknown>, savedAt };
  } catch {
    return null;
  }
}

export function writeDraft(
  scope: string,
  values: Record<string, unknown>,
  now: number = Date.now(),
): DraftWriteResult {
  const store = storage();
  if (!store) return "unavailable";
  // 写入侧再剔一次：调用方忘了 stripSensitive 也不会把凭据写进去。
  const payload: StoredDraft = { values: stripSensitive(values), savedAt: now };
  let serialized: string;
  try {
    serialized = JSON.stringify(payload);
  } catch {
    // 循环引用等不可序列化的值：当作"写不进去"，不是"太大"。
    return "unavailable";
  }
  if (byteLength(serialized) > DRAFT_MAX_BYTES) return "too-large";
  try {
    store.setItem(draftStorageKey(scope), serialized);
    return "ok";
  } catch {
    return "unavailable";
  }
}

export function clearDraft(scope: string): void {
  const store = storage();
  if (!store) return;
  try {
    store.removeItem(draftStorageKey(scope));
  } catch {
    // 清理失败不应阻止用户提交。
  }
}
