// SPDX-License-Identifier: Apache-2.0
/**
 * 批次完成通知同时落 inbox（CR-25）。
 *
 * 这一条守的是"所有通道都落库"：批次（投递/采集）的终态只有前端轮询知道，
 * 所以它必须在弹通知的同时写一条 `notification`，否则窗口关掉就彻底错过。
 */
import { App as AntdApp } from "antd";
import { cleanup, render, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import TaskCompletionNotifier from "./TaskCompletionNotifier";
import type { FinishedTaskEvent } from "../../hooks/useTaskCompletionWatcher";

const api = vi.hoisted(() => ({ recordNotification: vi.fn() }));
vi.mock("../../api/notifications", () => api);

/** 抓住全局 watcher 的回调，用例里手动触发一次"批次结束"。 */
const watcher = vi.hoisted(() => ({
  callback: null as null | ((event: FinishedTaskEvent) => void),
}));
vi.mock("../../hooks/useTaskCompletionWatcher", () => ({
  useTaskCompletionWatcher: (callback: (event: FinishedTaskEvent) => void) => {
    watcher.callback = callback;
  },
}));

function detail(overrides: Record<string, unknown> = {}) {
  return {
    detail: {
      id: 12,
      kind: "apply",
      status: "completed",
      succeeded: 8,
      failed: 0,
      skipped: 2,
      message: "",
      items: [],
      ...overrides,
    },
  } as unknown as FinishedTaskEvent;
}

beforeEach(() => {
  api.recordNotification.mockResolvedValue({ id: 1 });
  watcher.callback = null;
});

afterEach(() => {
  cleanup();
  vi.clearAllMocks();
});

describe("TaskCompletionNotifier → inbox", () => {
  it("批次完成：按 dedupe_key 上报一条 background_task 通知", async () => {
    render(
      <AntdApp>
        <MemoryRouter>
          <TaskCompletionNotifier />
        </MemoryRouter>
      </AntdApp>,
    );
    expect(watcher.callback).not.toBeNull();
    watcher.callback?.(detail());

    await waitFor(() => {
      expect(api.recordNotification).toHaveBeenCalledTimes(1);
    });
    expect(api.recordNotification).toHaveBeenCalledWith(
      expect.objectContaining({
        type: "background_task",
        dedupe_key: "batch:apply:12:completed",
        deep_link: "/apply",
        severity: "info",
      }),
    );
  });

  it("批次失败：严重度升级为 warning，仍带同一个幂等键前缀", async () => {
    render(
      <AntdApp>
        <MemoryRouter>
          <TaskCompletionNotifier />
        </MemoryRouter>
      </AntdApp>,
    );
    watcher.callback?.(detail({ status: "failed", failed: 8, message: "网络中断" }));

    await waitFor(() => {
      expect(api.recordNotification).toHaveBeenCalledWith(
        expect.objectContaining({
          severity: "warning",
          dedupe_key: "batch:apply:12:failed",
          body: "网络中断",
        }),
      );
    });
  });
});
