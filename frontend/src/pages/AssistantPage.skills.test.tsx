// SPDX-License-Identifier: Apache-2.0
/**
 * 助手页的待发送技能（T24）：技能从「按对话启用」改成「只作用于下一条消息」。
 *
 * 三条性质：
 * 1. 勾选**只改本地状态**（chip 立刻出现），不再 PUT 到会话；
 * 2. 点 chip 上的 × 只移除本地选择，也不发请求；
 * 3. 发送时随请求带 `skill_ids`，发送后输入区 chip 清空（下一轮不再自动生效）。
 *
 * 历史里的「使用 X」展示见 `components/AssistantMessageList.skills.test.tsx`。
 */
import { cleanup, fireEvent, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import {
  CONVERSATIONS,
  conversationDetail,
  makeSkill,
  openFirstConversation as harnessOpenFirstConversation,
  renderPage,
} from "../test/assistantPageHarness";
import { t } from "../i18n";

// 中文断言文案走变量：ByText 中文字面量会推高 i18n 棘轮（只降不升）。
const INTERVIEW_SKILL = "面试官追问";
const RESUME_SKILL = "简历诊断";
const REMOVE_INTERVIEW = "从本条移除技能「面试官追问」";
const EMPTY_GREETING = "你好，我是投投";

const apiMocks = vi.hoisted(() => ({
  createAssistantConversation: vi.fn(),
  listAssistantConversations: vi.fn(),
  getAssistantConversation: vi.fn(),
  sendAssistantMessage: vi.fn(),
  listJobs: vi.fn(),
  listResumes: vi.fn(),
}));
const skillApiMocks = vi.hoisted(() => ({ listSkills: vi.fn() }));
const conversationSkillApiMocks = vi.hoisted(() => ({
  getConversationSkills: vi.fn(),
  setConversationSkills: vi.fn(),
}));
const agentTaskApiMocks = vi.hoisted(() => ({ listAgentTasks: vi.fn() }));

vi.mock("../api/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/assistant")>()),
  createAssistantConversation: apiMocks.createAssistantConversation,
  listAssistantConversations: apiMocks.listAssistantConversations,
  getAssistantConversation: apiMocks.getAssistantConversation,
  sendAssistantMessage: apiMocks.sendAssistantMessage,
}));
vi.mock("../api/jobs", () => ({ listJobs: apiMocks.listJobs }));
vi.mock("../api/resumes", () => ({ listResumes: apiMocks.listResumes }));
vi.mock("../api/skill", () => ({ listSkills: skillApiMocks.listSkills }));
vi.mock("../api/conversationSkills", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/conversationSkills")>()),
  getConversationSkills: conversationSkillApiMocks.getConversationSkills,
  setConversationSkills: conversationSkillApiMocks.setConversationSkills,
}));
vi.mock("../api/agentTasks", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/agentTasks")>()),
  listAgentTasks: agentTaskApiMocks.listAgentTasks,
}));

function openFirstConversation() {
  return harnessOpenFirstConversation({
    getAssistantConversation: apiMocks.getAssistantConversation,
  });
}

/** 打开 `+` → 「技能」二级面板，点一个技能（本地勾选）。 */
async function pickSkill(name: string) {
  fireEvent.click(await screen.findByRole("button", { name: t("composerAddMenu.aria.trigger") }));
  fireEvent.click(await screen.findByText(t("assistantComposer.skills.count", { count: 0 })));
  const picker = await screen.findByRole("group", {
    name: t("composerAddMenu.section.skills"),
  });
  fireEvent.click(within(picker).getByText(name));
}

beforeEach(() => {
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  apiMocks.listAssistantConversations.mockReset().mockResolvedValue(CONVERSATIONS);
  apiMocks.getAssistantConversation
    .mockReset()
    .mockImplementation((id: number) => Promise.resolve(conversationDetail(id)));
  apiMocks.createAssistantConversation
    .mockReset()
    .mockResolvedValue({ ...CONVERSATIONS[0], id: 99 });
  apiMocks.sendAssistantMessage.mockReset().mockResolvedValue(undefined);
  apiMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  apiMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  skillApiMocks.listSkills
    .mockReset()
    .mockResolvedValue([makeSkill(1, INTERVIEW_SKILL, true), makeSkill(2, RESUME_SKILL, true)]);
  conversationSkillApiMocks.getConversationSkills.mockReset().mockResolvedValue({
    skill_ids: [],
    skills: [],
    budget: { used_chars: 0, loaded_chars: 0, limit_chars: 12_000, truncated_skill_ids: [] },
  });
  conversationSkillApiMocks.setConversationSkills.mockReset();
  agentTaskApiMocks.listAgentTasks.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("待发送技能（T24）", () => {
  it("勾选只改本地 chip，不再 PUT 到会话", async () => {
    renderPage();
    await openFirstConversation();
    await pickSkill(INTERVIEW_SKILL);

    expect(await screen.findByRole("button", { name: REMOVE_INTERVIEW })).toBeInTheDocument();
    expect(conversationSkillApiMocks.setConversationSkills).not.toHaveBeenCalled();
    // 预算是"按条"算的：没有服务端预算时显示 pending 文案，而不是本对话预算。
    expect(
      screen.getByText(t("conversationSkills.menu.budgetPending", { count: 1 })),
    ).toBeInTheDocument();
  });

  it("点 chip 上的 × 只移除本地选择，也不发请求", async () => {
    renderPage();
    await openFirstConversation();
    await pickSkill(INTERVIEW_SKILL);
    fireEvent.click(await screen.findByRole("button", { name: REMOVE_INTERVIEW }));

    expect(screen.queryByRole("button", { name: REMOVE_INTERVIEW })).toBeNull();
    expect(conversationSkillApiMocks.setConversationSkills).not.toHaveBeenCalled();
  });

  it("发送时带 skill_ids，发送后 chip 清空（技能只作用于下一条消息）", async () => {
    renderPage();
    await openFirstConversation();
    await pickSkill(INTERVIEW_SKILL);

    fireEvent.change(screen.getByPlaceholderText(/输入求职、岗位/), {
      target: { value: "开始面试" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));

    await waitFor(() => expect(apiMocks.sendAssistantMessage).toHaveBeenCalled());
    const payload = apiMocks.sendAssistantMessage.mock.calls[0][1];
    expect(payload.skill_ids).toEqual([1]);
    // 发送后输入区清空：下一轮不会自动带上同一批技能。
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: REMOVE_INTERVIEW })).toBeNull(),
    );
  });

  it("草稿态不把技能塞进建会话请求（技能不再挂在会话上）", async () => {
    renderPage("/assistant?new=1");
    await screen.findByText(EMPTY_GREETING);
    await pickSkill(INTERVIEW_SKILL);

    fireEvent.change(screen.getByPlaceholderText(/输入求职、岗位/), {
      target: { value: "开始面试" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));

    await waitFor(() =>
      expect(apiMocks.createAssistantConversation).toHaveBeenCalledWith("", { skillIds: [] }),
    );
    const payload = apiMocks.sendAssistantMessage.mock.calls[0][1];
    expect(payload.skill_ids).toEqual([1]);
  });
});
