// SPDX-License-Identifier: Apache-2.0
/**
 * E05（前端半边）：**正文读取挂起时用户取消 / 重新加载页面**的终态。
 *
 * 审计缺口原文："E05 无重载/浏览器"。A03 已经证明"正文读取期间 abort → cancelled、
 * 预算到期 → timeout"，但那条用例只覆盖了调用方主动 abort；真实场景是用户直接刷新/关标签页
 * （`pagehide`）或干脆放着不管。这里把两条终态钉死：
 *
 * 1. `pagehide` 触发页面级 controller.abort()（真实应用在页面级 controller 上就是这样收尾）：
 *    正在读正文的请求必须拒绝成 `cancelled`，且 timer / abort 监听全部清理；
 * 2. 重载前没有 abort（浏览器直接杀掉页面）时，**预算仍然必须到期**——不允许"响应头回来了、
 *    正文永远读不完"这种无限 loading 残留；终态是 `timeout`，同样清理干净。
 *
 * 单独成文件：`client.bodyBudget.test.ts` 已接近 500 行测试预算，且这里的夹具以
 * `pagehide` 为中心（那一份不带页面生命周期）。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, BUDGETS_MS, isCancellation, request, requestRaw } from "./client";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** 响应头立刻可用、正文永远读不完的响应（与 bodyBudget 那份同形，但独立成文件）。 */
function pendingBodyResponse(status = 200): { resp: Response; bodyReading: Promise<void> } {
  let notify = (): void => {};
  const bodyReading = new Promise<void>((resolve) => {
    notify = resolve;
  });
  const body = new ReadableStream<Uint8Array>({
    pull() {
      notify();
      return new Promise<void>(() => {});
    },
  });
  return {
    resp: new Response(body, { status, headers: { "Content-Type": "application/json" } }),
    bodyReading,
  };
}

function settledError(promise: Promise<unknown>): Promise<ApiError> {
  return promise.then(
    () => {
      throw new Error("should not resolve");
    },
    (error: ApiError) => error,
  );
}

describe("正文读取挂起时取消 / 重新加载（E05）", () => {
  it("pagehide：请求以 cancelled 收尾，不无限 loading、不留 timer", async () => {
    vi.useFakeTimers();
    const pending = pendingBodyResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pending.resp));
    const controller = new AbortController();
    const onPageHide = () => controller.abort();
    window.addEventListener("pagehide", onPageHide);
    let loading = true;

    try {
      const captured = settledError(request("/slow-body", { signal: controller.signal })).finally(
        () => {
          loading = false;
        },
      );
      // 等到底层流真的开始被读：这正是"响应头已回、正文卡住"的时段。
      await pending.bodyReading;
      expect(loading).toBe(true);

      window.dispatchEvent(new Event("pagehide"));
      const error = await captured;

      expect(error).toBeInstanceOf(ApiError);
      expect(error.code).toBe("cancelled");
      expect(isCancellation(error)).toBe(true);
      expect(loading).toBe(false);
      expect(vi.getTimerCount()).toBe(0);
    } finally {
      window.removeEventListener("pagehide", onPageHide);
    }
  });

  it("重载前没有 abort：预算到期仍然以 timeout 收尾（不会永远 loading）", async () => {
    vi.useFakeTimers();
    const pending = pendingBodyResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pending.resp));
    let loading = true;

    const captured = settledError(request("/slow-body")).finally(() => {
      loading = false;
    });
    await pending.bodyReading;
    expect(loading).toBe(true);

    await vi.advanceTimersByTimeAsync(BUDGETS_MS.default);
    const error = await captured;

    expect(error.code).toBe("timeout");
    expect(error.message).toBeTruthy();
    expect(loading).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });

  it("导出/下载（requestRaw → blob）读正文时 pagehide：同样以 cancelled 收尾", async () => {
    vi.useFakeTimers();
    const pending = pendingBodyResponse();
    vi.stubGlobal("fetch", vi.fn().mockResolvedValue(pending.resp));
    const controller = new AbortController();
    const response = await requestRaw("/jobs/export", {
      budget: "export",
      signal: controller.signal,
    });
    let loading = true;
    const reading = settledError(response.blob()).finally(() => {
      loading = false;
    });

    await pending.bodyReading;
    controller.abort();
    const error = await reading;

    expect(error).toBeInstanceOf(ApiError);
    expect(error.code).toBe("cancelled");
    expect(loading).toBe(false);
    expect(vi.getTimerCount()).toBe(0);
  });
});
