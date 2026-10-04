import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantConversationDetail, AssistantStreamEvent } from "../types";
import { MessageToolCalls } from "../features/assistant/components/AssistantMessageContent";
import {
  CONVERSATIONS,
  conversationDetail,
  deferred,
  openFirstConversation as harnessOpenFirstConversation,
  renderPage,
} from "../test/assistantPageHarness";

// harness 的 openFirstConversation 把 apiMocks 参数化（mock 对象必须留在各测试文件内）；
// 这里包一层，保持原用例的调用形状逐字不变。
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

// 先把真实导出铺开再覆盖要断言的那几个：只列名字的话，页面一旦导入新函数（比如批量删除），
// 这个替身里就没有它，调用处会抛 "is not a function"——而报错指向的是页面代码，很难看出
// 问题出在测试替身上。
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

describe("AssistantPage", () => {
  it("shows conversation management only after opening the more-actions menu", async () => {
    renderPage();
    await screen.findByRole("button", { name: "会话一" });

    expect(screen.queryByRole("button", { name: /重命名/ })).not.toBeInTheDocument();
    fireEvent.click(screen.getAllByRole("button", { name: "更多对话操作" })[0]);
    fireEvent.click(await screen.findByRole("button", { name: /重命名/ }));

    expect(await screen.findByDisplayValue("会话一")).toBeInTheDocument();
  }, 10_000);

  it("keeps the latest conversation when an older detail request finishes late", async () => {
    const firstRequest = deferred<AssistantConversationDetail>();
    apiMocks.getAssistantConversation.mockImplementation((id: number) =>
      id === 1 ? firstRequest.promise : Promise.resolve(conversationDetail(id)),
    );

    renderPage();
    fireEvent.click(await screen.findByRole("button", { name: "会话二" }));

    expect(await screen.findByRole("heading", { name: "会话二" })).toBeInTheDocument();
    firstRequest.resolve(conversationDetail(1));

    await waitFor(() =>
      expect(screen.getByRole("heading", { name: "会话二" })).toBeInTheDocument(),
    );
    expect(screen.queryByRole("heading", { name: "会话一" })).not.toBeInTheDocument();
  });

  it("isolates a streaming reply from a conversation selected while it is running", async () => {
    const stream = deferred<void>();
    let emit: ((event: AssistantStreamEvent) => void) | undefined;
    apiMocks.sendAssistantMessage.mockImplementation(
      async (_id: number, _payload: unknown, onEvent: (event: AssistantStreamEvent) => void) => {
        emit = onEvent;
        onEvent({ type: "progress", message: "正在分析岗位" });
        onEvent({ type: "delta", text: "旧会话回复" });
        onEvent({
          type: "sources",
          sources: [{ title: "招聘官网", url: "https://example.com/job", snippet: "岗位信息" }],
          error: "",
        });
        await stream.promise;
      },
    );

    renderPage();
    await openFirstConversation();
    expect(await screen.findByRole("heading", { name: "会话一" })).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题"), {
      target: { value: "分析这份岗位" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    expect(await screen.findByText("旧会话回复")).toBeInTheDocument();
    expect(screen.queryByRole("link", { name: "招聘官网" })).not.toBeInTheDocument();
    expect(screen.getByText("参考来源（1）")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "会话二" }));
    expect(await screen.findByRole("heading", { name: "会话二" })).toBeInTheDocument();
    expect(screen.queryByText("旧会话回复")).not.toBeInTheDocument();
    emit?.({ type: "delta", text: "仍属于旧会话" });
    expect(screen.queryByText("仍属于旧会话")).not.toBeInTheDocument();

    stream.resolve();
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument(),
    );
    expect(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题")).toBeEnabled();
    expect(screen.getByRole("heading", { name: "会话二" })).toBeInTheDocument();
    expect(apiMocks.getAssistantConversation).toHaveBeenLastCalledWith(2);
  }, 20_000);

  it("prevents duplicate sends and aborts the active request", async () => {
    let signal: AbortSignal | undefined;
    apiMocks.sendAssistantMessage.mockImplementation(
      (
        _id: number,
        _payload: unknown,
        _onEvent: (event: AssistantStreamEvent) => void,
        nextSignal: AbortSignal,
      ) => {
        signal = nextSignal;
        return new Promise<void>((_resolve, reject) => {
          nextSignal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      },
    );

    renderPage();
    await openFirstConversation();
    await waitFor(() => expect(apiMocks.getAssistantConversation).toHaveBeenCalledWith(1));
    fireEvent.change(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题"), {
      target: { value: "请给我建议" },
    });
    const sendButton = screen.getByRole("button", { name: "发送消息" });
    fireEvent.click(sendButton);
    fireEvent.click(sendButton);

    expect(apiMocks.sendAssistantMessage).toHaveBeenCalledOnce();
    fireEvent.click(await screen.findByRole("button", { name: "停止生成" }));
    expect(signal?.aborted).toBe(true);
    await waitFor(() =>
      expect(screen.queryByRole("button", { name: "停止生成" })).not.toBeInTheDocument(),
    );
    expect(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题")).toBeEnabled();
  });

  it("aborts an active stream when the page unmounts", async () => {
    let signal: AbortSignal | undefined;
    apiMocks.sendAssistantMessage.mockImplementation(
      (
        _id: number,
        _payload: unknown,
        _onEvent: (event: AssistantStreamEvent) => void,
        nextSignal: AbortSignal,
      ) => {
        signal = nextSignal;
        return new Promise<void>((_resolve, reject) => {
          nextSignal.addEventListener("abort", () =>
            reject(new DOMException("aborted", "AbortError")),
          );
        });
      },
    );

    const view = renderPage();
    await openFirstConversation();
    await waitFor(() => expect(apiMocks.getAssistantConversation).toHaveBeenCalledWith(1));
    fireEvent.change(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题"), {
      target: { value: "保持连接" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));
    await waitFor(() => expect(apiMocks.sendAssistantMessage).toHaveBeenCalledOnce());

    view.unmount();

    expect(signal?.aborted).toBe(true);
  });

  it("reserves attachment slots while files are still being read", async () => {
    const reads = Array.from({ length: 5 }, () => deferred<string>());
    const textReaders = reads.map((read) => vi.fn(() => read.promise));
    const files = reads.map((_, index) => {
      const file = new File([`content-${index}`], `attachment-${index + 1}.txt`, {
        type: "text/plain",
      });
      Object.defineProperty(file, "text", {
        configurable: true,
        value: textReaders[index],
      });
      return file;
    });

    const view = renderPage();
    fireEvent.change(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题"), {
      target: { value: "分析附件" },
    });
    expect(screen.getByRole("button", { name: "发送消息" })).toBeEnabled();
    fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files },
    });

    await waitFor(() => expect(screen.getByRole("button", { name: "添加附件" })).toBeDisabled());
    expect(screen.getByRole("button", { name: "发送消息" })).toBeDisabled();
    reads.forEach((read) => read.resolve("附件内容"));

    expect(await screen.findByText("attachment-1.txt")).toBeInTheDocument();
    expect(screen.getByText("attachment-4.txt")).toBeInTheDocument();
    expect(screen.queryByText("attachment-5.txt")).not.toBeInTheDocument();
    expect(textReaders[4]).not.toHaveBeenCalled();
  });

  it("rejects a supported MIME type when its filename extension is unsafe", async () => {
    const view = renderPage();
    const disguisedFile = new File(["not executable"], "resume.exe", { type: "text/plain" });

    fireEvent.change(view.container.querySelector('input[type="file"]') as HTMLInputElement, {
      target: { files: [disguisedFile] },
    });

    expect(
      await screen.findByText("附件扩展名与文件类型不一致，或格式不受支持"),
    ).toBeInTheDocument();
    expect(screen.queryByText("resume.exe")).not.toBeInTheDocument();
    expect(apiMocks.sendAssistantMessage).not.toHaveBeenCalled();
  });
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
    expect(screen.queryByText("新增岗位")).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /助手做了什么（1）/ }));
    expect(await screen.findByText("新增岗位")).toBeInTheDocument();
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
