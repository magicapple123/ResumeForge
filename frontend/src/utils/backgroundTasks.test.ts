/**
 * 后台任务登记表：关掉等待窗口之后，任务仍然被追踪。
 *
 * 这一层是"完成提醒"能兑现的前提——它以前挂在生成弹窗里，弹窗一关轮询就停了。
 */

import { beforeEach, describe, expect, it, vi } from "vitest";
import { ApiError } from "../api/client";
import type { ResumeGenerateTask } from "../types";
import {
  attachTaskUi,
  cancelBackgroundTask,
  dismissBackgroundTask,
  getBackgroundTasks,
  resetBackgroundTasks,
  restoreBackgroundTasks,
  subscribeBackgroundTasks,
  watchResumeTask,
} from "./backgroundTasks";
import { registerNotifyHost } from "./taskNotify";

/** 与 backgroundTasks.ts 内部约定一致：跨刷新持久化的键。 */
const STORAGE_KEY = "rf.backgroundTasks.v1";

const apiMocks = vi.hoisted(() => ({
  getResumeGenerateTask: vi.fn(),
  cancelResumeGenerateTask: vi.fn(),
}));

vi.mock("../api/resumes", () => ({
  getResumeGenerateTask: apiMocks.getResumeGenerateTask,
  cancelResumeGenerateTask: apiMocks.cancelResumeGenerateTask,
}));

const notices: { title: string; modal?: boolean; kind?: string }[] = [];

function makeTask(overrides: Partial<ResumeGenerateTask> = {}): ResumeGenerateTask {
  return {
    id: 7,
    status: "running",
    resume_id: null,
    error: "",
    message: "正在写第 1 段",
    received_chars: 120,
    job_id: null,
    title: "",
    created_at: "2026-09-25T00:00:00",
    started_at: "2026-09-25T00:00:00",
    finished_at: null,
    ...overrides,
  };
}

/**
 * 推进若干轮轮询。
 *
 * 多推几轮而不是精确一轮：登记表在登记时会立刻拉一次，那一次是异步的，完成时机与
 * 定时器推进的先后没有保证（单独跑稳定，整个测试套件并行时会偶发差一拍）。
 */
async function runOneTick(rounds = 3): Promise<void> {
  for (let index = 0; index < rounds; index += 1) {
    await vi.advanceTimersByTimeAsync(1600);
  }
}

beforeEach(() => {
  resetBackgroundTasks();
  notices.length = 0;
  apiMocks.getResumeGenerateTask.mockReset();
  apiMocks.cancelResumeGenerateTask.mockReset();
  registerNotifyHost({
    notification: {
      // antd 6 起通知卡片的标题参数由 message 改名 title（见 utils/taskNotify.ts），
      // 假宿主按新形状记录。
      success: (config) => notices.push({ title: String(config.title), modal: false }),
      warning: (config) =>
        notices.push({ title: String(config.title), modal: false, kind: "warning" }),
      error: (config) => notices.push({ title: String(config.title), modal: false, kind: "error" }),
      info: (config) => notices.push({ title: String(config.title), modal: false }),
    },
    modal: {
      // AntD 的 modal 认 title / content（不是 message）——曾经就因为传了 message，
      // 弹窗标题与正文全空。假宿主按真实形状记录，测试才能钉住这一点。
      info: (config) => notices.push({ title: String(config.title), modal: true, kind: "modal" }),
    },
  });
  vi.useFakeTimers();
});

describe("后台任务登记表", () => {
  it("登记后能被订阅到，并带上进度", async () => {
    const seen: number[] = [];
    const unsubscribe = subscribeBackgroundTasks((tasks) => seen.push(tasks.length));

    watchResumeTask(makeTask(), "生成通用简历");
    expect(getBackgroundTasks()).toEqual([
      expect.objectContaining({ id: 7, label: "生成通用简历", message: "正在写第 1 段" }),
    ]);
    expect(seen.length).toBeGreaterThan(0);
    unsubscribe();
  });

  it("完成时用统一出口提醒并自动从列表消失", async () => {
    apiMocks.getResumeGenerateTask.mockResolvedValue(
      makeTask({ status: "completed", resume_id: 42 }),
    );
    watchResumeTask(makeTask(), "生成通用简历");

    await runOneTick();

    expect(notices.some((item) => item.title === "简历已生成")).toBe(true);
    expect(getBackgroundTasks()).toEqual([]);
  });

  it("用户已经离开（界面没在看）时用居中弹窗；还在看时只用卡片", async () => {
    apiMocks.getResumeGenerateTask.mockResolvedValue(
      makeTask({ status: "completed", resume_id: 1 }),
    );
    watchResumeTask(makeTask(), "生成通用简历");
    const detach = attachTaskUi(7);

    await runOneTick();
    expect(notices.find((item) => item.title === "简历已生成")?.modal).toBe(false);

    // 第二次：没人 attach
    resetBackgroundTasks();
    notices.length = 0;
    apiMocks.getResumeGenerateTask.mockResolvedValue(
      makeTask({ status: "completed", resume_id: 1 }),
    );
    watchResumeTask(makeTask({ id: 8 }), "生成通用简历");
    await runOneTick();
    expect(notices.find((item) => item.title === "简历已生成")?.modal).toBe(true);

    detach();
  });

  it("失败也提醒（失败比成功更需要知道）", async () => {
    apiMocks.getResumeGenerateTask.mockResolvedValue(
      makeTask({ status: "failed", error: "模型返回为空" }),
    );
    watchResumeTask(makeTask(), "生成通用简历");

    await runOneTick();

    expect(notices.some((item) => item.title === "简历生成失败")).toBe(true);
  });

  it("轮询失败不会假报完成（等下一轮自愈）", async () => {
    apiMocks.getResumeGenerateTask.mockRejectedValue(new Error("后端暂时不可用"));
    watchResumeTask(makeTask(), "生成通用简历");

    await runOneTick();

    expect(notices).toEqual([]);
    expect(getBackgroundTasks().length).toBe(1);
  });

  it("连续轮询失败达到 3 次后标记「状态未知」，并可手动移除", async () => {
    // 后端重启 / 长时间不可用时，任务永远等不到终态；不能让页头永久转圈。
    apiMocks.getResumeGenerateTask.mockRejectedValue(new Error("后端暂时不可用"));
    watchResumeTask(makeTask(), "生成通用简历");

    await runOneTick();

    const [task] = getBackgroundTasks();
    expect(task?.unknown).toBe(true);
    // 结果真的不知道：不触发成功/失败提醒。
    expect(notices).toEqual([]);

    // 「状态未知」条目给「移除」：把条目清掉，不再轮询。
    dismissBackgroundTask(task.id);
    expect(getBackgroundTasks()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("后端明确返回 404 时一轮就标记「状态未知」", async () => {
    apiMocks.getResumeGenerateTask.mockRejectedValue(new ApiError("任务不存在", 404));
    watchResumeTask(makeTask(), "生成通用简历");

    await runOneTick();

    expect(getBackgroundTasks()[0]?.unknown).toBe(true);
    expect(notices).toEqual([]);
  });

  it("失败几轮后恢复成功会回到正常显示", async () => {
    apiMocks.getResumeGenerateTask
      .mockRejectedValueOnce(new Error("后端暂时不可用"))
      .mockRejectedValueOnce(new Error("后端暂时不可用"))
      .mockResolvedValue(makeTask({ status: "running", message: "正在写第 2 段" }));
    watchResumeTask(makeTask(), "生成通用简历");

    await runOneTick(2);

    const task = getBackgroundTasks()[0];
    expect(task?.unknown).toBe(false);
    expect(task?.message).toBe("正在写第 2 段");
  });

  it("取消时后端 404 → 移除条目并提示「任务记录已不存在」", async () => {
    apiMocks.getResumeGenerateTask.mockRejectedValue(new Error("后端暂时不可用"));
    watchResumeTask(makeTask(), "生成通用简历");
    apiMocks.cancelResumeGenerateTask.mockRejectedValue(new ApiError("任务不存在", 404));

    // 抛出的中文信息会被调用方的错误提示原样展示。
    await expect(cancelBackgroundTask(7)).rejects.toThrow("任务记录已不存在");

    // 条目同时被移除：取消按钮不再对一条已经不存在的任务反复 404。
    expect(getBackgroundTasks()).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("取消会把任务置为取消态并通知", async () => {
    apiMocks.cancelResumeGenerateTask.mockResolvedValue(makeTask({ status: "cancelled" }));
    watchResumeTask(makeTask(), "生成通用简历");

    await cancelBackgroundTask(7);

    expect(apiMocks.cancelResumeGenerateTask).toHaveBeenCalledWith(7);
    expect(notices.some((item) => item.title === "简历生成已取消")).toBe(true);
    expect(getBackgroundTasks()).toEqual([]);
  });
});

describe("后台任务跨刷新恢复", () => {
  it("登记任务时把元数据写进 localStorage，到终态时清掉", async () => {
    apiMocks.getResumeGenerateTask.mockResolvedValue(makeTask({ status: "running" }));
    watchResumeTask(makeTask(), "生成通用简历");

    const stored: unknown = JSON.parse(window.localStorage.getItem(STORAGE_KEY) ?? "[]");
    expect(stored).toEqual([expect.objectContaining({ taskId: 7, label: "生成通用简历" })]);

    apiMocks.getResumeGenerateTask.mockResolvedValue(
      makeTask({ status: "completed", resume_id: 42 }),
    );
    await runOneTick();

    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("刷新后恢复：已完成的任务补发完成提醒并清掉条目", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ taskId: 9, label: "生成通用简历", registeredAt: "2026-10-05T00:00:00" }]),
    );
    apiMocks.getResumeGenerateTask.mockResolvedValue(
      makeTask({ id: 9, status: "completed", resume_id: 42 }),
    );

    await restoreBackgroundTasks();

    expect(notices.some((item) => item.title === "简历已生成")).toBe(true);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("刷新后恢复：仍在运行的任务重新拉起轮询，完成时照常提醒", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ taskId: 11, label: "生成通用简历", registeredAt: "2026-10-05T00:00:00" }]),
    );
    apiMocks.getResumeGenerateTask.mockResolvedValue(makeTask({ id: 11, status: "running" }));

    await restoreBackgroundTasks();

    expect(getBackgroundTasks().map((task) => task.id)).toContain(11);

    apiMocks.getResumeGenerateTask.mockResolvedValue(
      makeTask({ id: 11, status: "completed", resume_id: 1 }),
    );
    await runOneTick();
    expect(notices.some((item) => item.title === "简历已生成")).toBe(true);
  });

  it("刷新后恢复：任务查不到（记录已清理/后端重启）时静默清掉条目", async () => {
    window.localStorage.setItem(
      STORAGE_KEY,
      JSON.stringify([{ taskId: 12, label: "生成通用简历", registeredAt: "2026-10-05T00:00:00" }]),
    );
    apiMocks.getResumeGenerateTask.mockRejectedValue(new Error("任务不存在"));

    await restoreBackgroundTasks();

    expect(notices).toEqual([]);
    expect(window.localStorage.getItem(STORAGE_KEY)).toBeNull();
  });

  it("localStorage 不可用（隐私模式）时静默降级，注册与提醒不受影响", async () => {
    const getItemSpy = vi.spyOn(Storage.prototype, "getItem").mockImplementation(() => {
      throw new Error("localStorage 被禁用");
    });
    const setItemSpy = vi.spyOn(Storage.prototype, "setItem").mockImplementation(() => {
      throw new Error("localStorage 被禁用");
    });

    try {
      apiMocks.getResumeGenerateTask.mockResolvedValue(
        makeTask({ status: "completed", resume_id: 42 }),
      );
      watchResumeTask(makeTask(), "生成通用简历");
      await runOneTick();

      expect(notices.some((item) => item.title === "简历已生成")).toBe(true);
      expect(getBackgroundTasks()).toEqual([]);
    } finally {
      getItemSpy.mockRestore();
      setItemSpy.mockRestore();
    }
  });
});
