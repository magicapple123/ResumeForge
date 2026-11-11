// SPDX-License-Identifier: Apache-2.0
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import {
  getViewRefreshVersion,
  requestViewRefresh,
  resetViewRefreshForTests,
} from "../features/shell/viewRefresh";
import { resetFocusRefreshForTests } from "./focusRefresh";
import { useApi } from "./useApi";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

let visibility: DocumentVisibilityState = "visible";

function setVisibility(next: DocumentVisibilityState): void {
  visibility = next;
  Object.defineProperty(document, "visibilityState", { configurable: true, get: () => visibility });
}

function fireVisibilityChange(): void {
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  resetFocusRefreshForTests();
  resetViewRefreshForTests();
  setVisibility("visible");
});

afterEach(() => {
  vi.restoreAllMocks();
  resetFocusRefreshForTests();
  resetViewRefreshForTests();
});

describe("useApi", () => {
  it("keeps equivalent dependencies stable and reloads with the newest fetcher", async () => {
    const fetcher = vi.fn(async () => "first");
    const nextFetcher = vi.fn(async () => "second");
    const { result, rerender } = renderHook(({ fn, key }) => useApi(fn, [key]), {
      initialProps: { fn: fetcher, key: 1 },
    });
    await waitFor(() => expect(result.current.data).toBe("first"));
    const oldReload = result.current.reload;
    rerender({ fn: nextFetcher, key: 1 });
    expect(nextFetcher).not.toHaveBeenCalled();
    await act(async () => result.current.reload());
    expect(result.current.data).toBe("second");
    rerender({ fn: nextFetcher, key: 2 });
    await waitFor(() => expect(nextFetcher).toHaveBeenCalledTimes(2));
    await act(async () => oldReload());
    expect(nextFetcher).toHaveBeenCalledTimes(2);
  });

  it("does not let an older response overwrite the latest request", async () => {
    const first = deferred<string>();
    const second = deferred<string>();
    const { result, rerender } = renderHook(
      ({ version }) => useApi(() => (version === 1 ? first.promise : second.promise), [version]),
      { initialProps: { version: 1 } },
    );

    rerender({ version: 2 });
    await act(async () => second.resolve("latest"));
    await waitFor(() => expect(result.current.data).toBe("latest"));

    await act(async () => first.resolve("stale"));
    expect(result.current.data).toBe("latest");
  });

  it("切换时旧请求被 abort（信号传给 fetcher），且取消不进错误态", async () => {
    const signals: AbortSignal[] = [];
    const { result, rerender } = renderHook(
      ({ version }) =>
        useApi(
          (signal?: AbortSignal) => {
            signals.push(signal as AbortSignal);
            return new Promise<string>((_resolve, reject) => {
              signal?.addEventListener("abort", () =>
                reject(new ApiError("已取消", undefined, { code: "cancelled" })),
              );
            });
          },
          [version],
        ),
      { initialProps: { version: 1 } },
    );

    rerender({ version: 2 });
    // 版本守卫之外，被替换的旧请求真的被中止了；新请求不受影响。
    expect(signals[0].aborted).toBe(true);
    expect(signals[1].aborted).toBe(false);
    // 取消不进错误态。
    await act(async () => {
      await Promise.resolve();
    });
    expect(result.current.error).toBe("");
  });

  it("fetcher 抛出取消错误时不进错误态", async () => {
    const { result } = renderHook(() =>
      useApi(() => Promise.reject(new ApiError("已取消", undefined, { code: "cancelled" })), []),
    );
    await waitFor(() => expect(result.current.loading).toBe(false));
    expect(result.current.error).toBe("");
  });

  it("enabled: false 时挂载不请求、loading 初值 false，手动 reload 仍然发请求", async () => {
    const fetcher = vi.fn(async () => "manual");
    const { result } = renderHook(() => useApi(fetcher, [], { enabled: false }));

    expect(result.current.loading).toBe(false);
    expect(result.current.data).toBeUndefined();
    expect(fetcher).not.toHaveBeenCalled();

    await act(async () => result.current.reload());
    expect(fetcher).toHaveBeenCalledTimes(1);
    expect(result.current.data).toBe("manual");
  });

  describe("refetchOnFocus（问题 27a）", () => {
    it("未传 refetchOnFocus 时，回到前台不重拉", async () => {
      const fetcher = vi.fn(async () => "v1");
      const { result } = renderHook(() => useApi(fetcher, []));
      await waitFor(() => expect(result.current.data).toBe("v1"));

      await act(async () => fireVisibilityChange());
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("页面不可见时不重拉", async () => {
      const fetcher = vi.fn(async () => "v1");
      const { result } = renderHook(() => useApi(fetcher, [], { refetchOnFocus: {} }));
      await waitFor(() => expect(result.current.data).toBe("v1"));

      setVisibility("hidden");
      await act(async () => fireVisibilityChange());
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("skip() 为 true 时不重拉（留给有未保存草稿的页面）", async () => {
      const fetcher = vi.fn(async () => "v1");
      const skip = vi.fn(() => true);
      const { result } = renderHook(() =>
        useApi(fetcher, [], { refetchOnFocus: { minIntervalMs: 0, skip } }),
      );
      await waitFor(() => expect(result.current.data).toBe("v1"));

      await act(async () => fireVisibilityChange());
      expect(skip).toHaveBeenCalled();
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("默认 30s 内反复切回只拉一次，超过之后才补拉", async () => {
      let clock = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => clock);
      const fetcher = vi.fn(async () => "v1");
      const { result } = renderHook(() => useApi(fetcher, [], { refetchOnFocus: {} }));
      await waitFor(() => expect(result.current.data).toBe("v1"));

      await act(async () => fireVisibilityChange());
      expect(fetcher).toHaveBeenCalledTimes(1);

      clock += 10_000;
      await act(async () => fireVisibilityChange());
      expect(fetcher).toHaveBeenCalledTimes(1);

      clock += 31_000;
      await act(async () => fireVisibilityChange());
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));
    });

    it("静默重拉不置 loading，也不闪错误态", async () => {
      let clock = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => clock);
      const second = deferred<string>();
      const fetcher = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("v1")
        .mockImplementationOnce(() => second.promise);
      const { result } = renderHook(() => useApi(fetcher, [], { refetchOnFocus: {} }));
      await waitFor(() => expect(result.current.data).toBe("v1"));

      clock += 31_000;
      await act(async () => fireVisibilityChange());
      expect(fetcher).toHaveBeenCalledTimes(2);
      // 有 data 的静默重拉：不置 loading，用户看不到骨架屏。
      expect(result.current.loading).toBe(false);
      expect(result.current.data).toBe("v1");

      await act(async () => second.resolve("v2"));
      expect(result.current.data).toBe("v2");
      expect(result.current.loading).toBe(false);
    });

    it("静默重拉失败时保留旧数据、不进错误态", async () => {
      let clock = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => clock);
      const fetcher = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("v1")
        .mockRejectedValueOnce(new Error("network down"));
      const { result } = renderHook(() => useApi(fetcher, [], { refetchOnFocus: {} }));
      await waitFor(() => expect(result.current.data).toBe("v1"));

      clock += 31_000;
      await act(async () => fireVisibilityChange());
      await waitFor(() => expect(fetcher).toHaveBeenCalledTimes(2));

      expect(result.current.data).toBe("v1");
      expect(result.current.error).toBe("");
      expect(result.current.loading).toBe(false);
    });

    it("已有请求在飞时，静默重拉不叠加请求", async () => {
      let clock = 1_000_000;
      vi.spyOn(Date, "now").mockImplementation(() => clock);
      const first = deferred<string>();
      const fetcher = vi.fn<() => Promise<string>>(() => first.promise);
      const { result } = renderHook(() => useApi(fetcher, [], { refetchOnFocus: {} }));

      expect(fetcher).toHaveBeenCalledTimes(1);
      clock += 31_000;
      await act(async () => fireVisibilityChange());
      expect(fetcher).toHaveBeenCalledTimes(1);

      await act(async () => first.resolve("v1"));
      expect(result.current.data).toBe("v1");
    });
  });

  describe("viewRefresh（品牌图标双击 / Alt+R，P5-1）", () => {
    it("广播一次就重取一次，且保留旧数据、不置 loading（静默刷新）", async () => {
      const fetcher = vi
        .fn<() => Promise<string>>()
        .mockResolvedValueOnce("v1")
        .mockResolvedValueOnce("v2");
      const { result } = renderHook(() => useApi(fetcher, []));
      await waitFor(() => expect(result.current.data).toBe("v1"));
      expect(fetcher).toHaveBeenCalledTimes(1);

      await act(async () => requestViewRefresh());

      expect(fetcher).toHaveBeenCalledTimes(2);
      // 静默：不置 loading（否则长列表页会闪骨架屏、滚动位置被带回顶部）。
      expect(result.current.loading).toBe(false);
      await waitFor(() => expect(result.current.data).toBe("v2"));
    });

    it("同一页多个 useApi 各重取恰好一次（广播不放大请求数）", async () => {
      const first = vi.fn(async () => "a");
      const second = vi.fn(async () => "b");
      renderHook(() => {
        useApi(first, []);
        useApi(second, []);
        return null;
      });
      await waitFor(() => {
        expect(first).toHaveBeenCalledTimes(1);
        expect(second).toHaveBeenCalledTimes(1);
      });

      await act(async () => requestViewRefresh());

      expect(first).toHaveBeenCalledTimes(2);
      expect(second).toHaveBeenCalledTimes(2);
    });

    it("refreshOnRequest: false 的调用点不随广播重取（未保存草稿不被覆盖）", async () => {
      const fetcher = vi.fn(async () => "server");
      const { result } = renderHook(() => useApi(fetcher, [], { refreshOnRequest: false }));
      await waitFor(() => expect(result.current.data).toBe("server"));

      await act(async () => requestViewRefresh());

      expect(fetcher).toHaveBeenCalledTimes(1);
      expect(result.current.data).toBe("server");
    });

    it("订阅本身不发请求：挂载后到第一次广播之间只有一次请求", async () => {
      const fetcher = vi.fn(async () => "v1");
      const { result } = renderHook(() => useApi(fetcher, []));
      await waitFor(() => expect(result.current.data).toBe("v1"));
      expect(getViewRefreshVersion()).toBe(0);
      expect(fetcher).toHaveBeenCalledTimes(1);
    });

    it("未挂载的订阅点不会被广播牵连（退订后不再收到）", async () => {
      const fetcher = vi.fn(async () => "v1");
      const { result, unmount } = renderHook(() => useApi(fetcher, []));
      await waitFor(() => expect(result.current.data).toBe("v1"));
      unmount();

      await act(async () => requestViewRefresh());

      expect(fetcher).toHaveBeenCalledTimes(1);
    });
  });
});
