// SPDX-License-Identifier: Apache-2.0
/**
 * F4 §5.5：编辑器「从我的资料追加一条」的候选来自**当前组投影缓存**，失败可重试。
 */
import { cleanup, renderHook, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { projectionOf } from "../../test/profileProjectionFixture";

const apiMocks = vi.hoisted(() => ({
  getCurrentProjection: vi.fn(),
}));

vi.mock("../../features/profile-library/api", () => ({
  getCurrentProjection: apiMocks.getCurrentProjection,
}));

import { invalidateProjectionCache } from "../../features/profile-library/projectionCache";
import { useProfileFillSources } from "./useProfileFillSources";

function projection() {
  return projectionOf({
    content: {
      name: "张三",
      job_intent: "前端开发",
      summary: "资料里的个人总结",
      education: [
        {
          school: "示例大学",
          major: "软件工程",
          degree: "本科",
          start_date: "2023.09",
          end_date: "2027.06",
          gpa: "",
          courses: [],
          achievements: [],
        },
      ],
    },
  });
}

afterEach(() => {
  // 这个文件的 hook 会挂失效订阅；不卸载的话，上一用例的 hook 会连到本用例的 mock 上。
  cleanup();
});

beforeEach(() => {
  // 模块级缓存跨用例共享：每个用例换一个数据集作用域，避免"上一条用例的缓存"影响本用例
  // （切数据集在真实应用里是整页 reload，等价于清空内存缓存）。
  window.localStorage.setItem("resumeforge:active-dataset", `test-${Math.random()}`);
  apiMocks.getCurrentProjection.mockReset();
  // 先给一个默认实现再失效缓存：上一用例卸载时若还有失效通知在飞，不会拿到 undefined。
  apiMocks.getCurrentProjection.mockResolvedValue(projection());
  invalidateProjectionCache();
});

describe("useProfileFillSources", () => {
  it("wanted=false 不请求、不渲染入口；打开后由当前组投影构造候选", async () => {
    apiMocks.getCurrentProjection.mockResolvedValue(projection());
    const { result, rerender } = renderHook(
      ({ wanted }: { wanted: boolean }) => useProfileFillSources(wanted),
      { initialProps: { wanted: false } },
    );
    expect(apiMocks.getCurrentProjection).not.toHaveBeenCalled();
    expect(result.current.fillSources).toBeNull();

    rerender({ wanted: true });
    await waitFor(() => expect(result.current.fillSources).not.toBeNull());
    expect(result.current.fillSources!.education).toHaveLength(1);
    expect(result.current.fillSources!.summary).toBe("资料里的个人总结");
  });

  it("第二次打开命中共享缓存，不重复请求", async () => {
    invalidateProjectionCache();
    const first = renderHook(() => useProfileFillSources(true));
    await waitFor(() => expect(first.result.current.fillSources).not.toBeNull());
    const callsAfterFirst = apiMocks.getCurrentProjection.mock.calls.length;
    expect(callsAfterFirst).toBeGreaterThanOrEqual(1);
    first.unmount();
    const second = renderHook(() => useProfileFillSources(true));
    await waitFor(() => expect(second.result.current.fillSources).not.toBeNull());
    // 共享缓存命中：第二次打开没有新增请求。
    expect(apiMocks.getCurrentProjection.mock.calls.length).toBe(callsAfterFirst);
  });

  it("失败不永久为空：reload 后能重新取到候选（旧实现语义已反转）", async () => {
    apiMocks.getCurrentProjection.mockReset();
    apiMocks.getCurrentProjection.mockRejectedValue(new Error("网络错误"));
    const { result } = renderHook(() => useProfileFillSources(true));
    await waitFor(() => expect(result.current.error).not.toBeNull());
    expect(result.current.fillSources).toBeNull();

    apiMocks.getCurrentProjection.mockResolvedValue(projection());
    result.current.reload();
    await waitFor(() => expect(result.current.fillSources).not.toBeNull());
    expect(result.current.error).toBeNull();
  });

  it("候选自带当前组参与清单（编辑器页签过滤与候选同源）", async () => {
    apiMocks.getCurrentProjection.mockResolvedValue(projection());
    const { result } = renderHook(() => useProfileFillSources(true));
    await waitFor(() => expect(result.current.fillSources).not.toBeNull());
    // 与投影 scope.participating_keys 逐字相同：页签过滤和候选不会各读一份投影。
    expect(result.current.fillSources!.participatingKeys).toEqual([
      "basic_info",
      "educations",
      "summary",
    ]);
  });

  it("投影缓存失效（保存/切组）后自动重取", async () => {
    apiMocks.getCurrentProjection.mockResolvedValue(projection());
    const { result } = renderHook(() => useProfileFillSources(true));
    await waitFor(() => expect(result.current.fillSources).not.toBeNull());
    expect(apiMocks.getCurrentProjection).toHaveBeenCalledTimes(1);

    invalidateProjectionCache();
    await waitFor(() => expect(apiMocks.getCurrentProjection).toHaveBeenCalledTimes(2));
  });
});
