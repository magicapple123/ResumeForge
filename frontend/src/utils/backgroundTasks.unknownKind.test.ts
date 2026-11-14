// SPDX-License-Identifier: Apache-2.0
/**
 * 回归：**没有专属适配器的 AI 任务也必须能轮询、能取消**。
 *
 * 2026-11-13 用户反馈「整理助手记忆关不掉」：页头「正在进行」里那条 chip 永远停在
 * 「生成中…」，点 ✕ 弹出「已取消」但它还在。根因是前端只给六个"有界面入口"的 kind
 * 登记了适配器，而 `/ai-tasks/active` 会返回 `assistant_memory_extract`（记忆整理）与
 * `rag_index_warmup`（索引预热）——`tick()` 拿不到适配器就静默跳过，`cancelBackgroundTask()`
 * 更是静默返回，于是"取消"只是弹了一句谎话。
 *
 * 这一组钉住三件事：
 * 1. 未登记的 kind 依然会被轮询（进度会更新，不是冻结的）；
 * 2. 未登记的 kind 取消会真的打到 `/ai-tasks/{id}/cancel`，条目随后从列表消失；
 * 3. 完成/取消的通知仍然说出任务名（走 `fallbackNotices(task)`，不是空文案）。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiTaskSnapshot } from "../types";
import {
  backgroundTaskKey,
  cancelBackgroundTask,
  getBackgroundTasks,
  resetBackgroundTasks,
  watchAiTask,
} from "./backgroundTasks";
import {
  getBackgroundTaskAdapter,
  hasRegisteredBackgroundTaskAdapter,
  registeredBackgroundTaskKinds,
} from "./backgroundTasks.adapters";
import { registerNotifyHost } from "./taskNotify";

const aiMocks = vi.hoisted(() => ({
  getAiTask: vi.fn(),
  cancelAiTask: vi.fn(),
  listActiveAiTasks: vi.fn(),
}));

vi.mock("../api/aiTasks", () => ({
  getAiTask: aiMocks.getAiTask,
  cancelAiTask: aiMocks.cancelAiTask,
  listActiveAiTasks: aiMocks.listActiveAiTasks,
}));

const notices: { title: string; kind?: string }[] = [];

function makeAiTask(overrides: Partial<AiTaskSnapshot> = {}): AiTaskSnapshot {
  return {
    id: 41,
    kind: "assistant_memory_extract",
    status: "running",
    progress: 10,
    label: "整理助手记忆",
    message: "正在整理这次对话里的长期信息",
    result_ref: null,
    error: "",
    created_at: "2026-11-13T00:00:00",
    started_at: "2026-11-13T00:00:00",
    finished_at: null,
    ...overrides,
  };
}

beforeEach(() => {
  resetBackgroundTasks();
  notices.length = 0;
  aiMocks.getAiTask.mockReset();
  aiMocks.cancelAiTask.mockReset();
  aiMocks.listActiveAiTasks.mockReset();
  aiMocks.listActiveAiTasks.mockResolvedValue([]);
  registerNotifyHost({
    notification: {
      success: (config) => notices.push({ title: String(config.title) }),
      warning: (config) => notices.push({ title: String(config.title), kind: "warning" }),
      error: (config) => notices.push({ title: String(config.title), kind: "error" }),
      info: (config) => notices.push({ title: String(config.title) }),
    },
    modal: {
      info: (config) => notices.push({ title: String(config.title), kind: "modal" }),
    },
  });
  vi.useFakeTimers();
});

describe("没有专属适配器的 AI 任务", () => {
  it("记忆整理不在已登记清单里，但依然拿得到能拉能停的适配器", () => {
    // 前提：它确实不是"有界面入口"的六种之一（否则这组用例测不到兜底）。
    expect(registeredBackgroundTaskKinds()).not.toContain("assistant_memory_extract");
    expect(hasRegisteredBackgroundTaskAdapter("assistant_memory_extract")).toBe(false);

    const adapter = getBackgroundTaskAdapter("assistant_memory_extract");
    expect(adapter).not.toBeNull();
    expect(adapter.kind).toBe("assistant_memory_extract");
  });

  it("会被轮询：进度文案跟着后端走，而不是永远停在「生成中…」", async () => {
    aiMocks.getAiTask.mockResolvedValue(makeAiTask({ progress: 60, message: "已整理 3 条" }));
    watchAiTask(makeAiTask());

    // 登记时立刻拉一次；再推一轮确认轮询循环里也有它。
    await vi.advanceTimersByTimeAsync(1600);

    expect(aiMocks.getAiTask).toHaveBeenCalledWith(41);
    const [task] = getBackgroundTasks();
    expect(task.message).toBe("已整理 3 条");
    expect(task.progressPercent).toBe(60);
    expect(task.unknown).toBe(false);
  });

  it("取消会真的打到 /ai-tasks/{id}/cancel，条目随后从列表消失", async () => {
    aiMocks.getAiTask.mockResolvedValue(makeAiTask());
    aiMocks.cancelAiTask.mockResolvedValue(makeAiTask({ status: "canceled" }));
    watchAiTask(makeAiTask());
    expect(getBackgroundTasks()).toHaveLength(1);

    await cancelBackgroundTask(backgroundTaskKey("assistant_memory_extract", 41));

    expect(aiMocks.cancelAiTask).toHaveBeenCalledWith(41);
    expect(getBackgroundTasks()).toEqual([]);
    // 通知用任务自己的名字（fallbackNotices），不是空白的通用文案。
    expect(notices.some((item) => item.title.includes("整理助手记忆"))).toBe(true);
  });

  it("取消后后端仍报 running（协作式取消还没停）时，条目保留但状态如实更新", async () => {
    // 后端先把 cancel 请求接下来、执行体稍后才停：这时绝不能假装已取消并把 chip 抹掉，
    // 否则用户会以为任务没了，实际上模型还在跑。
    aiMocks.getAiTask.mockResolvedValue(makeAiTask({ progress: 40 }));
    aiMocks.cancelAiTask.mockResolvedValue(
      makeAiTask({ status: "running", progress: 40, message: "正在停止" }),
    );
    watchAiTask(makeAiTask());

    await cancelBackgroundTask(backgroundTaskKey("assistant_memory_extract", 41));

    const [task] = getBackgroundTasks();
    expect(task.status).toBe("running");
    expect(task.message).toBe("正在停止");
  });
});
