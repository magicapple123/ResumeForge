// SPDX-License-Identifier: Apache-2.0
/**
 * `useTrackerTrackFocus` 的直接守卫（整改 #18 的真 bug 回归）。
 *
 * ## 这条用例为什么要单独写
 *
 * 实机（dev + `<StrictMode>`）表现：`/tracker?track=15` 打开后什么都不发生——不回写
 * `job_id`、不高亮、也没有"找不到"的提示，而接口本身是好的。根因是 effect 里那次
 * "已经解析过就早退"的占位被放错了位置：
 *
 * 1. effect 第一次运行：占位 + 发请求；
 * 2. `<StrictMode>` 立刻 cleanup（`cancelled = true`）再跑一次 effect；
 * 3. 第二次看到占位 → **直接早退，不再发请求**；第一次的响应回来时被 `cancelled` 丢掉。
 *
 * 于是 `setTarget` 永远不执行。修复是把占位挪到"请求成功之后"。
 *
 * ## 为什么不用 `<StrictMode>` 包裹来测
 *
 * 本仓库的 vitest 环境**不会**双调用 effect（实测：`render(<StrictMode>…)` 下 effect
 * 只跑 1 次，react-dom 在此走的是非 dev 构建）。用 StrictMode 包一层写出来的用例
 * 修复前后都是绿的，等于没测。所以这里用**同样的失效形态**来复现：
 * 依赖换一次（`onMissing` 变成新函数）→ cleanup 取消在飞的请求 → effect 再跑一次。
 * 旧实现在这一步会早退，新实现会重新取。
 */
import { App as AntdApp } from "antd";
import { renderHook, waitFor } from "@testing-library/react";
import type { ReactNode } from "react";
import { describe, expect, it, vi } from "vitest";
import { useTrackerTrackFocus } from "./useTrackerTrackFocus";

const apiMocks = vi.hoisted(() => ({ getTrack: vi.fn() }));
vi.mock("../../api/tracker", () => apiMocks);

const TRACK = { id: 142, job_id: 77 };

function wrapper({ children }: { children: ReactNode }) {
  // `useTrackerTrackFocus` 走 `useToast()`，它在 `App.useApp()` 之下，必须有 provider。
  return <AntdApp>{children}</AntdApp>;
}

describe("useTrackerTrackFocus（#18）", () => {
  it("effect 被取消一次之后必须重新取：否则 ?track= 整条链路静默失效", async () => {
    apiMocks.getTrack.mockReset().mockResolvedValue(TRACK);
    const onFilterJob = vi.fn();

    const { result, rerender } = renderHook(
      ({ onMissing }: { onMissing: () => void }) =>
        useTrackerTrackFocus({
          trackId: TRACK.id,
          loadedIds: [TRACK.id],
          onFilterJob,
          onMissing,
        }),
      // 两个**不同**的回调实例：依赖变化 = 一次 cleanup + 一次重跑，与 StrictMode
      // 的"运行 → 清理 → 再运行"同形。
      { wrapper, initialProps: { onMissing: () => {} } },
    );

    rerender({ onMissing: () => {} });

    await waitFor(() => expect(result.current).toBe(TRACK.id));
    // 关键：被取消的那次之后还发了一次（旧实现这里会一直是 1 次，且永远不高亮）。
    expect(apiMocks.getTrack.mock.calls.length).toBeGreaterThanOrEqual(2);
    // 顺手钉住"收窄筛选"这一步也没丢。
    expect(onFilterJob).toHaveBeenCalledWith(TRACK.job_id);
  });

  it("成功解析之后不再重复请求（占位改到成功之后，但不能退化成每次都取）", async () => {
    apiMocks.getTrack.mockReset().mockResolvedValue(TRACK);
    const onMissing = () => {};

    const { result, rerender } = renderHook(
      () =>
        useTrackerTrackFocus({
          trackId: TRACK.id,
          loadedIds: [TRACK.id],
          onFilterJob: vi.fn(),
          onMissing,
        }),
      { wrapper },
    );

    await waitFor(() => expect(result.current).toBe(TRACK.id));
    const callsAfterResolve = apiMocks.getTrack.mock.calls.length;

    // 同一条深链引起的重渲染（父级刷新）不该再打一次接口。
    rerender();
    await waitFor(() => expect(result.current).toBe(TRACK.id));
    expect(apiMocks.getTrack.mock.calls.length).toBe(callsAfterResolve);
  });
});
