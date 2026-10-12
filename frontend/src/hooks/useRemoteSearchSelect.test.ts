/** 远程搜索选择器 hook：防抖、竞态丢弃、已选值回查保显示。 */
import { act, renderHook, waitFor } from "@testing-library/react";
import { afterEach, describe, expect, it, vi } from "vitest";
import { useRemoteSearchSelect, type RemoteSelectOption } from "./useRemoteSearchSelect";

function option(value: number, label: string): RemoteSelectOption {
  return { value, label };
}

describe("useRemoteSearchSelect", () => {
  afterEach(() => {
    vi.useRealTimers();
  });

  it("onSearch 防抖后才发请求，且只保留最后一次关键词的结果", async () => {
    vi.useFakeTimers();
    const fetchOptions = vi.fn((keyword: string) =>
      Promise.resolve([option(1, `结果:${keyword}`)]),
    );
    const { result } = renderHook(() =>
      useRemoteSearchSelect({ fetchOptions, fetchById: () => Promise.resolve(null) }),
    );

    // 初始不发请求（由调用方在打开时主动 reload）。
    expect(fetchOptions).not.toHaveBeenCalled();

    act(() => {
      result.current.selectProps.onSearch("数");
      result.current.selectProps.onSearch("数据");
    });
    expect(fetchOptions).not.toHaveBeenCalled();

    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(fetchOptions).toHaveBeenCalledTimes(1);
    expect(fetchOptions).toHaveBeenCalledWith("数据");
    expect(result.current.selectProps.options).toEqual([option(1, "结果:数据")]);
    expect(result.current.selectProps.loading).toBe(false);
  });

  it("过期响应被丢弃：先发慢请求、再发快请求，只采纳最后一次", async () => {
    vi.useFakeTimers();
    const fetchOptions = vi
      .fn()
      .mockImplementationOnce(
        () => new Promise((resolve) => setTimeout(() => resolve([option(9, "慢的旧结果")]), 800)),
      )
      .mockImplementationOnce(() => Promise.resolve([option(2, "新的结果")]));
    const { result } = renderHook(() =>
      useRemoteSearchSelect({ fetchOptions, fetchById: () => Promise.resolve(null) }),
    );

    act(() => {
      result.current.selectProps.onSearch("旧");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    act(() => {
      result.current.selectProps.onSearch("新");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(800);
    });
    // 慢的第一次响应晚到，必须被序号比对丢弃。
    expect(result.current.selectProps.options).toEqual([option(2, "新的结果")]);
  });

  it("请求失败时清空选项并结束 loading", async () => {
    vi.useFakeTimers();
    const fetchOptions = vi.fn(() => Promise.reject(new Error("网络错误")));
    const { result } = renderHook(() =>
      useRemoteSearchSelect({ fetchOptions, fetchById: () => Promise.resolve(null) }),
    );
    act(() => {
      result.current.selectProps.onSearch("任意");
    });
    await act(async () => {
      await vi.advanceTimersByTimeAsync(300);
    });
    expect(result.current.selectProps.options).toEqual([]);
    expect(result.current.selectProps.loading).toBe(false);
  });

  it("ensure 按 id 回查并并入选项头部，重复 ensure 走缓存", async () => {
    const fetchById = vi.fn(() => Promise.resolve(option(42, "旧岗位")));
    const { result } = renderHook(() =>
      useRemoteSearchSelect({
        fetchOptions: () => Promise.resolve([]),
        fetchById,
      }),
    );

    act(() => {
      result.current.ensure(42);
    });
    await waitFor(() => expect(result.current.selectProps.options).toEqual([option(42, "旧岗位")]));
    expect(fetchById).toHaveBeenCalledTimes(1);

    // 已在选项里：既不再请求，也不重复插入。
    act(() => {
      result.current.ensure(42);
    });
    expect(fetchById).toHaveBeenCalledTimes(1);
    expect(result.current.selectProps.options).toEqual([option(42, "旧岗位")]);

    // ensure(null/undefined) 是无操作。
    act(() => {
      result.current.ensure(null);
      result.current.ensure(undefined);
    });
    expect(fetchById).toHaveBeenCalledTimes(1);
  });

  it("ensure 的回查失败不抛错、不影响选项", async () => {
    const fetchById = vi.fn(() => Promise.reject(new Error("404")));
    const { result } = renderHook(() =>
      useRemoteSearchSelect({
        fetchOptions: () => Promise.resolve([option(1, "现有项")]),
        fetchById,
      }),
    );
    await act(async () => {
      await result.current.reload();
    });
    act(() => {
      result.current.ensure(999);
    });
    await waitFor(() => expect(fetchById).toHaveBeenCalled());
    expect(result.current.selectProps.options).toEqual([option(1, "现有项")]);
  });

  it("selectProps 携带远程搜索所需的全部开关", () => {
    const { result } = renderHook(() =>
      useRemoteSearchSelect({
        fetchOptions: () => Promise.resolve([]),
        fetchById: () => Promise.resolve(null),
      }),
    );
    expect(result.current.selectProps.showSearch).toBe(true);
    expect(result.current.selectProps.filterOption).toBe(false);
    expect(typeof result.current.selectProps.onSearch).toBe("function");
    expect(typeof result.current.selectProps.notFoundContent).toBe("string");
  });
});
