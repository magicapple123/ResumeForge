// SPDX-License-Identifier: Apache-2.0
/** 可见性工具：轮询降频共用（见 backgroundTasks / useTaskPolling 等调用点）。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  HIDDEN_AI_POLL_MS,
  HIDDEN_BATCH_POLL_MS,
  isDocumentHidden,
  onVisibilityChange,
  resolvePollInterval,
} from "./visibility";

/** jsdom 没有改 visibilityState 的入口，直接覆写属性模拟；afterEach 还原为可见。 */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
}

afterEach(() => {
  setHidden(false);
});

describe("visibility 工具", () => {
  it("isDocumentHidden 跟随 document.visibilityState", () => {
    expect(isDocumentHidden()).toBe(false);
    setHidden(true);
    expect(isDocumentHidden()).toBe(true);
    setHidden(false);
    expect(isDocumentHidden()).toBe(false);
  });

  it("visibilitychange 事件触发回调，退订后不再触发", () => {
    const callback = vi.fn();
    const unsubscribe = onVisibilityChange(callback);

    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(1);

    unsubscribe();
    document.dispatchEvent(new Event("visibilitychange"));
    expect(callback).toHaveBeenCalledTimes(1);
  });

  it("隐藏时按降频间隔轮询：AI/Agent 10s、其它后台任务 15s", () => {
    expect(HIDDEN_AI_POLL_MS).toBe(10_000);
    expect(HIDDEN_BATCH_POLL_MS).toBe(15_000);
    // 可见时用调用方自己的节奏（AI 任务 5s / 其它 1.5s），隐藏才切到降频值。
    expect(resolvePollInterval(5_000, HIDDEN_AI_POLL_MS)).toBe(5_000);
    expect(resolvePollInterval(1_500, HIDDEN_BATCH_POLL_MS)).toBe(1_500);
    setHidden(true);
    expect(resolvePollInterval(5_000, HIDDEN_AI_POLL_MS)).toBe(10_000);
    expect(resolvePollInterval(1_500, HIDDEN_BATCH_POLL_MS)).toBe(15_000);
  });
});
