import { act, renderHook, waitFor } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { useApi } from "./useApi";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

describe("useApi", () => {
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
});
