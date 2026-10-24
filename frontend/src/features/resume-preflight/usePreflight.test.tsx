// SPDX-License-Identifier: Apache-2.0
/**
 * usePreflight（W11）：单飞、取消、过时丢弃、错误态、防抖。
 *
 * 这些性质错了不会报错，只会"偶尔显示上一版结论"——正是检查功能最伤信任的失败形态。
 * "过时"以**客户端请求键**判定（发起时的草稿指纹 vs 回包时的草稿指纹），不依赖后端哈希，
 * 否则前端永远无法判断"请求发出后用户又改了没有"。
 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { PreflightOut, PreflightRequest } from "./types";
import { usePreflight } from "./usePreflight";
import type { runPreflight } from "./preflightApi";
import { makePreflightOut } from "../../test/preflightFixtures";

type Fetcher = typeof runPreflight;

function deferred<T>() {
  let resolve!: (value: T) => void;
  let reject!: (reason?: unknown) => void;
  const promise = new Promise<T>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

const BUILD = (): PreflightRequest => ({ layers: ["content"] });

function useHarness(fetcher: Fetcher, currentKey: string | null, debounceMs = 400) {
  // renderHook 的回调就是 Hook 宿主；用命名组件包一层，规则扫描器才认得出这是组件边界。
  function Probe({ hookKey }: { hookKey: string | null }) {
    return usePreflight({
      resumeId: 7,
      currentKey: hookKey,
      buildRequest: BUILD,
      fetcher,
      debounceMs,
    });
  }
  return renderHook(Probe, { initialProps: { hookKey: currentKey } });
}

afterEach(() => {
  vi.useRealTimers();
  vi.restoreAllMocks();
});

describe("usePreflight：请求编排", () => {
  it("挂载不自动请求（用户点检查才跑）", () => {
    const fetcher = vi.fn() as unknown as Fetcher;
    useHarness(fetcher, "k1");
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("单飞：在飞期间再点不发第二个请求", async () => {
    const pending = deferred<PreflightOut>();
    const fetcher = vi.fn(() => pending.promise) as unknown as Fetcher;
    const { result } = useHarness(fetcher, "k1");
    act(() => {
      void result.current.run();
      void result.current.run();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    await act(async () => {
      pending.resolve(makePreflightOut());
      await pending.promise;
    });
    await waitFor(() => expect(result.current.status).toBe("ready"));
  });

  it("请求发出后草稿又变 → 回包丢弃，不显示旧结论", async () => {
    const pending = deferred<PreflightOut>();
    const fetcher = vi.fn(() => pending.promise) as unknown as Fetcher;
    const { result, rerender } = useHarness(fetcher, "k1");
    act(() => {
      void result.current.run();
    });
    rerender({ hookKey: "k2" });
    await act(async () => {
      pending.resolve(makePreflightOut());
      await pending.promise;
    });
    expect(result.current.result).toBeNull();
    expect(result.current.status).toBe("idle");
  });

  it("结果落库后草稿再变 → stale=true（不自动重跑）", async () => {
    const fetcher = vi.fn(async () => makePreflightOut()) as unknown as Fetcher;
    const { result, rerender } = useHarness(fetcher, "k1");
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.stale).toBe(false);
    rerender({ hookKey: "k2" });
    expect(result.current.stale).toBe(true);
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("取消：中止在飞请求，不进入错误态", async () => {
    let captured: AbortSignal | undefined;
    const fetcher = vi.fn((_id: number, _body: unknown, signal?: AbortSignal) => {
      captured = signal;
      return new Promise<PreflightOut>(() => undefined);
    }) as unknown as Fetcher;
    const { result } = useHarness(fetcher, "k1");
    act(() => {
      void result.current.run();
    });
    expect(result.current.running).toBe(true);
    act(() => result.current.cancel());
    expect(captured?.aborted).toBe(true);
    expect(result.current.status).toBe("idle");
    expect(result.current.error).toBe("");
  });

  it("失败进入错误态并保留可重试入口", async () => {
    const fetcher = vi.fn(async () => {
      throw new Error("服务器错误");
    }) as unknown as Fetcher;
    const { result } = useHarness(fetcher, "k1");
    await act(async () => {
      await result.current.run();
    });
    expect(result.current.status).toBe("error");
    expect(result.current.error).toBe("服务器错误");
    expect(result.current.result).toBeNull();
  });

  it("复检走防抖窗口（≥400ms），连点只发一次", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => makePreflightOut()) as unknown as Fetcher;
    const { result } = useHarness(fetcher, "k1", 400);
    act(() => {
      result.current.schedule();
      result.current.schedule();
    });
    act(() => {
      vi.advanceTimersByTime(399);
    });
    expect(fetcher).not.toHaveBeenCalled();
    await act(async () => {
      vi.advanceTimersByTime(5);
      await Promise.resolve();
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
  });
});
