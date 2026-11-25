// SPDX-License-Identifier: Apache-2.0
/**
 * 完成提醒同时写通知中心（CR-25）：`notifyTaskDone` 是"任务完成"的唯一出口，
 * 所以回看记录也只能在这里接——否则每加一个入口就漏一次。
 */
import { afterEach, describe, expect, it, vi } from "vitest";
import { notifyTaskDone } from "./taskNotify";

const api = vi.hoisted(() => ({ recordNotification: vi.fn() }));
vi.mock("../api/notifications", () => api);

afterEach(() => {
  vi.clearAllMocks();
});

describe("notifyTaskDone → inbox", () => {
  it("带 dedupeKey：按它写一条 background_task 记录（含深链与正文）", () => {
    api.recordNotification.mockResolvedValue({ id: 1 });
    notifyTaskDone({
      title: "简历已生成",
      description: "通用简历 · 已完成",
      deepLink: "/resumes/42",
      dedupeKey: "background:resume_generate:7",
    });

    expect(api.recordNotification).toHaveBeenCalledWith({
      type: "background_task",
      severity: "info",
      title: "简历已生成",
      body: "通用简历 · 已完成",
      deep_link: "/resumes/42",
      dedupe_key: "background:resume_generate:7",
    });
  });

  it("失败按 warning 严重度落库；取消（warning kind）不进 inbox", () => {
    api.recordNotification.mockResolvedValue({ id: 2 });
    notifyTaskDone({
      kind: "error",
      title: "批次失败",
      description: "网络中断",
      dedupeKey: "background:apply:9:failed",
    });
    expect(api.recordNotification).toHaveBeenCalledWith(
      expect.objectContaining({ severity: "warning", title: "批次失败" }),
    );

    api.recordNotification.mockClear();
    notifyTaskDone({ kind: "warning", title: "已取消「投递批次」" });
    expect(api.recordNotification).not.toHaveBeenCalled();
  });

  it("没给 dedupeKey：同标题同深链在同一分钟内派生出同一个键（防重复上报）", () => {
    api.recordNotification.mockResolvedValue({ id: 3 });
    const notice = { title: "岗位解读已完成", deepLink: "/jobs/1" };
    notifyTaskDone(notice);
    notifyTaskDone(notice);

    const keys = api.recordNotification.mock.calls.map(
      (call) => (call[0] as { dedupe_key: string }).dedupe_key,
    );
    expect(keys).toHaveLength(2);
    expect(keys[0]).toBe(keys[1]);
    expect(keys[0]).toMatch(/^task:[a-z0-9]+:\d{4}-\d{2}-\d{2}T\d{2}:\d{2}$/);
  });

  it("写入失败不抛（inbox 是补看通道，不能拖垮完成提示）", async () => {
    api.recordNotification.mockRejectedValue(new Error("后端不可用"));
    expect(() => notifyTaskDone({ title: "任务已完成", dedupeKey: "k:1" })).not.toThrow();
    await Promise.resolve();
  });
});
