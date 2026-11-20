// SPDX-License-Identifier: Apache-2.0
/**
 * UP-01 的偏好存储。时钟全部注入，不 sleep：24 小时边界要能在毫秒级断言。
 */
import { describe, expect, it } from "vitest";
import {
  SKIP_LIMIT,
  SNOOZE_MS,
  readUpdatePreferences,
  shouldPrompt,
  skipVersion,
  snoozeVersion,
  UPDATE_SKIP_KEY,
  UPDATE_SNOOZE_KEY,
} from "./updatePreferences";

function memoryStorage(initial: Record<string, string> = {}) {
  const map = new Map(Object.entries(initial));
  return {
    getItem: (key: string) => map.get(key) ?? null,
    setItem: (key: string, value: string) => {
      map.set(key, value);
    },
    raw: (key: string) => map.get(key) ?? null,
  };
}

const NOW = 1_700_000_000_000;

describe("shouldPrompt", () => {
  it("没有记录的新版本要弹", () => {
    const storage = memoryStorage();
    expect(shouldPrompt("2.2.0", { now: NOW, storage })).toBe(true);
  });

  it("空版本号不弹（远端没给版本时不猜）", () => {
    expect(shouldPrompt("", { now: NOW, storage: memoryStorage() })).toBe(false);
  });

  it("稍后：第 24 小时差 1ms 仍不弹，整点恢复提醒", () => {
    const storage = memoryStorage();
    snoozeVersion("2.2.0", { now: NOW, storage });

    expect(shouldPrompt("2.2.0", { now: NOW + SNOOZE_MS - 1, storage })).toBe(false);
    // 边界取"到点即弹"：等满 24 小时就该再问一次。
    expect(shouldPrompt("2.2.0", { now: NOW + SNOOZE_MS, storage })).toBe(true);
  });

  it("稍后只影响同一版本，别的版本照常弹", () => {
    const storage = memoryStorage();
    snoozeVersion("2.2.0", { now: NOW, storage });
    expect(shouldPrompt("2.3.0", { now: NOW, storage })).toBe(true);
  });

  it("跳过：永久不弹，且只留最近 5 个版本", () => {
    const storage = memoryStorage();
    for (let patch = 0; patch <= SKIP_LIMIT; patch += 1) {
      skipVersion(`2.2.${patch}`, { storage });
    }

    const { skip } = readUpdatePreferences(storage);
    expect(skip).toHaveLength(SKIP_LIMIT);
    expect(skip[0]).toBe("2.2.5");
    // 最早的 2.2.0 被挤出去：丢掉的是"不再提醒"记录，最多是下次多问一次，不会漏更新。
    expect(skip).not.toContain("2.2.0");
    expect(shouldPrompt("2.2.5", { now: NOW, storage })).toBe(false);
    expect(shouldPrompt("2.2.0", { now: NOW, storage })).toBe(true);
  });

  it("重复跳过同一版本不会占两个名额", () => {
    const storage = memoryStorage();
    skipVersion("2.2.0", { storage });
    skipVersion("2.2.0", { storage });
    expect(readUpdatePreferences(storage).skip).toEqual(["2.2.0"]);
  });

  it("稍后时清掉已经过期的条目，存储不会越攒越多", () => {
    const storage = memoryStorage({
      [UPDATE_SNOOZE_KEY]: JSON.stringify({ "1.0.0": NOW - 1, "2.0.0": NOW + 1000 }),
    });

    snoozeVersion("2.2.0", { now: NOW, storage });
    const { snooze } = readUpdatePreferences(storage);
    expect(snooze).not.toHaveProperty("1.0.0");
    expect(snooze["2.0.0"]).toBe(NOW + 1000);
    expect(snooze["2.2.0"]).toBe(NOW + SNOOZE_MS);
  });
});

describe("坏数据与不可用存储", () => {
  it("JSON 损坏时当作没有记录，不能把用户永久静音", () => {
    const storage = memoryStorage({
      [UPDATE_SNOOZE_KEY]: "{not json",
      [UPDATE_SKIP_KEY]: '{"oops":true}',
    });
    expect(readUpdatePreferences(storage)).toEqual({ snooze: {}, skip: [] });
    expect(shouldPrompt("2.2.0", { now: NOW, storage })).toBe(true);
  });

  it("存储抛错（隐私模式）时静默降级为本次照常弹", () => {
    const storage = {
      getItem: () => {
        throw new Error("denied");
      },
      setItem: () => {
        throw new Error("denied");
      },
    };
    expect(() => snoozeVersion("2.2.0", { now: NOW, storage })).not.toThrow();
    expect(() => skipVersion("2.2.0", { storage })).not.toThrow();
    expect(shouldPrompt("2.2.0", { now: NOW, storage })).toBe(true);
  });
});
