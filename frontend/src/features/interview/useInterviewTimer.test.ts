// SPDX-License-Identifier: Apache-2.0
/**
 * 面试计时器：格式化边界 + 走表/暂停行为 + 暂停时上报一次。
 *
 * 这三条正是产品要求：点「准备好了」才走、离开暂停、回来才继续——所以"没点按钮时不许
 * 自行走秒"和"暂停时要把累计值交给服务端"都必须被钉住。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { formatElapsed, useInterviewTimer } from "./useInterviewTimer";

describe("formatElapsed", () => {
  it("一分钟以内：mm:ss", () => {
    expect(formatElapsed(0)).toBe("00:00");
    expect(formatElapsed(5)).toBe("00:05");
    expect(formatElapsed(65)).toBe("01:05");
    expect(formatElapsed(599)).toBe("09:59");
  });

  it("超过一小时：h:mm:ss", () => {
    expect(formatElapsed(3600)).toBe("1:00:00");
    expect(formatElapsed(3661)).toBe("1:01:01");
    expect(formatElapsed(36_000)).toBe("10:00:00");
  });

  it("脏数据按 0 处理：界面上不许出现 NaN:NaN", () => {
    expect(formatElapsed(-5)).toBe("00:00");
    expect(formatElapsed(Number.NaN)).toBe("00:00");
    expect(formatElapsed(Number.POSITIVE_INFINITY)).toBe("00:00");
    // 小数向下取整（不会因为 0.9s 就显示 1 秒）。
    expect(formatElapsed(59.9)).toBe("00:59");
  });
});

describe("useInterviewTimer", () => {
  beforeEach(() => {
    vi.useFakeTimers();
  });

  afterEach(() => {
    vi.useRealTimers();
  });

  it("running=false 时不走表（进房间但还没点「准备好了」）", () => {
    const onPersist = vi.fn();
    const { result } = renderHook(() =>
      useInterviewTimer({ sessionId: 1, initialSeconds: 0, running: false, onPersist }),
    );

    act(() => {
      vi.advanceTimersByTime(5000);
    });

    expect(result.current.seconds).toBe(0);
    expect(result.current.label).toBe("00:00");
  });

  it("running=true 后每秒走一格，65s 显示 01:05", () => {
    const onPersist = vi.fn();
    const { result, rerender } = renderHook(
      ({ running }: { running: boolean }) =>
        useInterviewTimer({ sessionId: 1, initialSeconds: 0, running, onPersist }),
      { initialProps: { running: false } },
    );

    rerender({ running: true });
    act(() => {
      vi.advanceTimersByTime(65_000);
    });

    expect(result.current.seconds).toBe(65);
    expect(result.current.label).toBe("01:05");
  });

  it("打开旧会话从服务端记住的秒数接着算", () => {
    const { result, rerender } = renderHook(
      ({ running }: { running: boolean }) =>
        useInterviewTimer({
          sessionId: 9,
          initialSeconds: 120,
          running,
          onPersist: vi.fn(),
        }),
      { initialProps: { running: false } },
    );

    expect(result.current.label).toBe("02:00");
    rerender({ running: true });
    act(() => {
      vi.advanceTimersByTime(3000);
    });
    expect(result.current.seconds).toBe(123);
  });

  it("暂停（running true → false）时上报一次累计值，之后不再走表", () => {
    const onPersist = vi.fn();
    const { result, rerender } = renderHook(
      ({ running }: { running: boolean }) =>
        useInterviewTimer({ sessionId: 1, initialSeconds: 0, running, onPersist }),
      { initialProps: { running: false } },
    );
    // 从未走过表：暂停回调不该凭空冒出来。
    expect(onPersist).not.toHaveBeenCalled();

    rerender({ running: true });
    act(() => {
      vi.advanceTimersByTime(4000);
    });
    expect(onPersist).not.toHaveBeenCalled();

    rerender({ running: false });
    // 绝对值语义：报的是"本次已累计 4 秒"。
    expect(onPersist).toHaveBeenCalledTimes(1);
    expect(onPersist).toHaveBeenCalledWith(4);

    act(() => {
      vi.advanceTimersByTime(10_000);
    });
    expect(result.current.seconds).toBe(4);
    expect(onPersist).toHaveBeenCalledTimes(1);
  });

  it("flush 立即上报当前值（提交回答 / 确认结束前用）", () => {
    const onPersist = vi.fn();
    const { result, rerender } = renderHook(
      ({ running }: { running: boolean }) =>
        useInterviewTimer({ sessionId: 1, initialSeconds: 0, running, onPersist }),
      { initialProps: { running: false } },
    );

    rerender({ running: true });
    act(() => {
      vi.advanceTimersByTime(7000);
    });
    act(() => {
      result.current.flush();
    });

    expect(onPersist).toHaveBeenCalledWith(7);
  });

  it("换一场面试：计时从新会话的已有时长重新开始", () => {
    const { result, rerender } = renderHook(
      ({ sessionId }: { sessionId: number }) =>
        useInterviewTimer({
          sessionId,
          initialSeconds: sessionId === 1 ? 30 : 200,
          running: false,
          onPersist: vi.fn(),
        }),
      { initialProps: { sessionId: 1 } },
    );
    expect(result.current.seconds).toBe(30);

    rerender({ sessionId: 2 });
    expect(result.current.seconds).toBe(200);
  });

  it("卸载时上报一次（离开页面不应丢掉已走的秒数）", () => {
    const onPersist = vi.fn();
    const { rerender, unmount } = renderHook(
      ({ running }: { running: boolean }) =>
        useInterviewTimer({ sessionId: 1, initialSeconds: 0, running, onPersist }),
      { initialProps: { running: false } },
    );

    rerender({ running: true });
    act(() => {
      vi.advanceTimersByTime(2000);
    });
    unmount();

    expect(onPersist).toHaveBeenCalledWith(2);
  });
});
