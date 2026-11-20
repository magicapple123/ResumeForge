// SPDX-License-Identifier: Apache-2.0
/**
 * 启动更新弹窗的"别再烦我"记忆（UP-01）。
 *
 * 两个键分开存，因为语义不同：
 * - `snooze` 是**按版本的时间闸**：同一版本 24 小时内不再弹；到期后照常提醒。
 * - `skip` 是**按版本的永久闸**：用户说"跳过此版本"，这个版本就再也不问；只留最近 5 个，
 *   避免常年累月攒成一条无限长的列表。
 *
 * 都存在 localStorage（不写后端）：换浏览器/清缓存后重新提醒一次，比"永远不提醒"安全。
 * 所有读写都容错——隐私模式下 localStorage 抛错时退化成"本次照常弹"。
 */

export const UPDATE_SNOOZE_KEY = "resumeforge.update.snooze";
export const UPDATE_SKIP_KEY = "resumeforge.update.skip";

/** 稍后 = 24 小时。 */
export const SNOOZE_MS = 24 * 60 * 60 * 1000;

/** `skip` 只留最近 5 个版本。 */
export const SKIP_LIMIT = 5;

type StorageLike = Pick<Storage, "getItem" | "setItem">;

export interface UpdatePreferences {
  /** 版本 → 提醒解禁时间（epoch ms）。到点及以后视为未稍后。 */
  snooze: Record<string, number>;
  /** 最近跳过的版本，新的在前。 */
  skip: string[];
}

function defaultStorage(): StorageLike | null {
  try {
    if (typeof window === "undefined" || !window.localStorage) return null;
    return window.localStorage;
  } catch {
    return null;
  }
}

function readJson<T>(storage: StorageLike | null, key: string, fallback: T): T {
  if (!storage) return fallback;
  try {
    const raw = storage.getItem(key);
    if (!raw) return fallback;
    return JSON.parse(raw) as T;
  } catch {
    // 手改坏 / 旧格式：当作没有记录，别让一次坏数据永久静音更新提醒。
    return fallback;
  }
}

function writeJson(storage: StorageLike | null, key: string, value: unknown): void {
  if (!storage) return;
  try {
    storage.setItem(key, JSON.stringify(value));
  } catch {
    // 存储满 / 被禁用：本次决策仍生效（调用方已经关弹窗），只是下次会再问一次。
  }
}

/** 读当前偏好，顺手清掉形状不对的条目。 */
export function readUpdatePreferences(
  storage: StorageLike | null = defaultStorage(),
): UpdatePreferences {
  const rawSnooze = readJson<unknown>(storage, UPDATE_SNOOZE_KEY, {});
  const rawSkip = readJson<unknown>(storage, UPDATE_SKIP_KEY, []);

  const snooze: Record<string, number> = {};
  if (rawSnooze && typeof rawSnooze === "object" && !Array.isArray(rawSnooze)) {
    for (const [version, until] of Object.entries(rawSnooze)) {
      if (typeof until === "number" && Number.isFinite(until)) snooze[version] = until;
    }
  }

  const skip: string[] = [];
  if (Array.isArray(rawSkip)) {
    for (const version of rawSkip) {
      if (typeof version === "string" && version && !skip.includes(version)) skip.push(version);
    }
  }

  return { snooze, skip: skip.slice(0, SKIP_LIMIT) };
}

/**
 * 这个版本现在该不该弹。
 *
 * 边界取"到点即弹"：`until === now` 返回 true。24 小时整是用户约定的等待上限，
 * 多等一毫秒没有意义；单测会同时钉住 `now + SNOOZE_MS - 1` 与 `now + SNOOZE_MS`。
 */
export function shouldPrompt(
  version: string,
  options: { now?: number; storage?: StorageLike | null } = {},
): boolean {
  if (!version) return false;
  const now = options.now ?? Date.now();
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const { snooze, skip } = readUpdatePreferences(storage);
  if (skip.includes(version)) return false;
  const until = snooze[version];
  return until === undefined || until <= now;
}

/** 记一次"稍后"：同一版本 24 小时内不再弹；顺手清掉已过期的条目。 */
export function snoozeVersion(
  version: string,
  options: { now?: number; storage?: StorageLike | null } = {},
): void {
  if (!version) return;
  const now = options.now ?? Date.now();
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const { snooze } = readUpdatePreferences(storage);
  const next: Record<string, number> = {};
  for (const [key, until] of Object.entries(snooze)) {
    if (until > now) next[key] = until;
  }
  next[version] = now + SNOOZE_MS;
  writeJson(storage, UPDATE_SNOOZE_KEY, next);
}

/** 记一次"跳过此版本"：永久跳过；只保留最近 {@link SKIP_LIMIT} 个。 */
export function skipVersion(version: string, options: { storage?: StorageLike | null } = {}): void {
  if (!version) return;
  const storage = options.storage === undefined ? defaultStorage() : options.storage;
  const { skip } = readUpdatePreferences(storage);
  const next = [version, ...skip.filter((item) => item !== version)].slice(0, SKIP_LIMIT);
  writeJson(storage, UPDATE_SKIP_KEY, next);
}
