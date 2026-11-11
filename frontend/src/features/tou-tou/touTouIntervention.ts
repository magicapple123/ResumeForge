// SPDX-License-Identifier: Apache-2.0
/**
 * 投投「中断预算」（#27D）。
 *
 * 旧实现每小时最多弹 30 次标语（8 条轮播，120s 一轮）。这一条不改，前面做得再好
 * 都会被用户关掉，所以这里把"能不能打断"做成一份**有上限的状态机**：
 *
 * 1. 每条建议都带「这类别再提示」→ `muteKind`（按信号 kind 静音，持久化）；
 * 2. 同类建议**每周上限 2 次** → `canAnnounce` 读周计数；
 * 3. **连续忽略 3 次**自动降级到「只 pulse 不出标语」→ `recordIgnored` 累加，
 *    到 3 后 `isDegraded` 为真，直到用户真的用了一次建议（`recordEngaged`）才恢复。
 *
 * 状态存 `localStorage`：这是"偏好/节流"类数据，不是表单草稿（草稿只许 sessionStorage）。
 * 读写都做防御：坏 JSON、越界值一律回落到空状态，绝不因为一个旧版本字段让球不显示。
 */

export const INTERVENTION_STORAGE_KEY = "resumeforge.tou-tou.intervention.v1";
/** 同类建议每周上限。 */
export const WEEKLY_ANNOUNCE_LIMIT = 2;
/** 连续忽略到这个次数就降级为"只 pulse"。 */
export const IGNORE_STREAK_LIMIT = 3;

export interface TouTouWeeklyRecord {
  /** ISO 周（`2026-W46`）。换周即清零，不做跨周累计。 */
  week: string;
  count: number;
}

export interface TouTouInterventionState {
  /** 已静音的 kind → 静音发生时的 ISO 时间（只用于审计/测试，不参与判定）。 */
  mutedKinds: Record<string, string>;
  weekly: Record<string, TouTouWeeklyRecord>;
  consecutiveIgnores: number;
}

export const EMPTY_INTERVENTION: TouTouInterventionState = {
  mutedKinds: {},
  weekly: {},
  consecutiveIgnores: 0,
};

/**
 * ISO 8601 周键（`YYYY-Www`）。用 ISO 周而不是自然周：同一份状态在跨年那一周
 * 不会因为"周一是去年"而算错。
 */
export function interventionWeekKey(now: Date): string {
  const date = new Date(Date.UTC(now.getFullYear(), now.getMonth(), now.getDate()));
  // 周四所在的年才是 ISO 年；周一 = 1。
  const day = date.getUTCDay() || 7;
  date.setUTCDate(date.getUTCDate() + 4 - day);
  const isoYear = date.getUTCFullYear();
  const yearStart = new Date(Date.UTC(isoYear, 0, 1));
  const week = Math.ceil(((date.getTime() - yearStart.getTime()) / 86_400_000 + 1) / 7);
  return `${isoYear}-W${String(week).padStart(2, "0")}`;
}

export function isKindMuted(state: TouTouInterventionState, kind: string): boolean {
  return Object.prototype.hasOwnProperty.call(state.mutedKinds, kind);
}

/** 连续忽略已达上限：只 pulse，不再出气泡。 */
export function isInterventionDegraded(state: TouTouInterventionState): boolean {
  return state.consecutiveIgnores >= IGNORE_STREAK_LIMIT;
}

function weeklyCount(state: TouTouInterventionState, kind: string, now: Date): number {
  const record = state.weekly[kind];
  if (!record) return 0;
  return record.week === interventionWeekKey(now) ? record.count : 0;
}

/** 这一条（这个 kind）现在允许出气泡吗？静音 > 降级 > 周上限，三道闸的优先级固定。 */
export function canAnnounce(
  state: TouTouInterventionState,
  kind: string,
  now: Date = new Date(),
): boolean {
  if (isKindMuted(state, kind)) return false;
  if (isInterventionDegraded(state)) return false;
  return weeklyCount(state, kind, now) < WEEKLY_ANNOUNCE_LIMIT;
}

/** 记一次"已经出过气泡"：周计数 +1。 */
export function recordAnnounced(
  state: TouTouInterventionState,
  kind: string,
  now: Date = new Date(),
): TouTouInterventionState {
  const week = interventionWeekKey(now);
  const current = weeklyCount(state, kind, now);
  return {
    ...state,
    weekly: { ...state.weekly, [kind]: { week, count: current + 1 } },
  };
}

/** 记一次"用户没理它"：连续忽略 +1。到上限后由 `isInterventionDegraded` 降级。 */
export function recordIgnored(state: TouTouInterventionState): TouTouInterventionState {
  return { ...state, consecutiveIgnores: state.consecutiveIgnores + 1 };
}

/** 记一次"用户真的用了建议"：连续忽略清零，降级随之解除。 */
export function recordEngaged(state: TouTouInterventionState): TouTouInterventionState {
  return { ...state, consecutiveIgnores: 0 };
}

export function muteKind(
  state: TouTouInterventionState,
  kind: string,
  now: Date = new Date(),
): TouTouInterventionState {
  return {
    ...state,
    mutedKinds: { ...state.mutedKinds, [kind]: now.toISOString() },
  };
}

/** 恢复提示：清空静音 + 连续忽略，周计数保留（周上限是节流，不该被"恢复"重置）。 */
export function restoreIntervention(state: TouTouInterventionState): TouTouInterventionState {
  return { ...state, mutedKinds: {}, consecutiveIgnores: 0 };
}

function sanitizeRecord(value: unknown): TouTouWeeklyRecord | null {
  if (typeof value !== "object" || value === null) return null;
  const record = value as { week?: unknown; count?: unknown };
  if (typeof record.week !== "string" || !/^\d{4}-W\d{2}$/u.test(record.week)) return null;
  if (typeof record.count !== "number" || !Number.isFinite(record.count)) return null;
  const count = Math.max(0, Math.min(WEEKLY_ANNOUNCE_LIMIT * 10, Math.floor(record.count)));
  return { week: record.week, count };
}

/** 把任意解析结果收口成合法状态（坏字段丢弃，绝不抛异常）。 */
export function sanitizeInterventionState(value: unknown): TouTouInterventionState {
  if (typeof value !== "object" || value === null) return EMPTY_INTERVENTION;
  const raw = value as {
    mutedKinds?: unknown;
    weekly?: unknown;
    consecutiveIgnores?: unknown;
  };
  const mutedKinds: Record<string, string> = {};
  if (typeof raw.mutedKinds === "object" && raw.mutedKinds !== null) {
    for (const [kind, at] of Object.entries(raw.mutedKinds)) {
      if (typeof kind === "string" && typeof at === "string") mutedKinds[kind] = at;
    }
  }
  const weekly: Record<string, TouTouWeeklyRecord> = {};
  if (typeof raw.weekly === "object" && raw.weekly !== null) {
    for (const [kind, record] of Object.entries(raw.weekly)) {
      const sanitized = sanitizeRecord(record);
      if (typeof kind === "string" && sanitized) weekly[kind] = sanitized;
    }
  }
  const ignores =
    typeof raw.consecutiveIgnores === "number" && Number.isFinite(raw.consecutiveIgnores)
      ? Math.max(0, Math.min(IGNORE_STREAK_LIMIT * 10, Math.floor(raw.consecutiveIgnores)))
      : 0;
  return { mutedKinds, weekly, consecutiveIgnores: ignores };
}

function storageOrNull(): Storage | null {
  try {
    return typeof window === "undefined" ? null : window.localStorage;
  } catch {
    // 隐私模式 / 被策略禁用时访问 localStorage 本身就会抛。
    return null;
  }
}

export function readInterventionState(
  storage: Storage | null = storageOrNull(),
): TouTouInterventionState {
  if (!storage) return EMPTY_INTERVENTION;
  try {
    const raw = storage.getItem(INTERVENTION_STORAGE_KEY);
    if (!raw) return EMPTY_INTERVENTION;
    return sanitizeInterventionState(JSON.parse(raw));
  } catch {
    return EMPTY_INTERVENTION;
  }
}

export function writeInterventionState(
  state: TouTouInterventionState,
  storage: Storage | null = storageOrNull(),
): void {
  if (!storage) return;
  try {
    storage.setItem(INTERVENTION_STORAGE_KEY, JSON.stringify(state));
  } catch {
    // 存不进去就退化成"本次会话内存生效"：节流状态丢了不致命，不能因此报错。
  }
}
