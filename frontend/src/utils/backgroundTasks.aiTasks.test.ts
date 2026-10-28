// SPDX-License-Identifier: Apache-2.0
/**
 * 通用 AI 任务（`/ai-tasks`）也进**同一张**登记表。
 *
 * 这一组用例是"只留一套前端任务登记"的验收：新入口不需要第五套 store、第二种指示器，
 * 也不需要页面自己轮询——登记表统一负责状态、取消与完成提醒。
 *
 * 与 `backgroundTasks.test.ts`（简历生成）分开成两个文件：两者各有一套端点替身，
 * 单文件也会因为用例数增长顶到 500 行预算。
 */
import { beforeEach, describe, expect, it, vi } from "vitest";
import type { AiTaskSnapshot } from "../types";
import {
  backgroundTaskKey,
  cancelBackgroundTask,
  getBackgroundTasks,
  resetBackgroundTasks,
  restoreBackgroundTasks,
  watchAiTask,
  watchResumeTask,
} from "./backgroundTasks";
import { registerNotifyHost } from "./taskNotify";

const resumeMocks = vi.hoisted(() => ({
  getResumeGenerateTask: vi.fn(),
  cancelResumeGenerateTask: vi.fn(),
}));

vi.mock("../api/resumes", () => ({
  getResumeGenerateTask: resumeMocks.getResumeGenerateTask,
  cancelResumeGenerateTask: resumeMocks.cancelResumeGenerateTask,
}));

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

/** 假宿主记录到的提醒（与 backgroundTasks.test.ts 同形状）。 */
const notices: { title: string; modal?: boolean; kind?: string; hasContent?: boolean }[] = [];

function makeTask(overrides: Record<string, unknown> = {}) {
  return {
    id: 7,
    status: "running" as const,
    resume_id: null,
    error: "",
    message: "writing paragraph 1",
    received_chars: 120,
    job_id: null,
    title: "",
    created_at: "2026-10-28T00:00:00",
    started_at: "2026-10-28T00:00:00",
    finished_at: null,
    ...overrides,
  };
}

/** 推进若干轮轮询（登记时会立刻拉一次，多推几轮避开时序抖动）。 */
async function runOneTick(rounds = 3): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await vi.advanceTimersByTimeAsync(1600);
  }
}

beforeEach(() => {
  resetBackgroundTasks();
  notices.length = 0;
  resumeMocks.getResumeGenerateTask.mockReset();
  resumeMocks.cancelResumeGenerateTask.mockReset();
  aiMocks.getAiTask.mockReset();
  aiMocks.cancelAiTask.mockReset();
  aiMocks.listActiveAiTasks.mockReset();
  // 默认"后端没有在跑的通用任务"：恢复流程不该把别的用例的任务接进来。
  aiMocks.listActiveAiTasks.mockResolvedValue([]);
  registerNotifyHost({
    notification: {
      success: (config) => notices.push({ title: String(config.title), modal: false }),
      warning: (config) =>
        notices.push({ title: String(config.title), modal: false, kind: "warning" }),
      error: (config) => notices.push({ title: String(config.title), modal: false, kind: "error" }),
      info: (config) => notices.push({ title: String(config.title), modal: false }),
    },
    modal: {
      info: (config) =>
        notices.push({
          title: String(config.title),
          modal: true,
          kind: "modal",
          hasContent: config.content !== undefined,
        }),
    },
  });
  vi.useFakeTimers();
});

/**
 * 通用 AI 任务（`/ai-tasks`）也进同一张登记表。
 *
 * 这一组用例是本轮"只留一套登记表"的验收：新任务不需要新的 store、新的指示器，
 * 也不需要页面自己轮询——登记表统一负责状态、取消与完成提醒。
 */
function makeAiTask(overrides: Partial<AiTaskSnapshot> = {}): AiTaskSnapshot {
  return {
    id: 5,
    kind: "job_match",
    status: "running",
    progress: 30,
    label: "适配「后端开发」",
    message: "正在调用模型分析匹配度",
    result_ref: null,
    error: "",
    created_at: "2026-10-28T00:00:00",
    started_at: "2026-10-28T00:00:00",
    finished_at: null,
    ...overrides,
  };
}

describe("通用 AI 任务（/ai-tasks）", () => {
  it("登记后出现在同一份列表里，并带上可信百分比", async () => {
    aiMocks.getAiTask.mockResolvedValue(makeAiTask());
    watchAiTask(makeAiTask(), "适配「后端开发」");

    const [task] = getBackgroundTasks();
    expect(task).toMatchObject({
      kind: "job_match",
      id: 5,
      progressPercent: 30,
      status: "running",
    });

    await runOneTick(1);
    expect(aiMocks.getAiTask).toHaveBeenCalledWith(5);
  });

  it("两种任务 id 相同也不会互相覆盖（内部主键带 kind）", async () => {
    resumeMocks.getResumeGenerateTask.mockResolvedValue(makeTask({ id: 7 }));
    aiMocks.getAiTask.mockResolvedValue(makeAiTask({ id: 7 }));

    watchResumeTask(makeTask({ id: 7 }), "生成通用简历");
    watchAiTask(makeAiTask({ id: 7 }), "适配「后端开发」");

    const keys = getBackgroundTasks().map((task) => task.key);
    expect(keys).toEqual(["resume_generate#7", "job_match#7"]);
  });

  it("完成后用统一出口提醒，并带上「查看岗位」深链", async () => {
    aiMocks.getAiTask.mockResolvedValue(
      makeAiTask({ status: "succeeded", progress: 100, result_ref: { job_id: 12 } }),
    );
    watchAiTask(makeAiTask(), "适配「后端开发」");

    await runOneTick();

    // 没有界面在看 → 居中弹窗；深链被消费成正文里那颗「查看岗位」按钮。
    const notice = notices.find((item) => item.title === "岗位适配度分析完成");
    expect(notice?.modal).toBe(true);
    expect(notice?.hasContent).toBe(true);
    expect(getBackgroundTasks()).toEqual([]);
  });

  it("失败时把后端给的原因原样提醒（只写原因）", async () => {
    aiMocks.getAiTask.mockResolvedValue(
      makeAiTask({ status: "failed", error: "个人资料为空，无法做匹配分析" }),
    );
    watchAiTask(makeAiTask(), "适配「后端开发」");

    await runOneTick();

    expect(
      notices.some(
        (item) =>
          item.title === "岗位适配度分析失败" && item.kind === "error" && item.title.length > 0,
      ),
    ).toBe(true);
  });

  it("取消走 /ai-tasks 的 cancel，任务从列表消失并提示已取消", async () => {
    aiMocks.getAiTask.mockResolvedValue(makeAiTask());
    aiMocks.cancelAiTask.mockResolvedValue(makeAiTask({ status: "canceled" }));
    watchAiTask(makeAiTask(), "适配「后端开发」");

    await cancelBackgroundTask(backgroundTaskKey("job_match", 5));

    expect(aiMocks.cancelAiTask).toHaveBeenCalledWith(5);
    expect(notices.some((item) => item.title === "岗位适配度分析已取消")).toBe(true);
    expect(getBackgroundTasks()).toEqual([]);
  });

  it("刷新后从 /ai-tasks/active 兜底恢复（localStorage 被清也不丢任务）", async () => {
    aiMocks.listActiveAiTasks.mockResolvedValue([makeAiTask({ id: 21 })]);

    await restoreBackgroundTasks();

    // 恢复时登记表会立刻拉一次进度，这里给同一个快照即可。
    aiMocks.getAiTask.mockResolvedValue(makeAiTask({ id: 21 }));
    expect(getBackgroundTasks().map((task) => task.key)).toEqual(["job_match#21"]);
  });
});
