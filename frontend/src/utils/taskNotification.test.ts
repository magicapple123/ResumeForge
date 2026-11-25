// SPDX-License-Identifier: Apache-2.0
import { afterEach, describe, expect, it, vi } from "vitest";
import {
  buildTaskNotification,
  fireWebNotification,
  notifyBackgroundTaskDone,
} from "./taskNotification";

const task = {
  id: 7,
  kind: "apply",
  status: "completed",
  succeeded: 2,
  failed: 1,
  skipped: 3,
  message: "",
};

/** jsdom 没有改 visibilityState 的入口，直接覆写属性模拟；用例结束还原为可见。 */
function setHidden(hidden: boolean): void {
  Object.defineProperty(document, "visibilityState", {
    configurable: true,
    get: () => (hidden ? "hidden" : "visible"),
  });
}

function clearDesktopBridge(): void {
  delete (window as unknown as { resumeForge?: unknown }).resumeForge;
}

afterEach(() => {
  vi.unstubAllGlobals();
  clearDesktopBridge();
  setHidden(false);
});

describe("taskNotification", () => {
  it("preserves terminal-state messages and does not notify for an active task", () => {
    expect(buildTaskNotification(task)).toEqual({
      type: "success",
      message: "投递批次 #7 已完成",
      description: "成功 2 · 失败 1 · 跳过 3",
    });
    expect(buildTaskNotification({ ...task, kind: "collect" })?.description).toBe(
      "已暂存 2 个岗位 · 跳过 3 个",
    );
    expect(buildTaskNotification({ ...task, status: "stopped" })?.type).toBe("warning");
    expect(buildTaskNotification({ ...task, status: "failed" })?.description).toBe(
      "请到投递台查看失败原因",
    );
    expect(buildTaskNotification({ ...task, status: "running" })).toBeNull();
  });

  it("only sends an already-authorized desktop notification and never requests permission", () => {
    const created = vi.fn();
    const requestPermission = vi.fn();
    class FakeNotification {
      static permission = "default";
      static requestPermission = requestPermission;
      constructor(title: string, options: { body: string }) {
        created(title, options);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    fireWebNotification("title", "body");
    expect(created).not.toHaveBeenCalled();
    expect(requestPermission).not.toHaveBeenCalled();
    FakeNotification.permission = "granted";
    fireWebNotification("title", "body");
    expect(created).toHaveBeenCalledWith("title", { body: "body" });
  });

  it("unsupported notifications do not break the in-app notification path", () => {
    vi.stubGlobal("Notification", undefined);
    expect(() => fireWebNotification("title", "body")).not.toThrow();
  });

  it("有桌面桥时走 IPC：不依赖浏览器通知权限（CR-24 的死锁）", () => {
    const notify = vi.fn().mockResolvedValue({ shown: true });
    const created = vi.fn();
    class FakeNotification {
      static permission = "default";
      static requestPermission = vi.fn();
      constructor(title: string) {
        created(title);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);
    (window as unknown as { resumeForge?: unknown }).resumeForge = { notify };

    fireWebNotification("投递批次 #7 已完成", "成功 2 · 失败 1", {
      deepLink: "/apply",
      dedupeKey: "batch:7",
    });

    expect(notify).toHaveBeenCalledWith({
      title: "投递批次 #7 已完成",
      body: "成功 2 · 失败 1",
      deepLink: "/apply",
      dedupeKey: "batch:7",
    });
    expect(created).not.toHaveBeenCalled();
  });

  it("后台任务完成：桌面桥总是上报（可见但未聚焦也该提醒），无桥时仅隐藏才弹浏览器通知", () => {
    const notify = vi.fn().mockResolvedValue({ shown: false });
    (window as unknown as { resumeForge?: unknown }).resumeForge = { notify };
    notifyBackgroundTaskDone({
      title: "简历已生成",
      body: "42",
      deepLink: "/resumes?resume_id=42",
    });
    expect(notify).toHaveBeenCalledTimes(1);

    clearDesktopBridge();
    const created = vi.fn();
    class FakeNotification {
      static permission = "granted";
      constructor(title: string) {
        created(title);
      }
    }
    vi.stubGlobal("Notification", FakeNotification);

    // 页面可见：应用内提醒已经能看见，不再弹浏览器通知。
    notifyBackgroundTaskDone({ title: "简历已生成", body: "42" });
    expect(created).not.toHaveBeenCalled();

    // 页面隐藏：补一条浏览器通知。
    setHidden(true);
    notifyBackgroundTaskDone({ title: "简历已生成", body: "42" });
    expect(created).toHaveBeenCalledWith("简历已生成");
  });
});
