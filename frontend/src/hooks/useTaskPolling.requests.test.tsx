// SPDX-License-Identifier: Apache-2.0
import { act, renderHook } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import type { ApplyTaskDetail } from "../types";
import { useTaskPolling } from "./useTaskPolling";

function deferred<T>() {
  let resolve!: (value: T) => void;
  const promise = new Promise<T>((next) => {
    resolve = next;
  });
  return { promise, resolve };
}

function detail(id: number): ApplyTaskDetail {
  return {
    id,
    kind: "apply",
    status: "completed",
    total: 0,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    current_step: "",
    stop_reason: "",
    config: {},
    message: "",
    started_at: null,
    finished_at: null,
    created_at: "2026-10-14T00:00:00",
    items: [],
  };
}

afterEach(() => vi.useRealTimers());

describe("useTaskPolling request identity", () => {
  it("an obsolete request cannot clear the new task's single-flight flag", async () => {
    vi.useFakeTimers();
    const first = deferred<ApplyTaskDetail>();
    const second = deferred<ApplyTaskDetail>();
    const fetcher = vi.fn((id: number) => (id === 1 ? first.promise : second.promise));
    const { result, rerender } = renderHook(({ id }) => useTaskPolling(fetcher, id), {
      initialProps: { id: 1 },
    });
    const obsoleteRefresh = result.current.refresh;
    rerender({ id: 2 });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => first.resolve(detail(1)));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1_600);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    expect(result.current.detail).toBeNull();
    await act(async () => {
      await obsoleteRefresh();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => second.resolve(detail(2)));
    expect(result.current.detail?.id).toBe(2);
  });

  it("equivalent dependency lists stay stable while a changed dependency invalidates old results", async () => {
    const first = deferred<ApplyTaskDetail>();
    const fetcher = vi.fn().mockReturnValueOnce(first.promise).mockResolvedValue(detail(1));
    const { result, rerender } = renderHook(({ scope }) => useTaskPolling(fetcher, 1, [scope]), {
      initialProps: { scope: "A" },
    });
    rerender({ scope: "A" });
    expect(fetcher).toHaveBeenCalledTimes(1);
    rerender({ scope: "B" });
    await act(async () => {
      await Promise.resolve();
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
    await act(async () => first.resolve({ ...detail(1), message: "stale A" }));
    expect(result.current.detail?.message).toBe("");
  });
});
