// SPDX-License-Identifier: Apache-2.0
import { describe, expect, it } from "vitest";
import { MESSAGE_CONFIG } from "./feedbackConfig";

describe("Toast 全局口径", () => {
  it("时长落在规范的 2–3 秒区间", () => {
    expect(MESSAGE_CONFIG.duration).toBeGreaterThanOrEqual(2);
    expect(MESSAGE_CONFIG.duration).toBeLessThanOrEqual(3);
  });

  it("同时最多 3 条（antd 默认无限堆叠）", () => {
    expect(MESSAGE_CONFIG.maxCount).toBe(3);
  });

  it("悬停暂停计时，避免读到一半消失", () => {
    expect(MESSAGE_CONFIG.pauseOnHover).toBe(true);
  });
});
