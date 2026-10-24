// SPDX-License-Identifier: Apache-2.0
/**
 * 懒加载注册表（A04）：失败可恢复、并发去重、成功复用。
 *
 * 为什么单测这一层：`AppShell` 的空闲预热与 `App.tsx` 的路由表共用同一批 `lazyPage`。
 * 失败被永久缓存的症状不是抛错，而是"某个页面从此打不开"——在集成层面只表现为一片空白，
 * 只有在这一层才能数清 factory 到底执行了几次。
 */
import type { ComponentType } from "react";
import { describe, expect, it } from "vitest";
import { lazyPage } from "./registry";

/** 页面组件桩：只需要一个能放进 `{ default }` 的组件。 */
const Page: ComponentType = () => null;

/** `import()` 的解析结果形状（`lazyPage` 的 factory 契约）。 */
type PageModule = { default: ComponentType };

describe("lazyPage", () => {
  it("首次 factory 失败后第二次调用重新执行并成功", async () => {
    let calls = 0;
    const page = lazyPage((): Promise<PageModule> => {
      calls += 1;
      return calls === 1
        ? Promise.reject(new Error("chunk 加载失败"))
        : Promise.resolve({ default: Page });
    });

    await expect(page.preload()).rejects.toThrow("chunk 加载失败");
    // 失败没有被永久缓存：下一次调用重新执行 factory，于是页面能靠一次导航自愈。
    await expect(page.preload()).resolves.toEqual({ default: Page });
    expect(calls).toBe(2);
  });

  it("并发两次调用遇到失败也只执行一次 factory（失败不引起重试风暴）", async () => {
    let calls = 0;
    const page = lazyPage((): Promise<PageModule> => {
      calls += 1;
      return Promise.reject(new Error("chunk 加载失败"));
    });

    const first = page.preload();
    const second = page.preload();
    expect(second).toBe(first);

    await expect(first).rejects.toThrow("chunk 加载失败");
    await expect(second).rejects.toThrow("chunk 加载失败");
    expect(calls).toBe(1);
  });

  it("同一加载窗口内并发两次只执行一次 factory", async () => {
    let calls = 0;
    let release: (value: { default: ComponentType }) => void = () => {};
    const page = lazyPage(() => {
      calls += 1;
      return new Promise<{ default: ComponentType }>((resolve) => {
        release = resolve;
      });
    });

    const first = page.preload();
    const second = page.preload();
    expect(calls).toBe(1);
    expect(second).toBe(first);

    release({ default: Page });
    await expect(first).resolves.toEqual({ default: Page });
    await expect(second).resolves.toEqual({ default: Page });
    expect(calls).toBe(1);
  });

  it("成功后再次调用复用同一个结果（factory 不再执行）", async () => {
    let calls = 0;
    const page = lazyPage(() => {
      calls += 1;
      return Promise.resolve({ default: Page });
    });

    const first = page.preload();
    await first;
    const third = page.preload();

    expect(calls).toBe(1);
    expect(third).toBe(first);
  });
});
