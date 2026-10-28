// SPDX-License-Identifier: Apache-2.0
/**
 * `useAbortableRequest` 的口径测试：**取消不是失败**，停止后必须能立刻再点。
 *
 * 用例刻意只覆盖这五条不变量，不去测"调用哪个接口"——那是各面板自己的测试：
 * 1. 正常完成 → `ok` + loading 收起；
 * 2. 主动取消 → `aborted`（不抛错）；loading 当场收起；
 * 3. 取消后可以重跑；
 * 4. 卸载自动 abort（并把 signal 真的断开）；
 * 5. 真实失败与取消可区分（`error` ≠ `aborted`，含 ApiError 与 AbortError 两种来源）。
 */
import { act, renderHook } from "@testing-library/react";
import { describe, expect, it } from "vitest";
import { ApiError } from "../api/client";
import { isAbortError, useAbortableRequest, type AbortableOutcome } from "./useAbortableRequest";

/** 一个只在被 abort 时才落地的任务：模拟"用户不等了"的真实形状。 */
function abortableTask(signalBox: { current: AbortSignal | null }) {
  return (signal: AbortSignal): Promise<string> =>
    new Promise<string>((resolve, reject) => {
      signalBox.current = signal;
      if (signal.aborted) {
        reject(new DOMException("aborted", "AbortError"));
        return;
      }
      signal.addEventListener("abort", () =>
        reject(new DOMException("The operation was aborted.", "AbortError")),
      );
      // 故意不 resolve：真请求在用户点停止之前不会回包。
      void resolve;
    });
}

describe("useAbortableRequest", () => {
  it("正常完成时返回 ok，并把 loading 收起", async () => {
    const { result } = renderHook(() => useAbortableRequest());
    let outcome: AbortableOutcome<number> | undefined;
    await act(async () => {
      outcome = await result.current.run(async () => 42);
    });
    expect(outcome).toEqual({ status: "ok", data: 42 });
    expect(result.current.loading).toBe(false);
    expect(result.current.aborted).toBe(false);
  });

  it("主动取消返回 aborted 而不是 error，loading 当场收起", async () => {
    const { result } = renderHook(() => useAbortableRequest());
    const signalBox: { current: AbortSignal | null } = { current: null };
    let pending: Promise<AbortableOutcome<string>> | undefined;
    act(() => {
      pending = result.current.run(abortableTask(signalBox));
    });
    expect(result.current.loading).toBe(true);
    act(() => {
      result.current.cancel();
    });
    // 「可再点」是同步的：不等 promise 落地。
    expect(result.current.loading).toBe(false);
    expect(result.current.aborted).toBe(true);
    expect(signalBox.current?.aborted).toBe(true);
    const outcome = await pending;
    expect(outcome?.status).toBe("aborted");
  });

  it("取消之后可以重跑，且 aborted 复位", async () => {
    const { result } = renderHook(() => useAbortableRequest());
    const signalBox: { current: AbortSignal | null } = { current: null };
    let pending: Promise<AbortableOutcome<string>> | undefined;
    act(() => {
      pending = result.current.run(abortableTask(signalBox));
    });
    act(() => {
      result.current.cancel();
    });
    await pending;

    let second: AbortableOutcome<string> | undefined;
    await act(async () => {
      second = await result.current.run(async () => "done");
    });
    expect(second).toEqual({ status: "ok", data: "done" });
    expect(result.current.aborted).toBe(false);
    expect(result.current.loading).toBe(false);
  });

  it("卸载时自动 abort 在跑的请求", async () => {
    const { result, unmount } = renderHook(() => useAbortableRequest());
    const signalBox: { current: AbortSignal | null } = { current: null };
    let pending: Promise<AbortableOutcome<string>> | undefined;
    act(() => {
      pending = result.current.run(abortableTask(signalBox));
    });
    unmount();
    expect(signalBox.current?.aborted).toBe(true);
    const outcome = await pending;
    expect(outcome?.status).toBe("aborted");
  });

  it("真实失败与取消可区分（ApiError.cancelled / AbortError 都算取消）", async () => {
    const { result } = renderHook(() => useAbortableRequest());

    const failure = new Error("model timeout");
    let failed: AbortableOutcome<never> | undefined;
    await act(async () => {
      failed = await result.current.run(async () => {
        throw failure;
      });
    });
    expect(failed?.status).toBe("error");
    expect(failed).toMatchObject({ status: "error", error: failure });

    // 取消的两种真实来源都必须判成 aborted，而不是 error。
    expect(isAbortError(new ApiError("cancelled", undefined, { code: "cancelled" }))).toBe(true);
    expect(isAbortError(new DOMException("aborted", "AbortError"))).toBe(true);
    expect(isAbortError(failure)).toBe(false);
  });
});
