// SPDX-License-Identifier: Apache-2.0
/**
 * 中断预算（#27D）：同类每周 ≤2、连续忽略 3 次降级到只 pulse、静音持久化。
 * 全部针对纯状态机，不依赖 React 与真实 localStorage（存储那两条单独用内存 Storage 验）。
 */
import { describe, expect, it } from "vitest";
import {
  EMPTY_INTERVENTION,
  IGNORE_STREAK_LIMIT,
  INTERVENTION_STORAGE_KEY,
  WEEKLY_ANNOUNCE_LIMIT,
  canAnnounce,
  interventionWeekKey,
  isInterventionDegraded,
  isKindMuted,
  muteKind,
  readInterventionState,
  recordAnnounced,
  recordEngaged,
  recordIgnored,
  restoreIntervention,
  sanitizeInterventionState,
  writeInterventionState,
} from "./touTouIntervention";

const NOW = new Date("2026-11-11T10:00:00+08:00");
const NEXT_WEEK = new Date("2026-11-18T10:00:00+08:00");

/** 最小内存 Storage（只实现本模块用到的 get/set）。 */
function memoryStorage(): Storage {
  const map = new Map<string, string>();
  return {
    get length() {
      return map.size;
    },
    clear: () => map.clear(),
    getItem: (key: string) => map.get(key) ?? null,
    key: (index: number) => Array.from(map.keys())[index] ?? null,
    removeItem: (key: string) => void map.delete(key),
    setItem: (key: string, value: string) => void map.set(key, value),
  };
}

describe("每周同类上限", () => {
  it("默认可以播；播到上限 2 次后不再播", () => {
    expect(WEEKLY_ANNOUNCE_LIMIT).toBe(2);
    let state = EMPTY_INTERVENTION;
    expect(canAnnounce(state, "layout-overflow", NOW)).toBe(true);
    state = recordAnnounced(state, "layout-overflow", NOW);
    expect(canAnnounce(state, "layout-overflow", NOW)).toBe(true);
    state = recordAnnounced(state, "layout-overflow", NOW);
    expect(canAnnounce(state, "layout-overflow", NOW)).toBe(false);
  });

  it("换周清零（ISO 周键不同）", () => {
    expect(interventionWeekKey(NOW)).not.toBe(interventionWeekKey(NEXT_WEEK));
    let state = EMPTY_INTERVENTION;
    state = recordAnnounced(state, "queue-unsupported", NOW);
    state = recordAnnounced(state, "queue-unsupported", NOW);
    expect(canAnnounce(state, "queue-unsupported", NOW)).toBe(false);
    expect(canAnnounce(state, "queue-unsupported", NEXT_WEEK)).toBe(true);
  });

  it("周上限按 kind 独立计数", () => {
    let state = EMPTY_INTERVENTION;
    state = recordAnnounced(state, "layout-overflow", NOW);
    state = recordAnnounced(state, "layout-overflow", NOW);
    expect(canAnnounce(state, "layout-overflow", NOW)).toBe(false);
    expect(canAnnounce(state, "profile-missing-fields", NOW)).toBe(true);
  });
});

describe("连续忽略降级", () => {
  it("忽略 3 次后降级：只 pulse，不再出气泡；第 4 次判定依然不出", () => {
    expect(IGNORE_STREAK_LIMIT).toBe(3);
    let state = EMPTY_INTERVENTION;
    for (let index = 0; index < 3; index += 1) {
      expect(isInterventionDegraded(state)).toBe(index >= 3);
      state = recordIgnored(state);
    }
    expect(isInterventionDegraded(state)).toBe(true);
    expect(canAnnounce(state, "layout-overflow", NOW)).toBe(false);
    expect(canAnnounce(state, "queue-unsupported", NOW)).toBe(false);
  });

  it("用户真的用了一次建议（recordEngaged）→ 连续忽略清零、降级解除", () => {
    let state = EMPTY_INTERVENTION;
    state = recordIgnored(recordIgnored(recordIgnored(state)));
    expect(isInterventionDegraded(state)).toBe(true);
    state = recordEngaged(state);
    expect(isInterventionDegraded(state)).toBe(false);
    expect(canAnnounce(state, "queue-unsupported", NOW)).toBe(true);
  });
});

describe("这类别再提示（静音持久化）", () => {
  it("静音某个 kind 后只有它被压掉，其它 kind 不受影响", () => {
    const state = muteKind(EMPTY_INTERVENTION, "queue-unsupported", NOW);
    expect(isKindMuted(state, "queue-unsupported")).toBe(true);
    expect(canAnnounce(state, "queue-unsupported", NOW)).toBe(false);
    expect(canAnnounce(state, "layout-overflow", NOW)).toBe(true);
  });

  it("恢复提示清空静音与忽略计数（周计数保留节流）", () => {
    let state = EMPTY_INTERVENTION;
    state = muteKind(state, "layout-overflow", NOW);
    state = recordIgnored(state);
    state = recordAnnounced(state, "layout-overflow", NOW);
    const restored = restoreIntervention(state);
    expect(isKindMuted(restored, "layout-overflow")).toBe(false);
    expect(restored.consecutiveIgnores).toBe(0);
    expect(restored.weekly["layout-overflow"]?.count).toBe(1);
  });

  it("localStorage 往返：静音状态在重新读回后仍生效", () => {
    const storage = memoryStorage();
    const state = muteKind(EMPTY_INTERVENTION, "profile-missing-fields", NOW);
    writeInterventionState(state, storage);
    expect(storage.getItem(INTERVENTION_STORAGE_KEY)).toBeTruthy();
    const loaded = readInterventionState(storage);
    expect(isKindMuted(loaded, "profile-missing-fields")).toBe(true);
    expect(canAnnounce(loaded, "profile-missing-fields", NOW)).toBe(false);
  });
});

describe("坏数据收口", () => {
  it("非对象 / 缺字段 / 越界值都被收口成空状态或安全值", () => {
    expect(sanitizeInterventionState(null)).toEqual(EMPTY_INTERVENTION);
    expect(sanitizeInterventionState("oops")).toEqual(EMPTY_INTERVENTION);
    expect(
      sanitizeInterventionState({
        mutedKinds: { "layout-overflow": 3, "queue-unsupported": "2026-11-11T00:00:00Z" },
        weekly: {
          "layout-overflow": { week: "bad", count: 1 },
          "queue-unsupported": { week: "2026-W46", count: 99 },
        },
        consecutiveIgnores: -5,
      }),
    ).toEqual({
      mutedKinds: { "queue-unsupported": "2026-11-11T00:00:00Z" },
      // 周计数上限 = WEEKLY_ANNOUNCE_LIMIT * 10 = 20，99 被夹到 20。
      weekly: { "queue-unsupported": { week: "2026-W46", count: 20 } },
      consecutiveIgnores: 0,
    });
  });

  it("坏 JSON 不抛异常，退回空状态", () => {
    const storage = memoryStorage();
    storage.setItem(INTERVENTION_STORAGE_KEY, "{not json");
    expect(readInterventionState(storage)).toEqual(EMPTY_INTERVENTION);
  });
});
