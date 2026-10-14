import { afterEach, describe, expect, it, vi } from "vitest";
import { buildTaskNotification, fireWebNotification } from "./taskNotification";

const task = {
  id: 7,
  kind: "apply",
  status: "completed",
  succeeded: 2,
  failed: 1,
  skipped: 3,
  message: "",
};

afterEach(() => vi.unstubAllGlobals());

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
});
