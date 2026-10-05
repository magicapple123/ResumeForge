/** 可见性工具：轮询降频共用（见 backgroundTasks / useTaskPolling 等调用点）。 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { isDocumentHidden, onVisibilityChange } from "./visibility";

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
});
