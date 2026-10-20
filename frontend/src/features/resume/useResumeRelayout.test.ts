// SPDX-License-Identifier: Apache-2.0
/**
 * 尾随合并（项 6 / D11）：**只渲染用户最后停住的那一版**。
 *
 * 三条性质是这次重构的全部价值，所以逐条钉住：
 * 1. 空闲即渲（不攒批，单次调整要立刻有反应）；
 * 2. 在飞时只保留**最新**一版 → 任意长度一次拖动最多 2 次请求，参数序列 `[首个, 最后]`；
 * 3. 失败不重试（失败 → 重试 → 再失败会变死循环），且卸载后不回调。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it, vi } from "vitest";
import type { ResumeLayout } from "../../types";
import { useResumeRelayout } from "./useResumeRelayout";

function layout(pageLimit: number): ResumeLayout {
  return { template: "classic", format_name: "", page_limit: pageLimit, font_scale: "standard" };
}

const A = layout(1);
const B = layout(2);
const C = layout(3);

/** 手控 Promise：用来制造"渲染还在飞"的那段时间窗口。 */
function defer() {
  let resolve!: () => void;
  let reject!: (error: unknown) => void;
  const promise = new Promise<void>((res, rej) => {
    resolve = res;
    reject = rej;
  });
  return { promise, resolve, reject };
}

describe("useResumeRelayout", () => {
  it("空闲即渲：request 立刻发起一次渲染，期间 relayouting 为 true", async () => {
    const gate = defer();
    const render = vi.fn(() => gate.promise);
    const onRendered = vi.fn();
    const { result } = renderHook(() => useResumeRelayout({ render, onRendered }));

    act(() => result.current.request(A));

    expect(render).toHaveBeenCalledTimes(1);
    expect(render).toHaveBeenCalledWith(A);
    expect(result.current.relayouting).toBe(true);
    // 渲染还没完成，草稿不能推进（宿主的 setLayout 在 onRendered 里）。
    expect(onRendered).not.toHaveBeenCalled();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(onRendered).toHaveBeenCalledWith(A);
    expect(result.current.relayouting).toBe(false);
  });

  it("尾随合并：在飞时只保留最新一版，总计 2 次渲染且参数序列是 [a, c]", async () => {
    const gate = defer();
    const render = vi.fn().mockReturnValueOnce(gate.promise).mockResolvedValue(undefined);
    const onRendered = vi.fn();
    const { result } = renderHook(() => useResumeRelayout({ render, onRendered }));

    act(() => result.current.request(A));
    act(() => result.current.request(B));
    act(() => result.current.request(C));

    // a 还在飞：b、c 都没有发请求。
    expect(render).toHaveBeenCalledTimes(1);

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(render).toHaveBeenCalledTimes(2);
    // 只渲染"最后停住的那一版"：b 从未被渲染。
    expect(render.mock.calls.map((call) => call[0])).toEqual([A, C]);
    expect(onRendered.mock.calls.map((call) => call[0])).toEqual([A, C]);
    expect(result.current.relayouting).toBe(false);
  });

  it("失败不重试：汇报 onError、pending 丢弃、relayouting 归位", async () => {
    const gate = defer();
    const render = vi.fn(() => gate.promise);
    const onError = vi.fn();
    const onRendered = vi.fn();
    const { result } = renderHook(() => useResumeRelayout({ render, onRendered, onError }));

    act(() => result.current.request(A));
    // c 排进 pending：失败之后它必须被丢弃，否则"失败→重试→失败"会变死循环。
    act(() => result.current.request(C));

    await act(async () => {
      gate.reject(new Error("渲染失败"));
      await gate.promise.catch(() => undefined);
    });

    expect(onError).toHaveBeenCalledTimes(1);
    expect(onError.mock.calls[0][1]).toEqual(A);
    expect(onRendered).not.toHaveBeenCalled();
    expect(render).toHaveBeenCalledTimes(1);
    expect(result.current.relayouting).toBe(false);
  });

  it("卸载后不回调：渲染完成时组件已经没了，不 setState、不调 onRendered", async () => {
    const gate = defer();
    const render = vi.fn(() => gate.promise);
    const onRendered = vi.fn();
    const { result, unmount } = renderHook(() => useResumeRelayout({ render, onRendered }));

    act(() => result.current.request(A));
    unmount();

    await act(async () => {
      gate.resolve();
      await gate.promise;
    });

    expect(onRendered).not.toHaveBeenCalled();
  });
});
