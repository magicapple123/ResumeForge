// SPDX-License-Identifier: Apache-2.0
/**
 * 对抗性测试：任务轮询在组件卸载后必须停止（避免定时器泄漏与卸载后 setState）。
 *
 * 这是"长任务进度条"最容易出问题的地方：一旦忘了 clearInterval，一个已经离开的页面
 * 会继续每 1.5s 打后端，直到进程结束。
 */
import { act, cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import { useTaskPolling } from "./useTaskPolling";
import type { ApplyTaskDetail } from "../types";

function makeDetail(status: ApplyTaskDetail["status"]): ApplyTaskDetail {
  return {
    id: 1,
    kind: "apply",
    status,
    total: 3,
    processed: 0,
    succeeded: 0,
    failed: 0,
    skipped: 0,
    current_step: "opening",
    stop_reason: "",
    config: {},
    message: "",
    started_at: null,
    finished_at: null,
    created_at: "2026-09-18T00:00:00",
    items: [],
  };
}

function Harness({
  taskId,
  fetcher,
}: {
  taskId: number | null;
  fetcher: (taskId: number) => Promise<ApplyTaskDetail>;
}) {
  const { detail, notFound, refresh, error } = useTaskPolling(fetcher, taskId);
  return (
    <div>
      <div data-testid="status">{detail?.status ?? "none"}</div>
      <div data-testid="not-found">{String(notFound)}</div>
      <div data-testid="error">{error}</div>
      <button data-testid="retry" onClick={() => void refresh()}>
        retry
      </button>
    </div>
  );
}

afterEach(() => {
  cleanup();
  vi.useRealTimers();
  // 测试里覆写过 visibilityState 的话还原成可见，避免污染后续用例。
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => "visible",
  });
});

describe("useTaskPolling", () => {
  it("stops the interval after unmount so no further requests are made", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => makeDetail("running"));
    const { unmount } = render(<Harness taskId={1} fetcher={fetcher} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 轮询确实在推进：再过一个周期应当又拉一次。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(fetcher.mock.calls.length).toBeGreaterThanOrEqual(2);

    const callsBeforeUnmount = fetcher.mock.calls.length;
    unmount();
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetcher.mock.calls.length).toBe(callsBeforeUnmount);
  });

  it("stops polling once the task reaches a terminal status", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => makeDetail("completed"));
    render(<Harness taskId={2} fetcher={fetcher} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    // 终态后不再空转。
    expect(fetcher).toHaveBeenCalledTimes(1);
  });

  it("does not fetch at all when taskId is null", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => makeDetail("running"));
    render(<Harness taskId={null} fetcher={fetcher} />);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(5000);
    });
    expect(fetcher).not.toHaveBeenCalled();
  });

  it("task 404 时置 notFound 并停止轮询（不再每 1.5s 吃一个 404）", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => {
      throw new ApiError("任务不存在", 404);
    });
    render(<Harness taskId={3} fetcher={fetcher} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId("not-found")).toHaveTextContent("true");

    const callsAfter404 = fetcher.mock.calls.length;
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(fetcher.mock.calls.length).toBe(callsAfter404);
  });

  it("404 后点重试会重新拉一次；后端恢复时回到正常显示", async () => {
    vi.useFakeTimers();
    const fetcher = vi
      .fn<(taskId: number) => Promise<ApplyTaskDetail>>()
      .mockRejectedValueOnce(new ApiError("任务不存在", 404))
      .mockResolvedValue(makeDetail("running"));
    render(<Harness taskId={4} fetcher={fetcher} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(screen.getByTestId("not-found")).toHaveTextContent("true");

    fireEvent.click(screen.getByTestId("retry"));
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });

    expect(screen.getByTestId("not-found")).toHaveTextContent("false");
    expect(screen.getByTestId("status")).toHaveTextContent("running");
  });

  it("慢请求不堆积：上一轮未完成不发起下一轮（single-flight）", async () => {
    vi.useFakeTimers();
    let resolveFetch!: (detail: ApplyTaskDetail) => void;
    const fetcher = vi.fn(
      () =>
        new Promise<ApplyTaskDetail>((resolve) => {
          resolveFetch = resolve;
        }),
    );
    render(<Harness taskId={1} fetcher={fetcher} />);

    // 挂载即拉第 1 次；此后不管过多久，请求没完成就不发下一轮。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 请求完成后才排下一轮：再过一个周期拉第 2 次。
    await act(async () => {
      resolveFetch(makeDetail("running"));
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });

  it("失败退避：下一轮间隔 1.5s→3s→6s 封顶；超时错误显示可重试提示", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => {
      throw new ApiError("请求超时，请重试", undefined, { code: "timeout" });
    });
    render(<Harness taskId={5} fetcher={fetcher} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);
    // code=timeout 的错误本身就是可重试口径，直接展示给用户。
    expect(screen.getByTestId("error")).toHaveTextContent("请求超时，请重试");

    // 第 1→2 次间隔 1.5s（与常规间隔一致）。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(1500);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);

    // 第 2→3 次间隔 3s。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(3000);
    });
    expect(fetcher).toHaveBeenCalledTimes(3);

    // 第 3→4 次间隔 6s，此后封顶不再拉长。
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(fetcher).toHaveBeenCalledTimes(4);
    await act(async () => {
      await vi.advanceTimersByTimeAsync(6000);
    });
    expect(fetcher).toHaveBeenCalledTimes(5);
  });

  it("隐藏时跳过轮询，恢复前台立即补拉", async () => {
    vi.useFakeTimers();
    const fetcher = vi.fn(async () => makeDetail("running"));
    render(<Harness taskId={6} fetcher={fetcher} />);

    await act(async () => {
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 模拟切到后台：tick 照常触发但一律跳过，不发起请求。
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "hidden",
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(10_000);
    });
    expect(fetcher).toHaveBeenCalledTimes(1);

    // 回到前台：visibilitychange 触发立即补拉。
    Object.defineProperty(document, "visibilityState", {
      configurable: true,
      get: () => "visible",
    });
    await act(async () => {
      document.dispatchEvent(new Event("visibilitychange"));
      await vi.advanceTimersByTimeAsync(1);
    });
    expect(fetcher).toHaveBeenCalledTimes(2);
  });
});
