// SPDX-License-Identifier: Apache-2.0
/**
 * 首页「任务」卡取数 hook（T02/T04）：enabled gate 与 5s 轮询。
 *
 * 守卫点：总开关关闭时**一次都不请求**（首页不轮询空列表）；开启后立即拉一次、之后每
 * 5s 拉一次；页面隐藏（document.hidden）时跳过本轮。
 */
import { App as AntdApp } from "antd";
import { act, renderHook } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { HIDDEN_AI_POLL_MS } from "../../../utils/visibility";
import { AGENT_TASK_POLL_MS, useAgentTasks } from "./useAgentTasks";

const taskApiMocks = vi.hoisted(() => ({
  listAgentTasks: vi.fn(),
  startAgentTask: vi.fn(),
  resumeAgentTask: vi.fn(),
  pauseAgentTask: vi.fn(),
  cancelAgentTask: vi.fn(),
}));

vi.mock("../../../api/agentTasks", () => taskApiMocks);

const wrapper = ({ children }: { children: React.ReactNode }) => <AntdApp>{children}</AntdApp>;

/** jsdom 没有改 visibilityState 的入口，直接覆写属性模拟；用例结束还原为可见。 */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
  document.dispatchEvent(new Event("visibilitychange"));
}

beforeEach(() => {
  taskApiMocks.listAgentTasks.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  setHidden(false);
  vi.useRealTimers();
});

describe("useAgentTasks", () => {
  it("enabled=false：不请求、不轮询", async () => {
    vi.useFakeTimers();
    renderHook(() => useAgentTasks({ enabled: false }), { wrapper });

    await act(async () => {
      vi.advanceTimersByTime(AGENT_TASK_POLL_MS * 3);
      await Promise.resolve();
    });
    expect(taskApiMocks.listAgentTasks).not.toHaveBeenCalled();
  });

  it("enabled=true：立即拉一次，之后每 5s 轮询一次", async () => {
    vi.useFakeTimers();
    renderHook(() => useAgentTasks({ enabled: true }), { wrapper });

    await act(async () => {
      await Promise.resolve();
    });
    expect(taskApiMocks.listAgentTasks).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(AGENT_TASK_POLL_MS);
      await Promise.resolve();
    });
    expect(taskApiMocks.listAgentTasks).toHaveBeenCalledTimes(2);
    await act(async () => {
      vi.advanceTimersByTime(AGENT_TASK_POLL_MS);
      await Promise.resolve();
    });
    expect(taskApiMocks.listAgentTasks).toHaveBeenCalledTimes(3);
  });

  it("窗口隐藏时仍轮询：降频到 10s，恢复可见立即补一轮（CR-23）", async () => {
    vi.useFakeTimers();
    renderHook(() => useAgentTasks({ enabled: true }), { wrapper });
    await act(async () => {
      await Promise.resolve();
    });
    expect(taskApiMocks.listAgentTasks).toHaveBeenCalledTimes(1);

    // 切后台：5s 的节拍立即换成 10s。
    setHidden(true);
    await act(async () => {
      vi.advanceTimersByTime(HIDDEN_AI_POLL_MS - 1);
      await Promise.resolve();
    });
    expect(taskApiMocks.listAgentTasks).toHaveBeenCalledTimes(1);
    await act(async () => {
      vi.advanceTimersByTime(1);
      await Promise.resolve();
    });
    expect(taskApiMocks.listAgentTasks).toHaveBeenCalledTimes(2);

    // 恢复可见：立即补一轮，不必再等 10s。
    setHidden(false);
    await act(async () => {
      await Promise.resolve();
    });
    expect(taskApiMocks.listAgentTasks).toHaveBeenCalledTimes(3);
  });
});
