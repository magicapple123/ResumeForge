// SPDX-License-Identifier: Apache-2.0
/**
 * 助手页的对话技能（T14）：chip 形态、单枚停用、草稿先勾技能随第一条消息建会话。
 *
 * 从 AssistantPage.conversation.test.tsx 拆出（该文件已贴 500 行预算）：这里只放
 * "输入区技能行 ↔ 服务端"这一域，其余会话行为仍在 conversation 文件里。
 * vi.mock 按测试文件装配，mock 声明必须在本文件内逐字声明（先例：streaming 测试文件）。
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
const UNUSED_SKILL = "暂时不用";
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

function conversationSkill(id: number, name: string) {
  return { id, name, description: "" };
}

function skillsPayload(ids: number[], names: string[], used = 1_200) {
  return {
    skill_ids: ids,
    skills: ids.map((id, index) => conversationSkill(id, names[index])),
    budget: {
      used_chars: used,
      loaded_chars: used,
      limit_chars: 12_000,
      truncated_skill_ids: [],
    },
  };
}

function openFirstConversation() {
  return harnessOpenFirstConversation({
    getAssistantConversation: apiMocks.getAssistantConversation,
  });
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
  skillApiMocks.listSkills.mockReset().mockResolvedValue([]);
  conversationSkillApiMocks.getConversationSkills
    .mockReset()
    .mockResolvedValue(skillsPayload([], []));
  conversationSkillApiMocks.setConversationSkills.mockReset();
  agentTaskApiMocks.listAgentTasks.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  window.localStorage.clear();
});

describe("对话技能 chip 行", () => {
  it("只显示本对话启用的技能；每枚可单独停用，入口收在工具栏的 + 面板里", async () => {
    skillApiMocks.listSkills.mockResolvedValue([
      makeSkill(1, INTERVIEW_SKILL, true),
      makeSkill(2, RESUME_SKILL, true),
      // 技能库里有、但这个对话没启用的技能：不能出现在 chip 行里。
      makeSkill(3, UNUSED_SKILL, false),
    ]);
    conversationSkillApiMocks.getConversationSkills.mockResolvedValue(
      skillsPayload([1, 2], [INTERVIEW_SKILL, RESUME_SKILL]),
    );

    renderPage();
    await openFirstConversation();

    expect(await screen.findByText(INTERVIEW_SKILL)).toBeInTheDocument();
    expect(screen.getByText(RESUME_SKILL)).toBeInTheDocument();
    expect(screen.queryByText(UNUSED_SKILL)).toBeNull();
    // 停用入口按技能名可寻址（读屏用户也能准确点掉某一枚）。
    expect(screen.getByRole("button", { name: "停用技能「面试官追问」" })).toBeInTheDocument();
    // R06-A：空态/追加入口不再是行末那枚「+ 技能」虚线按钮，而是工具栏最左的 `+`。
    expect(
      screen.getByRole("button", { name: t("composerAddMenu.aria.trigger") }),
    ).toBeInTheDocument();
  });

  it("点 chip 上的 × 只停用当个：整体替换只提交剩下的技能", async () => {
    conversationSkillApiMocks.getConversationSkills.mockResolvedValue(
      skillsPayload([1, 2], [INTERVIEW_SKILL, RESUME_SKILL]),
    );
    conversationSkillApiMocks.setConversationSkills.mockResolvedValue(
      skillsPayload([2], [RESUME_SKILL], 800),
    );

    renderPage();
    await openFirstConversation();
    fireEvent.click(await screen.findByRole("button", { name: "停用技能「面试官追问」" }));

    await waitFor(() =>
      expect(conversationSkillApiMocks.setConversationSkills).toHaveBeenCalledWith(1, [2], "page"),
    );
  });
});

describe("空态先勾技能再发第一条消息", () => {
  it("建会话请求带上暂存的 skill_ids，创建后按新会话重取", async () => {
    skillApiMocks.listSkills.mockResolvedValue([makeSkill(1, INTERVIEW_SKILL, true)]);
    renderPage("/assistant?new=1");
    await screen.findByText(EMPTY_GREETING);

    // 草稿态：`+` → 技能（二级面板），勾上第一个技能。
    fireEvent.click(await screen.findByRole("button", { name: t("composerAddMenu.aria.trigger") }));
    fireEvent.click(await screen.findByText(t("assistantComposer.skills.count", { count: 0 })));
    const picker = await screen.findByRole("group", {
      name: t("composerAddMenu.section.skills"),
    });
    fireEvent.click(within(picker).getByText(INTERVIEW_SKILL));
    // 勾上后 chip 立即出现（同一份暂存状态）。
    expect(
      await screen.findByRole("button", { name: "停用技能「面试官追问」" }),
    ).toBeInTheDocument();

    fireEvent.change(screen.getByPlaceholderText(/输入求职、岗位/), {
      target: { value: "开始面试" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));

    // 草稿里的选择随第一次建会话一起提交（服务端同事务写入）。
    await waitFor(() =>
      expect(apiMocks.createAssistantConversation).toHaveBeenCalledWith("", { skillIds: [1] }),
    );
    // 会话建好后技能行以服务端为准（GET 新会话的技能）。
    await waitFor(() =>
      expect(conversationSkillApiMocks.getConversationSkills).toHaveBeenCalledWith(99, "page"),
    );
  });
});
