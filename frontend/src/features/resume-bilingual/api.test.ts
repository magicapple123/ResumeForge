// SPDX-License-Identifier: Apache-2.0
/**
 * 翻译候选的请求预算：默认 15s 曾让「生成翻译候选」必然超时（用户报告的
 * 「请求超时，请重试」）。这里钉住 translateVariant 用的是长预算档，而不是 default。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { ApiError, BUDGETS_MS } from "../../api/client";
import { translateVariant } from "./api";

afterEach(() => {
  vi.unstubAllGlobals();
  vi.useRealTimers();
});

/** fetch 永远挂起，只在被 abort 时拒绝——模拟"后端翻译很慢"的真实场景。 */
function slowFetch() {
  return vi.fn(
    (_path: string, init?: RequestInit) =>
      new Promise<Response>((_resolve, reject) => {
        init?.signal?.addEventListener("abort", () => reject(new Error("aborted")));
      }),
  );
}

describe("translateVariant 请求预算", () => {
  it("translate 档是长预算，与默认 15s 明显拉开", () => {
    expect(BUDGETS_MS.translate).toBe(180_000);
    expect(BUDGETS_MS.translate).toBeGreaterThan(BUDGETS_MS.default);
  });

  it("超过默认 15s 仍不放弃，只有到了 translate 档预算才超时", async () => {
    vi.useFakeTimers();
    vi.stubGlobal("fetch", slowFetch());
    let settled = false;
    const pending = translateVariant(7, 3, { target_language: "en-US" });
    void pending.then(
      () => {
        settled = true;
      },
      () => {
        settled = true;
      },
    );

    // 旧实现走 default：15s 就会以 timeout 失败（用户看到「请求超时，请重试」）。
    await vi.advanceTimersByTimeAsync(BUDGETS_MS.default + 1_000);
    expect(settled).toBe(false);

    // 走到 translate 档预算才收尾：这时超时是真实的长耗时，不再是一开始就误判。
    await vi.advanceTimersByTimeAsync(BUDGETS_MS.translate - BUDGETS_MS.default - 1_000 + 1);
    await expect(pending).rejects.toBeInstanceOf(ApiError);
    await expect(pending).rejects.toMatchObject({ code: "timeout" });
  });
});
