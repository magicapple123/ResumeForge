// SPDX-License-Identifier: Apache-2.0
/**
 * 助手页的「工具调用」渲染：流式期间改动了什么、失败项不能被折叠藏起来、历史消息缺少
 * changed 标记时不得替后端编造改动。
 *
 * 从 `AssistantPage.streaming.test.tsx` 拆出（行数预算）：这里只放工具调用折叠面板
 * 这一域，流式主链路（隔离、停止、卸载、附件、delta 缓冲）仍在主文件里。`vi.mock` 按
 * 测试文件装配，所以 mock 声明必须在本文件内逐字声明（harness 只共享夹具与渲染入口）。
 */
import { cleanup, fireEvent, render, screen } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantStreamEvent } from "../types";
import { MessageToolCalls } from "../features/assistant/components/AssistantMessageContent";
import { resetAssistantStreamForTests } from "../features/assistant/hooks/assistantStreamStore";
import {
  CONVERSATIONS,
  conversationDetail,
  deferred,
  renderPage,
} from "../test/assistantPageHarness";

const apiMocks = vi.hoisted(() => ({
  createAssistantConversation: vi.fn(),
  getAssistantConversation: vi.fn(),
  listAssistantConversations: vi.fn(),
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
  getAssistantConversation: apiMocks.getAssistantConversation,
  listAssistantConversations: apiMocks.listAssistantConversations,
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

beforeEach(() => {
  // 流式会话状态是模块级全局 store：用例会把流挂起不结束，用例之间必须重置回空闲，
  // 否则"发送中"状态会漏进下一个用例（与主 streaming 文件同一口径）。
  resetAssistantStreamForTests();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: vi.fn(),
  });
  apiMocks.listAssistantConversations.mockReset().mockResolvedValue(CONVERSATIONS);
  apiMocks.getAssistantConversation
    .mockReset()
    .mockImplementation((id: number) => Promise.resolve(conversationDetail(id)));
  apiMocks.createAssistantConversation.mockReset().mockResolvedValue(CONVERSATIONS[0]);
  apiMocks.sendAssistantMessage.mockReset().mockResolvedValue(undefined);
  apiMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  apiMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  skillApiMocks.listSkills.mockReset().mockResolvedValue([]);
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

describe("AssistantPage 工具调用", () => {
  it("shows what the assistant did with tools while the reply is streaming", async () => {
    const stream = deferred<void>();
    apiMocks.sendAssistantMessage.mockImplementation(
      async (_id: number, _payload: unknown, onEvent: (event: AssistantStreamEvent) => void) => {
        onEvent({
          type: "start",
          user_message_id: 1,
          assistant_message_id: 2,
          conversation_title: "新对话",
        });
        onEvent({
          type: "tool",
          name: "create_job",
          arguments: { title: "字节跳动后端实习" },
          summary: "新增岗位「字节跳动后端实习」",
          link: "/jobs",
          ok: true,
          error: "",
          changed: true,
        });
        await stream.promise;
      },
    );

    renderPage();
    fireEvent.change(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题"), {
      target: { value: "帮我把这个岗位存进去" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    // 助手改动了数据这件事必须一眼可见：现在记录默认折叠了，但改动项被提到折叠标题里，
    // 所以不展开也能看到"改动了 1 项"——原来的"必须一眼可见"由标题摘要保住，而不是丢掉。
    expect(await screen.findByText(/助手做了什么（1）/)).toBeInTheDocument();
    expect(screen.getByText(/改动了 1 项/)).toBeInTheDocument();
    // 逐条明细仍在折叠面板内，展开后可见，且「前往查看」跳转不变。
    expect(screen.queryByText("新建岗位")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /助手做了什么（1）/ }));
    expect(await screen.findByText("新建岗位")).toBeInTheDocument();
    expect(screen.getByText("新增岗位「字节跳动后端实习」")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "前往查看" })).toHaveAttribute("href", "/jobs");
  });

  it("flags a tool that failed", async () => {
    const stream = deferred<void>();
    apiMocks.sendAssistantMessage.mockImplementation(
      async (_id: number, _payload: unknown, onEvent: (event: AssistantStreamEvent) => void) => {
        onEvent({
          type: "tool",
          name: "get_job",
          arguments: { job_id: 999 },
          summary: "",
          link: "",
          ok: false,
          error: "岗位 999 不存在",
          changed: false,
        });
        await stream.promise;
      },
    );

    renderPage();
    fireEvent.change(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题"), {
      target: { value: "看看 999 号岗位" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    // 失败不能被折叠藏起来：失败计数写在折叠标题里，不展开也能看到出了问题。
    expect(await screen.findByText(/1 项失败/)).toBeInTheDocument();
    // 展开后能看到具体是哪一条、为什么失败。
    fireEvent.click(screen.getByRole("button", { name: /助手做了什么（1）/ }));
    expect(await screen.findByText(/失败：岗位 999 不存在/)).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "前往查看" })).not.toBeInTheDocument();
  });

  it("never claims data changed when a historical tool call has no changed flag", () => {
    // changed 是随功能一起加的可选字段，更早存下的历史消息里没有。缺失必须按"没改动"处理，
    // 否则折叠标题会凭空报出「改动了 1 项」——那是在替后端编造它没说过的改动。
    render(
      <MessageToolCalls
        calls={[
          {
            name: "create_job",
            arguments: { title: "历史岗位" },
            summary: "新增岗位「历史岗位」",
            link: "/jobs",
            ok: true,
            error: "",
          },
        ]}
      />,
    );

    expect(screen.getByText(/助手做了什么（1）/)).toBeInTheDocument();
    expect(screen.queryByText(/改动了/)).not.toBeInTheDocument();
    expect(screen.queryByText(/项失败/)).not.toBeInTheDocument();
  });
});
