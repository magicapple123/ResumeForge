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

beforeEach(() => {
  taskApiMocks.listAgentTasks.mockReset().mockResolvedValue([]);
});

afterEach(() => {
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
});
