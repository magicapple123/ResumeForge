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

describe("数据权限提示条集成", () => {
  it("默认（跟随全局=仅查看）不显示提示条", async () => {
    renderComposer({ conversationId: 7 });
    await waitFor(() => expect(permissionApiMocks.getAssistantPermission).toHaveBeenCalled());
    expect(screen.queryByText(t("assistantPermission.notice.readFull.title"))).toBeNull();
  });

  it("切到放宽读取：出现琥珀提示条，可关闭，且按会话落 localStorage", async () => {
    renderComposer({ conversationId: 7 });
    await chooseLevel("assistantPermission.level.read_full");

    expect(
      await screen.findByText(t("assistantPermission.notice.readFull.title")),
    ).toBeInTheDocument();
    expect(window.localStorage.getItem(permissionStorageKey(7))).toBe("read_full");

    fireEvent.click(
      screen.getByRole("button", { name: t("assistantPermission.notice.closeAria") }),
    );
    await waitFor(() =>
      expect(screen.queryByText(t("assistantPermission.notice.readFull.title"))).toBeNull(),
    );
  });

  it("已存过覆盖值的会话：重新打开立即按该档位生效（提示条直接出现）", async () => {
    window.localStorage.setItem(permissionStorageKey(7), "write_full");
    renderComposer({ conversationId: 7 });

    expect(
      await screen.findByText(t("assistantPermission.notice.writeFull.title")),
    ).toBeInTheDocument();
  });

  it("新会话（无 conversationId）回到「跟随全局」且不可改", async () => {
    renderComposer({ conversationId: null });

    const trigger = await screen.findByRole("button", { name: /跟随全局/ });
    expect(trigger).toBeDisabled();
    expect(window.localStorage.length).toBe(0);
  });
});
