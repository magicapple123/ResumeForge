// SPDX-License-Identifier: Apache-2.0
/**
 * 输入区数据权限的集成行为（T11）：提示条、无会话只读、按会话 localStorage 持久化。
 *
 * 菜单/确认弹窗的细节在 composer/PermissionMenu.test.tsx；这里验证它们被组装进输入区后
 * 的两种用户可见结果：放宽档出现可关闭的琥珀提示条、新会话回到「跟随全局」不可改。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";

const permissionApiMocks = vi.hoisted(() => ({
  getAssistantPermission: vi.fn(),
  saveAssistantPermission: vi.fn(),
}));
const settingsMocks = vi.hoisted(() => ({
  getLLMConfig: vi.fn(),
  listLLMConfigRecords: vi.fn(),
}));

vi.mock("../../../api/assistantPermission", () => permissionApiMocks);
vi.mock("../../../api/settings", () => settingsMocks);

import AssistantComposer from "./AssistantComposer";
import { permissionStorageKey, resetAssistantPermissionForTests } from "../assistantPermission";
import { t, type MessageKey } from "../../../i18n";

type ComposerProps = Parameters<typeof AssistantComposer>[0];

function composerProps(overrides: Partial<ComposerProps> = {}): ComposerProps {
  return {
    content: "",
    attachments: [],
    sending: false,
    attachmentReads: 0,
    jobId: undefined,
    resumeId: undefined,
    webSearch: false,
    reasoningEffort: "",
    skillCatalog: [],
    selectedSkills: [],
    skillBudget: null,
    skillsLoaded: true,
    togglingSkillId: null,
    onContentChange: vi.fn(),
    onJobChange: vi.fn(),
    onResumeChange: vi.fn(),
    onWebSearchChange: vi.fn(),
    onReasoningEffortChange: vi.fn(),
    onToggleSkill: vi.fn(),
    onManageSkills: vi.fn(),
    onAddAttachment: vi.fn(),
    onRemoveAttachment: vi.fn(),
    quoted: null,
    onClearQuote: vi.fn(),
    onSend: vi.fn(),
    onStop: vi.fn(),
    ...overrides,
  };
}

function renderComposer(overrides: Partial<ComposerProps> = {}) {
  return render(
    <AntdApp>
      <AssistantComposer {...composerProps(overrides)} />
    </AntdApp>,
  );
}

beforeEach(() => {
  resetAssistantPermissionForTests();
  window.localStorage.clear();
  permissionApiMocks.getAssistantPermission.mockReset();
  permissionApiMocks.getAssistantPermission.mockResolvedValue({ permission: "read_only" });
  permissionApiMocks.saveAssistantPermission.mockReset();
  settingsMocks.getLLMConfig.mockReset();
  settingsMocks.getLLMConfig.mockResolvedValue({ record_id: null, model: "" });
  settingsMocks.listLLMConfigRecords.mockReset();
  settingsMocks.listLLMConfigRecords.mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  resetAssistantPermissionForTests();
  window.localStorage.clear();
});

async function chooseLevel(levelKey: MessageKey) {
  fireEvent.click(screen.getByRole("button", { name: /跟随全局/ }));
  fireEvent.click(await screen.findByText(t(levelKey)));
}

describe("数据权限一次性确认卡（#12）", () => {
  const modal = () => document.querySelector(".ant-modal");

  it("默认（跟随全局=仅查看）不弹确认卡", async () => {
    renderComposer({ conversationId: 7 });
    await waitFor(() => expect(permissionApiMocks.getAssistantPermission).toHaveBeenCalled());
    expect(modal()).toBeNull();
  });

  it("放宽读取：弹确认卡，读档位无需勾选，确认后按会话落 localStorage", async () => {
    renderComposer({ conversationId: 7 });
    await chooseLevel("assistantPermission.level.read_full");

    await waitFor(() => expect(modal()).not.toBeNull());
    // 读档位没有勾选框，主按钮直接可用
    expect(screen.queryByRole("checkbox")).toBeNull();
    fireEvent.click(
      screen.getByRole("button", { name: t("assistantPermission.confirm.okReadFull") }),
    );
    await waitFor(() =>
      expect(window.localStorage.getItem(permissionStorageKey(7))).toBe("read_full"),
    );
    await waitFor(() => expect(modal()).toBeNull());
  });

  it("写档位：未勾选时主按钮 disabled，勾选后才能确认", async () => {
    renderComposer({ conversationId: 7 });
    await chooseLevel("assistantPermission.level.write_full");

    await waitFor(() => expect(modal()).not.toBeNull());
    const ok = await screen.findByRole("button", {
      name: t("assistantPermission.confirm.ok", {
        level: t("assistantPermission.level.write_full"),
      }),
    });
    expect(ok).toBeDisabled();
    fireEvent.click(screen.getByRole("checkbox"));
    expect(ok).toBeEnabled();
    fireEvent.click(ok);
    await waitFor(() =>
      expect(window.localStorage.getItem(permissionStorageKey(7))).toBe("write_full"),
    );
  });

  it("已确认过的会话重开不再弹；取消不写任何存储", async () => {
    window.localStorage.setItem(permissionStorageKey(7), "write_full");
    renderComposer({ conversationId: 7 });
    // 覆盖值存在但该档位没确认过 → 仍要弹一次
    await waitFor(() => expect(modal()).not.toBeNull());
    fireEvent.click(screen.getByRole("button", { name: t("assistantPermission.confirm.cancel") }));
    await waitFor(() => expect(modal()).toBeNull());
    cleanup();

    // 用户确认一次后，同一会话重开不再弹
    window.localStorage.setItem(
      "rf.assistant.permissionAck.7",
      JSON.stringify({ levels: ["write_full"] }),
    );
    renderComposer({ conversationId: 7 });
    await waitFor(() => expect(permissionApiMocks.getAssistantPermission).toHaveBeenCalled());
    expect(modal()).toBeNull();
  });

  it("新对话继承全局「完全权限」不弹卡，也不写会话覆盖（F30）", async () => {
    permissionApiMocks.getAssistantPermission.mockResolvedValue({ permission: "write_full" });

    renderComposer({ conversationId: 8 });

    await waitFor(() => expect(permissionApiMocks.getAssistantPermission).toHaveBeenCalled());
    expect(modal()).toBeNull();
    // 跟随全局时不该把继承来的档位固化成会话覆盖。
    expect(window.localStorage.getItem(permissionStorageKey(8))).toBeNull();

    // 同一会话里手动选「完全权限」仍要弹（扩权确认只发生在会话内切换这一条路径）。
    fireEvent.click(screen.getByRole("button", { name: /跟随全局/ }));
    fireEvent.click(await screen.findByText(t("assistantPermission.level.write_full")));
    await waitFor(() => expect(modal()).not.toBeNull());
  });

  it("新会话（无 conversationId）回到「跟随全局」且不可改", async () => {
    renderComposer({ conversationId: null });

    const trigger = await screen.findByRole("button", { name: /跟随全局/ });
    expect(trigger).toBeDisabled();
    expect(modal()).toBeNull();
  });
});
