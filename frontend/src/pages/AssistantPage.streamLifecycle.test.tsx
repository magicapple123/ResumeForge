// SPDX-License-Identifier: Apache-2.0
/**
 * 助手流式会话全局化（问题 B）与 stick-to-bottom（问题 A）的页面级测试。
 *
 * 从 AssistantPage.test.tsx 拆出（行数预算门禁）：这两个域共享一份"可手工推进的
 * 流"替身——sendAssistantMessage 返回手动 resolve 的 Promise 并捕获事件回调与
 * AbortSignal，让用例能模拟 delta、完成、以及"组件已卸载但流还在跑"。
 * vi.mock 按测试文件装配：mock 声明在此文件内逐字声明（先例：AssistantPage.streaming.test.tsx）。
 */
import { act, cleanup, fireEvent, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage, AssistantStreamEvent } from "../types";
import { resetAssistantStreamForTests } from "../features/assistant/hooks/assistantStreamStore";
import {
  CONVERSATIONS,
  CREATED_AT,
  conversationDetail,
  openFirstConversation as harnessOpenFirstConversation,
  renderPage,
} from "../test/assistantPageHarness";

// harness 的 openFirstConversation 把 apiMocks 参数化（mock 对象必须留在各测试文件内）；
// 这里包一层，保持调用形状与其它 AssistantPage 测试文件一致。
function openFirstConversation() {
  return harnessOpenFirstConversation({
    getAssistantConversation: apiMocks.getAssistantConversation,
  });
}

const apiMocks = vi.hoisted(() => ({
  createAssistantConversation: vi.fn(),
  deleteAssistantConversation: vi.fn(),
  deleteAssistantMessage: vi.fn(),
  deleteAssistantMessages: vi.fn(),
  getAssistantConversation: vi.fn(),
  listAssistantConversations: vi.fn(),
  renameAssistantConversation: vi.fn(),
  updateAssistantConversation: vi.fn(),
  sendAssistantMessage: vi.fn(),
  listJobs: vi.fn(),
  listResumes: vi.fn(),
}));
const skillApiMocks = vi.hoisted(() => ({ listSkills: vi.fn() }));
const scrollIntoViewMock = vi.fn();

// 先把真实导出铺开再覆盖要断言的那几个（与 AssistantPage.test.tsx 同一套替身）。
vi.mock("../api/assistant", async (importOriginal) => ({
  ...(await importOriginal<typeof import("../api/assistant")>()),
  createAssistantConversation: apiMocks.createAssistantConversation,
  deleteAssistantConversation: apiMocks.deleteAssistantConversation,
  deleteAssistantMessage: apiMocks.deleteAssistantMessage,
  deleteAssistantMessages: apiMocks.deleteAssistantMessages,
  getAssistantConversation: apiMocks.getAssistantConversation,
  listAssistantConversations: apiMocks.listAssistantConversations,
  renameAssistantConversation: apiMocks.renameAssistantConversation,
  updateAssistantConversation: apiMocks.updateAssistantConversation,
  sendAssistantMessage: apiMocks.sendAssistantMessage,
}));
vi.mock("../api/jobs", () => ({ listJobs: apiMocks.listJobs }));
vi.mock("../api/resumes", () => ({ listResumes: apiMocks.listResumes }));
// 页头会取一次技能列表；不拦掉的话 jsdom 里没有 fetch，会走到真实请求上。
vi.mock("../api/skill", () => ({ listSkills: skillApiMocks.listSkills }));

beforeEach(() => {
  // 流式会话状态是模块级全局 store（问题 B）：用例之间必须重置回空闲，
  // 否则前一个用例挂起的流会把"发送中"状态漏进后面的用例。
  resetAssistantStreamForTests();
  Object.defineProperty(HTMLElement.prototype, "scrollIntoView", {
    configurable: true,
    value: scrollIntoViewMock,
  });
  scrollIntoViewMock.mockReset();
  apiMocks.listAssistantConversations.mockReset().mockResolvedValue(CONVERSATIONS);
  apiMocks.getAssistantConversation
    .mockReset()
    .mockImplementation((id: number) => Promise.resolve(conversationDetail(id)));
  apiMocks.createAssistantConversation.mockReset().mockResolvedValue(CONVERSATIONS[0]);
  apiMocks.deleteAssistantConversation.mockReset().mockResolvedValue(undefined);
  apiMocks.renameAssistantConversation.mockReset();
  apiMocks.updateAssistantConversation.mockReset().mockImplementation(async (id, patch) => ({
    ...(CONVERSATIONS.find((item) => item.id === id) ?? CONVERSATIONS[0]),
    ...patch,
  }));
  apiMocks.deleteAssistantMessage.mockReset().mockResolvedValue(undefined);
  apiMocks.deleteAssistantMessages.mockReset().mockResolvedValue({ deleted: 0 });
  apiMocks.sendAssistantMessage.mockReset().mockResolvedValue(undefined);
  apiMocks.listJobs.mockReset().mockResolvedValue({ items: [], total: 0 });
  apiMocks.listResumes.mockReset().mockResolvedValue({ items: [], total: 0 });
  skillApiMocks.listSkills.mockReset().mockResolvedValue([]);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
  // 「引导对话已经给过」是持久化标记，用例之间必须清掉，否则先跑的用例会把后跑的挡住。
  window.localStorage.clear();
});

interface StreamCapture {
  onEvent: (event: AssistantStreamEvent) => void;
  signal: AbortSignal;
  /** 结束这次流（resolve 掉 sendAssistantMessage 的 Promise）。 */
  finish: () => void;
}

function captureStream(): StreamCapture[] {
  const capture: StreamCapture[] = [];
  apiMocks.sendAssistantMessage.mockImplementation(
    (
      _id: number,
      _payload: unknown,
      onEvent: (event: AssistantStreamEvent) => void,
      signal: AbortSignal,
    ) => {
      let finishStream: () => void = () => undefined;
      const finished = new Promise<void>((resolve) => {
        finishStream = resolve;
      });
      capture.push({ onEvent, signal, finish: finishStream });
      return finished;
    },
  );
  return capture;
}

async function sendFromComposer(text: string) {
  fireEvent.change(await screen.findByPlaceholderText(/输入求职、岗位/), {
    target: { value: text },
  });
  fireEvent.click(screen.getByRole("button", { name: /发送/ }));
}

/** 带两条历史消息的会话详情（切换会话仍定位到底部的用例用）。 */
function historyDetail(id: number): ReturnType<typeof conversationDetail> {
  const make = (messageId: number, role: "user" | "assistant"): AssistantMessage => ({
    id: messageId,
    conversation_id: id,
    role,
    content: `${role} 消息 ${messageId}`,
    quoted_message_id: null,
    attachments: [],
    context: {},
    status: "complete",
    error: "",
    model: "test-model",
    created_at: CREATED_AT,
  });
  return {
    ...conversationDetail(id),
    messages: [make(id * 10 + 1, "user"), make(id * 10 + 2, "assistant")],
  };
}

describe("流式会话全局化（离场不中断，问题 B）", () => {
  it("切页卸载不中止回答，回到页面后恢复发送中视图", async () => {
    const capture = captureStream();
    const { unmount } = renderPage();
    await sendFromComposer("帮我看看简历");
    await waitFor(() => expect(capture).toHaveLength(1));

    // 卸载：请求不被 abort，事件照常推进。
    unmount();
    expect(capture[0].signal.aborted).toBe(false);
    act(() => capture[0].onEvent({ type: "delta", text: "后台继续生成的回答" }));

    // 回到 /assistant：从全局 store 恢复“发送中”视图（自动选中发送中的会话）。
    renderPage();
    expect(await screen.findByText("后台继续生成的回答")).toBeInTheDocument();

    // 流结束收尾：刷新会话列表与命中会话详情，且不会重新发送。
    const detailCallsBefore = apiMocks.getAssistantConversation.mock.calls.length;
    act(() => capture[0].finish());
    await waitFor(() =>
      expect(apiMocks.getAssistantConversation.mock.calls.length).toBeGreaterThan(
        detailCallsBefore,
      ),
    );
    expect(apiMocks.sendAssistantMessage).toHaveBeenCalledTimes(1);
  });

  it("回答在离场期间结束时，回到页面是干净的草稿态且不再自动发送", async () => {
    const capture = captureStream();
    const { unmount } = renderPage();
    await sendFromComposer("帮我看看简历");
    await waitFor(() => expect(capture).toHaveLength(1));

    unmount();
    act(() => {
      capture[0].onEvent({ type: "delta", text: "离场期间写完的完整回复" });
      capture[0].finish();
    });
    // 离场期间收尾也会刷新列表（发送时捕获的回调兜底）。
    await waitFor(() =>
      expect(apiMocks.listAssistantConversations.mock.calls.length).toBeGreaterThanOrEqual(2),
    );

    renderPage();
    // 流已结束、状态已清空：进来还是普通草稿，看到引导空态而不是流式气泡。
    expect(await screen.findByText("你好，我是投投")).toBeInTheDocument();
    expect(apiMocks.sendAssistantMessage).toHaveBeenCalledTimes(1);
  });
});

describe("流式期间向上滚动（stick-to-bottom，问题 A）", () => {
  it("上翻后 delta 不再拽回底部，出现「回到底部」按钮", async () => {
    const capture = captureStream();
    renderPage();
    await sendFromComposer("看看这个岗位");
    await waitFor(() => expect(capture).toHaveLength(1));

    act(() => capture[0].onEvent({ type: "delta", text: "第一段回答" }));
    await screen.findByText("第一段回答");

    // jsdom 没有布局：手工给出容器尺寸，模拟用户向上滚动离开底部。
    const container = document.querySelector<HTMLElement>(".assistant-messages");
    if (!container) throw new Error("messages scroll container not found");
    Object.defineProperty(container, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 500 });
    container.scrollTop = 800;
    scrollIntoViewMock.mockClear();
    fireEvent.scroll(container);

    // 非吸底：出现「回到底部」，后续 delta 不打扰用户。
    const bottomButton = screen.getByRole("button", { name: "回到底部" });
    act(() => capture[0].onEvent({ type: "delta", text: "，第二段" }));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    // 点击「回到底部」：滚到底并恢复吸底跟随。
    fireEvent.click(bottomButton);
    expect(scrollIntoViewMock).toHaveBeenCalledTimes(1);
    expect(screen.queryByRole("button", { name: "回到底部" })).toBeNull();
    act(() => capture[0].onEvent({ type: "delta", text: "，第三段" }));
    // T02：delta 先进缓冲、按 rAF/setTimeout 合并 flush，吸底跟随发生在 flush 之后。
    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalledTimes(2));

    // 收尾：结束流，避免挂起状态泄漏到后续用例（beforeEach 里也会重置 store）。
    act(() => capture[0].finish());
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: /停\s*止/ })).not.toBeInTheDocument(),
    );
  });

  it("用户上翻查看历史后切换会话，仍定位到底部", async () => {
    apiMocks.getAssistantConversation.mockImplementation((id: number) =>
      Promise.resolve(historyDetail(id)),
    );
    renderPage();
    await openFirstConversation();
    await screen.findByText("user 消息 11");
    scrollIntoViewMock.mockClear();

    const container = document.querySelector<HTMLElement>(".assistant-messages");
    if (!container) throw new Error("messages scroll container not found");
    Object.defineProperty(container, "scrollHeight", { configurable: true, value: 2000 });
    Object.defineProperty(container, "clientHeight", { configurable: true, value: 500 });
    container.scrollTop = 800;
    fireEvent.scroll(container);

    // 主动切换会话：语义是“定位到底部”，不受上翻影响。
    fireEvent.click(screen.getByText("会话二"));
    await screen.findByText("user 消息 21");
    await waitFor(() => expect(scrollIntoViewMock).toHaveBeenCalled());
  });
});
