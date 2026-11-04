// SPDX-License-Identifier: Apache-2.0
/**
 * 22a：检查结果的模块级缓存（`preflightCache`）。
 *
 * 这些性质错了不会崩，只会"退出制作台回来还是空的"或"看到别的库的检查结果"——
 * 后者是数据串库级别的错误，所以数据集隔离必须单独钉住。
 */
import { afterEach, describe, expect, it } from "vitest";
import { makePreflightOut } from "../../test/preflightFixtures";
import { clearPreflightCache, readPreflightCache, writePreflightCache } from "./preflightCache";

const SCOPE = "scope-a";

function seed(resumeId: number, key: string, scope: string | null = SCOPE) {
  const result = makePreflightOut();
  writePreflightCache({ resumeId, key, datasetScope: scope, result });
  return result;
}

afterEach(() => clearPreflightCache());

describe("preflightCache：按简历身份跨页面保留", () => {
  it("同 resumeId + 同 key 能读回同一份结果", () => {
    const result = seed(7, "k1");
    expect(readPreflightCache(7, "k1", SCOPE)).toBe(result);
  });

  it("key 不同仍读回：过期由 stale 表达，不在读的时候拒绝", () => {
    // 拒绝会让「改一个字就整份结果消失」，比"看到上一版 + 过期提示"更糟。
    const result = seed(7, "k1");
    expect(readPreflightCache(7, "k2", SCOPE)).toBe(result);
  });

  it("超过 3 条按插入序淘汰最旧的", () => {
    seed(1, "k1");
    seed(2, "k2");
    seed(3, "k3");
    seed(4, "k4");
    expect(readPreflightCache(1, "k1", SCOPE)).toBeNull();
    expect(readPreflightCache(2, "k2", SCOPE)).not.toBeNull();
    expect(readPreflightCache(4, "k4", SCOPE)).not.toBeNull();
  });

  it("同一份简历再写一次是覆盖，不占新名额", () => {
    seed(1, "k1");
    seed(2, "k2");
    seed(3, "k3");
    seed(1, "k1b");
    expect(readPreflightCache(1, "k1", SCOPE)).not.toBeNull();
    // 覆盖后仍然只有 3 条：没有把别的最旧条目挤掉。
    expect(readPreflightCache(2, "k2", SCOPE)).not.toBeNull();
  });

  it("datasetScope 不同必须读不到（同 id 的不同数据集是两条记录）", () => {
    seed(7, "k1", "scope-a");
    expect(readPreflightCache(7, "k1", "scope-b")).toBeNull();
    // 没写过数据集身份的旧条目同理：null 与 "scope-a" 是两种身份。
    seed(8, "k1", null);
    expect(readPreflightCache(8, "k1", "scope-a")).toBeNull();
  });

  it("clearPreflightCache 后读不到；带 id 只清那一份", () => {
    seed(7, "k1");
    seed(8, "k2");
    clearPreflightCache(7);
    expect(readPreflightCache(7, "k1", SCOPE)).toBeNull();
    expect(readPreflightCache(8, "k2", SCOPE)).not.toBeNull();
    clearPreflightCache();
    expect(readPreflightCache(8, "k2", SCOPE)).toBeNull();
  });
});
