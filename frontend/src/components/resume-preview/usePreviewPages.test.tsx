// SPDX-License-Identifier: Apache-2.0
/**
 * `usePreviewPages` 的请求节流语义（#23 X2）：**首开不排队，改参数才进 500ms 合并窗口**。
 *
 * 为什么单独测这个 hook 而不是只在面板上间接验：面板用例用的是**真实定时器 + 固定等待**
 * （`waitForRequest` 等 620ms），它能证明"最终发出了请求"，但证明不了"首开没有白等半秒"
 * ——两者都能把 620ms 熬过去。而 #23 里 500ms 这个数一旦被无差别地用在首屏，用户点开
 * 精确视图就会凭空多等半秒，且**任何面板级断言都不会变红**。所以这里用假定时器把
 * "什么时候**没**发请求"钉死。
 *
 * 两条契约：
 *
 * 1. **首开 delay = 0**：手上还没有任何一版时，合并窗口没有可合并的对象。
 * 2. **改参数 delay = 500ms**：窗口内一个请求都不许发；到点只发一次（连拖多次也只发一次）。
 */
import { act, cleanup, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { clearPreviewCache } from "./exactPreviewCache";
import { usePreviewPages, type PreviewPagesParams } from "./usePreviewPages";

const fetchPages = vi.hoisted(() => vi.fn());

vi.mock("./previewPagesApi", () => ({ fetchResumePreviewPages: fetchPages }));

/** 一版"已经拿到"的清单：内容不重要，只要结构对得上。 */
const META = {
  token: "token-1",
  pages: [{ index: 0, width: 1440, height: 2037 }],
  pagesNeeded: 1,
  overflow: false,
};

function params(overrides: Partial<PreviewPagesParams> = {}): PreviewPagesParams {
  return {
    active: true,
    resumeId: 1,
    template: "classic",
    formatName: "standard",
    pageLimit: 2,
    fontScale: "1.0",
    language: "zh-CN",
    formatConfig: {},
    contentSignature: "sig-1",
    width: 912,
    dpr: 1,
    ...overrides,
  };
}

/** 推进假定时器并把中间的微任务（fetch 的 `.then`）一起冲干净。 */
async function advance(ms: number): Promise<void> {
  await act(async () => {
    await vi.advanceTimersByTimeAsync(ms);
  });
}

beforeEach(() => {
  vi.useFakeTimers();
  fetchPages.mockReset();
  fetchPages.mockResolvedValue(META);
  // 缓存是模块级的：不清干净的话，第二例会命中上一例写进去的那一版
  // （`readCachedPreview` 命中就**根本不发请求**，断言会变成"一次都没发"）。
  clearPreviewCache();
});

afterEach(() => {
  cleanup();
  vi.useRealTimers();
});

describe("usePreviewPages 的节流窗口（#23 X2）", () => {
  it("首开不排队：不等 500ms 就发请求，且 loading 收得回来", async () => {
    const { result } = renderHook(() => usePreviewPages(params()));

    // 只推进 0ms：合并窗口如果是 500ms，这里必须**一次都没发**。
    await advance(0);
    expect(fetchPages).toHaveBeenCalledTimes(1);
    expect(result.current.loading).toBe(false);
    expect(result.current.error).toBeNull();
  });

  it("改参数要跨过 500ms 合并窗口：499ms 不发，第 500ms 发且只发一次", async () => {
    const { rerender } = renderHook((props: PreviewPagesParams) => usePreviewPages(props), {
      initialProps: params(),
    });
    await advance(0);
    expect(fetchPages).toHaveBeenCalledTimes(1);

    // 松手 = 上游（`onChangeComplete`）只提交一次新值。
    await act(async () => {
      rerender(params({ fontScale: "1.2" }));
    });

    await advance(499);
    // 还在窗口里：这是"拖停才发"的核心断言，改成 150ms 或 0 都会让这条变红。
    expect(fetchPages).toHaveBeenCalledTimes(1);

    await advance(1);
    expect(fetchPages).toHaveBeenCalledTimes(2);
  });

  it("连改三次只发一次请求：拖动过程的中间态全部被合并", async () => {
    const { rerender } = renderHook((props: PreviewPagesParams) => usePreviewPages(props), {
      initialProps: params(),
    });
    await advance(0);
    expect(fetchPages).toHaveBeenCalledTimes(1);

    // 每 100ms 松一次手（现实里连续改字号 / 行距 / 页边距就是这种节奏）。
    for (const fontScale of ["1.2", "1.3", "1.4"]) {
      await act(async () => {
        rerender(params({ fontScale }));
      });
      await advance(100);
      expect(fetchPages).toHaveBeenCalledTimes(1);
    }

    // 最后一档落定后再等满窗口：整个过程只多出 1 次请求。
    await advance(500);
    expect(fetchPages).toHaveBeenCalledTimes(2);
  });
});
