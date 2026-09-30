import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { JobMatchBackgroundTask } from "../types";
import {
  cancelJobMatchBackgroundTask,
  getJobMatchBackgroundTasks,
  resetJobMatchBackgroundTasks,
  restoreJobMatchBackgroundTasks,
  subscribeJobMatchBackgroundTasks,
  watchJobMatchBatchTask,
} from "./jobMatchBackgroundTasks";

const apiMocks = vi.hoisted(() => ({
  cancelJobMatchBatchTask: vi.fn(),
  getJobMatchBatchTask: vi.fn(),
  listJobMatchBatchTasks: vi.fn(),
}));
const notifyTaskDone = vi.hoisted(() => vi.fn());

vi.mock("../api/jobs", () => apiMocks);
vi.mock("./taskNotify", () => ({ notifyTaskDone }));

const ACTIVE: JobMatchBackgroundTask = {
  task_id: "background-task-1",
  status: "running",
  job_ids: [1, 2, 3],
  force: false,
  requested_count: 3,
  completed_count: 1,
  failed_count: 0,
  current_job_id: 2,
  current_job_title: "后端开发",
  batch_id: null,
  message: "已处理 1/3 个岗位",
  error: "",
  created_at: "2026-09-30T08:00:00",
  started_at: "2026-09-30T08:00:01",
  finished_at: null,
};

function terminal(status: JobMatchBackgroundTask["status"]): JobMatchBackgroundTask {
  return {
    ...ACTIVE,
    status,
    completed_count: 2,
    failed_count: status === "failed" ? 1 : 0,
    current_job_id: null,
    current_job_title: "",
    batch_id: status === "completed" || status === "cancelled" ? 9 : null,
    message: status === "completed" ? "岗位适配度分析已完成" : "任务已结束",
    error: status === "failed" ? "模型分析失败" : "",
    finished_at: "2026-09-30T08:01:00",
  };
}

beforeEach(() => {
  vi.clearAllMocks();
  resetJobMatchBackgroundTasks();
  apiMocks.getJobMatchBatchTask.mockResolvedValue(ACTIVE);
  apiMocks.listJobMatchBatchTasks.mockResolvedValue([]);
});

afterEach(() => {
  resetJobMatchBackgroundTasks();
});

describe("jobMatchBackgroundTasks", () => {
  it("登记后台任务、同步进度并在完成后通知用户", async () => {
    const updates: number[] = [];
    const unsubscribe = subscribeJobMatchBackgroundTasks((tasks) => {
      updates.push(tasks.length);
    });
    apiMocks.getJobMatchBatchTask.mockResolvedValueOnce(terminal("completed"));

    watchJobMatchBatchTask(ACTIVE, "批量分析");
    await vi.waitFor(() => expect(getJobMatchBackgroundTasks()).toHaveLength(0));

    expect(updates).toContain(1);
    expect(apiMocks.getJobMatchBatchTask).toHaveBeenCalledWith(ACTIVE.task_id);
    expect(notifyTaskDone).toHaveBeenCalledWith(
      expect.objectContaining({ title: "岗位适配度分析完成" }),
    );
    unsubscribe();
  });

  it("恢复页面时读取后端仍在运行的任务", async () => {
    apiMocks.listJobMatchBatchTasks.mockResolvedValue([ACTIVE]);
    apiMocks.getJobMatchBatchTask.mockResolvedValue(ACTIVE);

    await restoreJobMatchBackgroundTasks();

    expect(getJobMatchBackgroundTasks()).toEqual([
      expect.objectContaining({
        id: ACTIVE.task_id,
        label: "分析 3 个岗位",
        requestedCount: 3,
        completedCount: 1,
      }),
    ]);
  });

  it("取消任务后清理登记并给出取消通知", async () => {
    apiMocks.cancelJobMatchBatchTask.mockResolvedValue(terminal("cancelled"));
    watchJobMatchBatchTask(ACTIVE, "批量分析");

    await cancelJobMatchBackgroundTask(ACTIVE.task_id);

    expect(apiMocks.cancelJobMatchBatchTask).toHaveBeenCalledWith(ACTIVE.task_id);
    expect(getJobMatchBackgroundTasks()).toHaveLength(0);
    expect(notifyTaskDone).toHaveBeenCalledWith(
      expect.objectContaining({ title: "岗位适配度分析已取消", kind: "warning" }),
    );
  });
});
