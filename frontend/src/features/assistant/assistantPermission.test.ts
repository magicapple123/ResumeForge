// SPDX-License-Identifier: Apache-2.0
/**
 * 四档数据权限的前端口径（T11）：映射表、按会话 localStorage、全局默认解算。
 *
 * 请求体永远发解算后的两轴布尔——这里是解算的唯一入口，所以断言"两轴取值"就在这一层做。
 */
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const permissionApiMocks = vi.hoisted(() => ({
  getAssistantPermission: vi.fn(),
  saveAssistantPermission: vi.fn(),
}));

vi.mock("../../api/assistantPermission", () => permissionApiMocks);

import {
  ASSISTANT_PERMISSION_LEVELS,
  DEFAULT_ASSISTANT_PERMISSION,
  FOLLOW_GLOBAL,
  acknowledgeWritePermission,
  bumpAssistantPermission,
  getCachedGlobalPermission,
  hasAcknowledgedWritePermission,
  isWriteLevel,
  loadGlobalPermission,
  permissionAxes,
  permissionStorageKey,
  readPermissionChoice,
  resetAssistantPermissionForTests,
  resolvePermissionAxes,
  showsRelaxedNotice,
  writePermissionChoice,
} from "./assistantPermission";

const CONVERSATION_ID = 7;

beforeEach(() => {
  resetAssistantPermissionForTests();
  window.localStorage.clear();
  permissionApiMocks.getAssistantPermission.mockReset();
  permissionApiMocks.saveAssistantPermission.mockReset();
});

afterEach(() => {
  resetAssistantPermissionForTests();
  window.localStorage.clear();
});

describe("四档 → 两轴（唯一映射表）", () => {
  it.each([
    ["read_only", false, false],
    ["read_full", true, false],
    ["write_confirm", false, true],
    ["write_full", true, true],
  ] as const)("%s → relaxed=%s allowWrite=%s", (level, relaxed, allowWrite) => {
    expect(permissionAxes(level)).toEqual({ relaxed, allowWrite });
    expect(isWriteLevel(level)).toBe(allowWrite);
  });

  it("只有放宽两档显示琥珀提示条", () => {
    expect(ASSISTANT_PERMISSION_LEVELS.map(showsRelaxedNotice)).toEqual([false, true, false, true]);
  });

  it("默认档位是仅查看（读不到设置时的保守回退）", () => {
    expect(permissionAxes(DEFAULT_ASSISTANT_PERMISSION)).toEqual({
      relaxed: false,
      allowWrite: false,
    });
  });
});

describe("按会话的 localStorage 覆盖", () => {
  it("没存过 → 跟随全局；写入后读回所选档位", () => {
    expect(readPermissionChoice(CONVERSATION_ID)).toBe(FOLLOW_GLOBAL);

    writePermissionChoice(CONVERSATION_ID, "write_full");
    expect(window.localStorage.getItem(permissionStorageKey(CONVERSATION_ID))).toBe("write_full");
    expect(readPermissionChoice(CONVERSATION_ID)).toBe("write_full");

    // 选「跟随全局」= 删 key，走全局默认（不是存一个 "follow" 中间态）
    writePermissionChoice(CONVERSATION_ID, FOLLOW_GLOBAL);
    expect(window.localStorage.getItem(permissionStorageKey(CONVERSATION_ID))).toBeNull();
    expect(readPermissionChoice(CONVERSATION_ID)).toBe(FOLLOW_GLOBAL);
  });

  it("没有会话 id 时不读也不写 localStorage", () => {
    writePermissionChoice(null, "read_full");
    expect(window.localStorage.length).toBe(0);
    expect(readPermissionChoice(null)).toBe(FOLLOW_GLOBAL);
  });

  it("损坏的值按跟随全局处理并从存储里清掉", () => {
    window.localStorage.setItem(permissionStorageKey(CONVERSATION_ID), "admin");
    expect(readPermissionChoice(CONVERSATION_ID)).toBe(FOLLOW_GLOBAL);
    expect(window.localStorage.getItem(permissionStorageKey(CONVERSATION_ID))).toBeNull();
  });

  it("写档位确认标记按会话记录（每对话只弹一次的依据）", () => {
    expect(hasAcknowledgedWritePermission(CONVERSATION_ID)).toBe(false);
    acknowledgeWritePermission(CONVERSATION_ID);
    expect(hasAcknowledgedWritePermission(CONVERSATION_ID)).toBe(true);
    expect(hasAcknowledgedWritePermission(8)).toBe(false);
  });
});

describe("发送路径解算两轴", () => {
  it("有覆盖时直接用覆盖值，不请求全局设置", async () => {
    writePermissionChoice(CONVERSATION_ID, "read_full");

    await expect(resolvePermissionAxes(CONVERSATION_ID)).resolves.toEqual({
      relaxed: true,
      allowWrite: false,
    });
    expect(permissionApiMocks.getAssistantPermission).not.toHaveBeenCalled();
  });

  it("跟随全局时取全局默认（并缓存，第二次不再请求）", async () => {
    permissionApiMocks.getAssistantPermission.mockResolvedValue({
      permission: "write_confirm",
    });

    await expect(resolvePermissionAxes(CONVERSATION_ID)).resolves.toEqual({
      relaxed: false,
      allowWrite: true,
    });
    await resolvePermissionAxes(CONVERSATION_ID);
    expect(permissionApiMocks.getAssistantPermission).toHaveBeenCalledTimes(1);
    expect(getCachedGlobalPermission()).toBe("write_confirm");
  });

  it("取不到全局设置时退回仅查看（少发敏感资料），不抛错", async () => {
    permissionApiMocks.getAssistantPermission.mockRejectedValue(new Error("offline"));

    await expect(resolvePermissionAxes(CONVERSATION_ID)).resolves.toEqual({
      relaxed: false,
      allowWrite: false,
    });
    // 失败不缓存：下一次仍会重试
    permissionApiMocks.getAssistantPermission.mockResolvedValue({ permission: "read_full" });
    await resolvePermissionAxes(CONVERSATION_ID);
    expect(permissionApiMocks.getAssistantPermission).toHaveBeenCalledTimes(2);
  });

  it("写入全局默认后广播：缓存失效，下次重新取", async () => {
    permissionApiMocks.getAssistantPermission.mockResolvedValue({ permission: "read_only" });
    await loadGlobalPermission();

    bumpAssistantPermission();
    expect(getCachedGlobalPermission()).toBeNull();

    permissionApiMocks.getAssistantPermission.mockResolvedValue({ permission: "write_full" });
    await expect(resolvePermissionAxes(CONVERSATION_ID)).resolves.toEqual({
      relaxed: true,
      allowWrite: true,
    });
  });
});
