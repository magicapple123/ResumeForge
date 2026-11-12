// SPDX-License-Identifier: Apache-2.0
/**
 * 画布页数的取数端：**「不限篇幅」时必须把 0 发出去**（缺陷 B）。
 *
 * 旧实现一律 `Math.max(1, Math.round(pageLimit))`：用户选「不限」时报告按 1 页排，
 * 于是画布上只有 1 页、`pages_needed` 也是 1——屏幕上"实际 1 页"、导出却是完整多页。
 * 这里走真实链路（模块级 `api/client` 被 mock），断言**请求体里的 `page_limit`**，
 * 而不是断言某个内部函数：请求形状才是后端收到的东西。
 */
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const clientMocks = vi.hoisted(() => ({ request: vi.fn() }));
vi.mock("../../../api/client", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../../../api/client")>()),
  request: clientMocks.request,
}));

import { useReportedPageCount } from "./useReportedPageCount";
import type { ExactPreviewOptions } from "./exactPreviewOptions";

/** 报告响应（后端形状）：`page_limit` 永远是渲染保护上限，语义在布尔里。 */
function reportBody(pageLimit: number, unlimited: boolean, pages: number) {
  return {
    pages,
    pages_needed: pages,
    overflow: false,
    page_limit: pageLimit,
    page_limit_is_unlimited: unlimited,
    last_page_fill: null,
    truncated_at: null,
    manual_breaks: [],
    warnings: [],
    snapshot: { content_sha256: "c".repeat(64), render_config_sha256: "r".repeat(64) },
  };
}

/**
 * 每份用例用**不同** `resumeId`：`useReportedPageCount` 的页数缓存是模块级的
 * （同一屏两个画布共用），同 id + 同版式会直接命中缓存、一个请求都不发。
 */
function exactPreview(resumeId: number): ExactPreviewOptions {
  return {
    resumeId,
    template: "classic",
    formatName: "",
    fontScale: "standard",
    language: "zh-CN",
    formatConfig: {},
    contentSignature: `sig-${resumeId}`,
  };
}

function sentBody(call = 0): Record<string, unknown> {
  const options = clientMocks.request.mock.calls[call]?.[1] as { body?: string } | undefined;
  return JSON.parse(options?.body ?? "{}") as Record<string, unknown>;
}

beforeEach(() => {
  clientMocks.request.mockReset();
  vi.useFakeTimers();
});

afterEach(() => {
  vi.useRealTimers();
});

describe("useReportedPageCount 的请求体", () => {
  it("pageLimit=0（不限）原样发 0，不夹成 1 页", async () => {
    clientMocks.request.mockResolvedValue(reportBody(10, true, 3));
    const { result } = renderHook(() =>
      useReportedPageCount({ exactPreview: exactPreview(101), pageLimit: 0 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(clientMocks.request).toHaveBeenCalledTimes(1);
    expect(clientMocks.request.mock.calls[0]?.[0]).toBe("/resumes/101/pagination/report");
    expect(sentBody().page_limit).toBe(0);
    // 页数照旧用服务端给的（3），不是"上限 10"也不是被夹出来的 1。
    expect(result.current).toBe(3);
  });

  it("有上限时照旧发正数上限（不受「不限」改动影响）", async () => {
    clientMocks.request.mockResolvedValue(reportBody(2, false, 2));
    const { result } = renderHook(() =>
      useReportedPageCount({ exactPreview: exactPreview(102), pageLimit: 2 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(sentBody().page_limit).toBe(2);
    expect(result.current).toBe(2);
  });

  it("拿不到报告时返回 null（画布退回浏览器测量，不编页数）", async () => {
    clientMocks.request.mockRejectedValue(new Error("boom"));
    const { result } = renderHook(() =>
      useReportedPageCount({ exactPreview: exactPreview(103), pageLimit: 0 }),
    );

    await act(async () => {
      await vi.advanceTimersByTimeAsync(700);
    });

    expect(result.current).toBeNull();
  });
});
