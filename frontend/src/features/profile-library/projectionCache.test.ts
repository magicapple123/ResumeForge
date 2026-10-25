// SPDX-License-Identifier: Apache-2.0
/**
 * 当前组投影缓存的**跨窗口失效**（F9/R1）：
 *
 * - 本窗口资料保存/切组 → 广播给同源其它窗口（BroadcastChannel）；
 * - 别的窗口广播过来 → 本窗口只做本地失效 + 通知已挂载消费者重取（不回环）；
 * - 没有 BroadcastChannel（旧浏览器 / jsdom）时退回 localStorage 的 storage 事件。
 *
 * 这里不挂 React：判据本身是模块级单例，用纯调用就能钉住；组件层"失效后自动重取"
 * 在 useProfileFillSources.test.tsx / ManualResumeModal.blank.test.tsx 里钉。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectionOf } from "../../test/profileProjectionFixture";

const apiMocks = vi.hoisted(() => ({ getCurrentProjection: vi.fn() }));

vi.mock("./api", () => ({ getCurrentProjection: apiMocks.getCurrentProjection }));

import {
  getCachedProjection,
  invalidateProjectionCache,
  requestProjection,
  resetProjectionCacheForTests,
  subscribeProjectionInvalidation,
} from "./projectionCache";

/** 与 projectionCache.ts 的私有常量一致：这里钉的是"跨窗口协议"，改字面量要一起改。 */
const CHANNEL_NAME = "resumeforge:projection-invalidation";
const STORAGE_KEY = "resumeforge:projection-invalidation";

/**
 * 最小的 BroadcastChannel 替身（jsdom 没有实现它）：
 * 同名的其它实例收到 onmessage（不投递给发送方，与浏览器语义一致）。
 */
class FakeBroadcastChannel {
  static instances: FakeBroadcastChannel[] = [];
  readonly name: string;
  onmessage: ((event: MessageEvent) => void) | null = null;
  closed = false;
  sent: unknown[] = [];

  constructor(name: string) {
    this.name = name;
    FakeBroadcastChannel.instances.push(this);
  }

  postMessage(data: unknown): void {
    this.sent.push(data);
    for (const other of FakeBroadcastChannel.instances) {
      if (other === this || other.closed || other.name !== this.name) continue;
      other.onmessage?.(new MessageEvent("message", { data }));
    }
  }

  close(): void {
    this.closed = true;
  }
}

const originalBroadcastChannel = window.BroadcastChannel;

function installFakeBroadcastChannel(): void {
  Object.defineProperty(window, "BroadcastChannel", {
    configurable: true,
    writable: true,
    value: FakeBroadcastChannel,
  });
}

function removeBroadcastChannel(): void {
  Object.defineProperty(window, "BroadcastChannel", {
    configurable: true,
    writable: true,
    value: undefined,
  });
}

/** 本窗口那条频道（订阅时惰性创建）。 */
function moduleChannel(): FakeBroadcastChannel {
  const channel = FakeBroadcastChannel.instances.find(
    (instance) => instance.name === CHANNEL_NAME && !instance.closed,
  );
  if (!channel) throw new Error("订阅后模块没有创建跨窗口频道");
  return channel;
}

/** 填满缓存，好让"失效"有可观察的效果。 */
async function warmCache(): Promise<void> {
  await requestProjection().promise;
  expect(getCachedProjection()).not.toBeNull();
}

beforeEach(() => {
  FakeBroadcastChannel.instances = [];
  window.localStorage.setItem("resumeforge:active-dataset", "test-" + Math.random());
  apiMocks.getCurrentProjection.mockReset();
  apiMocks.getCurrentProjection.mockResolvedValue(
    projectionOf({ content: { name: "张三", job_intent: "前端开发" } }),
  );
  resetProjectionCacheForTests();
  installFakeBroadcastChannel();
});

afterEach(() => {
  resetProjectionCacheForTests();
  Object.defineProperty(window, "BroadcastChannel", {
    configurable: true,
    writable: true,
    value: originalBroadcastChannel,
  });
  vi.restoreAllMocks();
});

describe("跨窗口失效广播（BroadcastChannel）", () => {
  it("本窗口失效会广播给同源其它窗口", async () => {
    subscribeProjectionInvalidation(() => undefined);
    await warmCache();

    invalidateProjectionCache();

    expect(moduleChannel().sent).toEqual([{ type: "projection-invalidated" }]);
  });

  it("收到其它窗口的广播：本地缓存失效并通知消费者重取", async () => {
    const listener = vi.fn();
    subscribeProjectionInvalidation(listener);
    await warmCache();
    expect(getCachedProjection()).not.toBeNull();
    expect(apiMocks.getCurrentProjection).toHaveBeenCalledTimes(1);

    // 模拟另一个窗口：同频道实例（它没有 onmessage，只负责发）。
    const otherWindow = new FakeBroadcastChannel(CHANNEL_NAME);
    otherWindow.postMessage({ type: "projection-invalidated" });

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCachedProjection()).toBeNull();
    await requestProjection().promise;
    expect(apiMocks.getCurrentProjection).toHaveBeenCalledTimes(2);
  });

  it("不认识的消息一律忽略（不重取、不清缓存）", async () => {
    const listener = vi.fn();
    subscribeProjectionInvalidation(listener);
    await warmCache();

    const otherWindow = new FakeBroadcastChannel(CHANNEL_NAME);
    otherWindow.postMessage({ type: "something-else" });

    expect(listener).not.toHaveBeenCalled();
    expect(getCachedProjection()).not.toBeNull();
  });
});

describe("没有 BroadcastChannel 时退回 storage 事件", () => {
  it("订阅后监听 storage 事件：别的窗口写 key 即本地失效", async () => {
    removeBroadcastChannel();
    const listener = vi.fn();
    subscribeProjectionInvalidation(listener);
    await warmCache();

    window.dispatchEvent(new StorageEvent("storage", { key: STORAGE_KEY, newValue: "1" }));

    expect(listener).toHaveBeenCalledTimes(1);
    expect(getCachedProjection()).toBeNull();
  });

  it("本窗口失效在无 BroadcastChannel 时写 localStorage（其它窗口靠它收到事件）", () => {
    removeBroadcastChannel();
    const listener = vi.fn();
    subscribeProjectionInvalidation(listener);
    const setItem = vi.spyOn(Storage.prototype, "setItem");

    invalidateProjectionCache();

    expect(setItem).toHaveBeenCalledWith(STORAGE_KEY, expect.any(String));
    expect(listener).toHaveBeenCalledTimes(1);
  });

  it("localStorage 写失败也不影响本窗口失效（广播只是尽力而为）", () => {
    removeBroadcastChannel();
    const listener = vi.fn();
    subscribeProjectionInvalidation(listener);
    vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("QuotaExceeded");
    });

    expect(() => invalidateProjectionCache()).not.toThrow();
    expect(listener).toHaveBeenCalledTimes(1);
  });
});
