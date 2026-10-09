import { App as AntdApp } from "antd";
import { act, cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { AssistantMessage } from "../types";
import AssistantPage from "./AssistantPage";
import {
  CONVERSATIONS,
  CREATED_AT,
  conversationDetail,
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

describe("进入助手页 = 一段草稿对话", () => {
  it("一条会话都没有时也不建记录，只显示可立即开写的空态", async () => {
    apiMocks.listAssistantConversations.mockResolvedValue([]);
    renderPage();

    // 引导提示就地渲染（AssistantEmptyState），不需要为它建一条数据库记录。
    expect(await screen.findByText("你好，我是投投")).toBeInTheDocument();
    expect(apiMocks.createAssistantConversation).not.toHaveBeenCalled();
  });

  it("已有会话时也不自动打开最近那条（进来就是新对话）", async () => {
    renderPage();

    expect(await screen.findByText("你好，我是投投")).toBeInTheDocument();
    // 既没打开历史会话，也没新建记录。
    expect(apiMocks.getAssistantConversation).not.toHaveBeenCalled();
    expect(apiMocks.createAssistantConversation).not.toHaveBeenCalled();
  });

  it("treats a failed conversation list as unknown, not as empty", async () => {
    apiMocks.listAssistantConversations.mockRejectedValue(new Error("网络不可用"));

    renderPage();
    await waitFor(() => expect(apiMocks.listAssistantConversations).toHaveBeenCalled());

    // 取不到列表时用户可能其实有一堆会话；按"空"处理会因为一次抖动就多建一条。
    await waitFor(() => expect(apiMocks.createAssistantConversation).not.toHaveBeenCalled());
  });
});

describe("助手深链", () => {
  it("opens the shared conversation", async () => {
    renderPage("/assistant?conversation=2");

    expect(await screen.findByRole("heading", { name: "会话二" })).toBeInTheDocument();
  });

  it("prefills the composer from the ask param without sending it", async () => {
    // 工作台的「找求职助手制作」会带着 ?ask= 跳过来；这里只预填、不自动发送。
    const ask = "帮我新建一个格式模板";
    renderPage(`/assistant?ask=${encodeURIComponent(ask)}`);

    const composer = await screen.findByPlaceholderText("输入求职、岗位、简历或项目经历相关问题");
    expect(composer).toHaveValue(ask);
    // 预填只是一份草稿：不能替用户自动发起一次模型调用。
    await waitFor(() => expect(apiMocks.sendAssistantMessage).not.toHaveBeenCalled());
  });

  it("does not drag the user back after they switch away", async () => {
    let listCalls = 0;
    apiMocks.listAssistantConversations.mockImplementation(() => {
      listCalls += 1;
      // 第二次返回"刷新过的"新数组：既还原真实后端每次返回新对象的做法，
      // 也给出一个可以等待的正信号——新列表真的渲染了。
      return Promise.resolve(
        listCalls === 1
          ? [...CONVERSATIONS]
          : CONVERSATIONS.map((item) => ({ ...item, title: `${item.title}·刷新` })),
      );
    });
    renderPage("/assistant?conversation=2");
    expect(await screen.findByRole("heading", { name: "会话二" })).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "会话一" }));
    expect(await screen.findByRole("heading", { name: "会话一" })).toBeInTheDocument();

    // 触发一次列表刷新（收藏会重新拉列表）。深链若只靠"依赖列表"来判断，
    // 这里就会把用户拽回会话二。
    fireEvent.click(screen.getAllByRole("button", { name: "更多对话操作" })[0]);
    const actionMenu = await waitFor(() => {
      const menu = document.querySelector(".assistant-conversation-actions-menu");
      if (!menu) throw new Error("conversation action menu has not opened");
      return menu;
    });
    fireEvent.click(within(actionMenu as HTMLElement).getByText("收藏对话"));

    // 先等新列表渲染出来（侧栏标题变了）……
    await waitFor(() => expect(screen.getAllByText("会话二·刷新")[0]).toBeInTheDocument());
    // ……再把后续的异步链（effect -> 选中 -> 取详情）跑干净再断言。
    // 只断言一次"标题还是会话一"是不够的：抢焦点发生在 effect 里，晚一拍才生效，
    // 早断言会绿得毫无意义。被抢走的话这里会多出一次会话二的详情请求。
    await act(async () => {
      await new Promise((resolve) => setTimeout(resolve, 0));
      await new Promise((resolve) => setTimeout(resolve, 0));
    });

    expect(apiMocks.getAssistantConversation).toHaveBeenCalledTimes(2);
    expect(screen.getByRole("heading", { name: "会话一" })).toBeInTheDocument();
  });
});

describe("助手新对话入口", () => {
  it("?new=1 进入草稿：不建记录、不恢复最近会话", async () => {
    renderPage("/assistant?new=1");

    expect(await screen.findByText("你好，我是投投")).toBeInTheDocument();
    expect(apiMocks.createAssistantConversation).not.toHaveBeenCalled();
    expect(apiMocks.getAssistantConversation).not.toHaveBeenCalled();
  });

  it("草稿里发出第一条消息时才创建对话记录", async () => {
    apiMocks.createAssistantConversation.mockResolvedValue({ ...CONVERSATIONS[0], id: 99 });
    renderPage("/assistant?new=1");
    await screen.findByText("你好，我是投投");

    // 还没发：一条记录都不该有。
    expect(apiMocks.createAssistantConversation).not.toHaveBeenCalled();

    fireEvent.change(screen.getByPlaceholderText(/输入求职、岗位/), {
      target: { value: "帮我看看简历" },
    });
    fireEvent.click(screen.getByRole("button", { name: /发送/ }));

    // 发了才建，并且消息发到刚建的那条会话上。
    await waitFor(() => expect(apiMocks.createAssistantConversation).toHaveBeenCalledTimes(1));
    await waitFor(() => expect(apiMocks.sendAssistantMessage.mock.calls[0][0]).toBe(99));
  });
});

describe("消息多选删除", () => {
  function message(id: number, role: "user" | "assistant"): AssistantMessage {
    return {
      id,
      conversation_id: 1,
      role,
      content: `${role} 消息 ${id}`,
      quoted_message_id: null,
      attachments: [],
      context: {},
      status: "complete",
      error: "",
      model: "test-model",
      created_at: CREATED_AT,
    };
  }

  function detailWithMessages() {
    return {
      ...conversationDetail(1),
      messages: [message(11, "user"), message(12, "assistant")],
    };
  }

  /** 右键消息气泡，从菜单点「批量选择」（入口已从页头按钮收进右键菜单，R8）。 */
  async function enterSelectingViaContextMenu() {
    fireEvent.contextMenu(screen.getByText("user 消息 11"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));
  }

  it("deletes the checked messages in one request", async () => {
    apiMocks.getAssistantConversation.mockResolvedValue(detailWithMessages());
    renderPage();
    await openFirstConversation();
    await screen.findByText("user 消息 11");

    await enterSelectingViaContextMenu();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 你的这条消息" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 助手的这条消息" }));
    expect(screen.getByText("已选 2 条")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: /删除所选/ }));
    // 删除不可撤销，所以中间要过一次确认弹窗。按钮只在弹窗范围内找：页面上还有一个
    // 「删除所选」也含"删除"二字。antd 会在两个汉字的按钮里插一个空格（"删 除"），
    // 所以按正则匹配。
    const confirmDialog = await screen.findByRole("dialog");
    fireEvent.click(within(confirmDialog).getByRole("button", { name: /删\s*除/ }));

    // 一次请求删完，而不是循环调单条接口——后端在一个事务里删并校验会话归属。
    await waitFor(() => expect(apiMocks.deleteAssistantMessages).toHaveBeenCalledWith(1, [11, 12]));
  });

  it("cannot delete until something is checked", async () => {
    apiMocks.getAssistantConversation.mockResolvedValue(detailWithMessages());
    renderPage();
    await openFirstConversation();
    await screen.findByText("user 消息 11");

    await enterSelectingViaContextMenu();

    expect(screen.getByText("已选 0 条")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: /删除所选/ })).toBeDisabled();
    expect(apiMocks.deleteAssistantMessages).not.toHaveBeenCalled();
  });

  it("offers no multi-select entry for an empty conversation", async () => {
    renderPage();
    await openFirstConversation();
    await waitFor(() => expect(apiMocks.getAssistantConversation).toHaveBeenCalled());

    // 一条消息都没有时"批量选择"无从选起：没有气泡可右键，也没有批量操作条。
    expect(screen.queryByText(/已选 \d+ 条/)).not.toBeInTheDocument();
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });

  it("leaves multi-select when the user switches conversations", async () => {
    apiMocks.getAssistantConversation.mockResolvedValue(detailWithMessages());
    renderPage();
    await openFirstConversation();
    await screen.findByText("user 消息 11");

    await enterSelectingViaContextMenu();
    fireEvent.click(screen.getByRole("checkbox", { name: "选择 你的这条消息" }));
    expect(screen.getByText("已选 1 条")).toBeInTheDocument();

    // 切到另一条会话：勾着的是上一条会话的消息 id，留着会让新会话里 id 相同的消息
    // 出现在"已选"里。
    fireEvent.click(screen.getByText("会话二"));

    await waitFor(() => expect(screen.queryByText("已选 1 条")).not.toBeInTheDocument());
    expect(screen.queryByRole("checkbox")).not.toBeInTheDocument();
  });
});

describe("投投浮窗（compact）", () => {
  function renderFloating() {
    return render(
      <MemoryRouter initialEntries={["/assistant"]}>
        <AntdApp>
          <AssistantPage compact surface="floating" />
        </AntdApp>
      </MemoryRouter>,
    );
  }

  function pasteImage(name: string) {
    const file = new File([new Uint8Array([137, 80, 78, 71])], name, { type: "image/png" });
    return fireEvent.paste(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题"), {
      clipboardData: { items: [{ kind: "file", type: "image/png", getAsFile: () => file }] },
    });
  }

  it("输入框里直接粘贴的截图会变成待发送附件", async () => {
    renderFloating();

    expect(pasteImage("shot.png")).toBe(false);

    expect(await screen.findByAltText("shot.png")).toBeInTheDocument();
    expect(screen.getByRole("button", { name: "移除附件 shot.png" })).toBeInTheDocument();
  });

  it("历史抽屉有背板，点背板或按 Esc 都能关掉", async () => {
    renderFloating();
    const historyButton = screen.getByRole("button", { name: "查看投投历史" });
    expect(historyButton).toHaveAttribute("aria-expanded", "false");

    fireEvent.click(historyButton);

    const backdrop = await screen.findByRole("button", { name: "关闭历史记录" });
    expect(historyButton).toHaveAttribute("aria-expanded", "true");
    fireEvent.click(backdrop);
    await waitFor(() => expect(screen.queryByRole("button", { name: "关闭历史记录" })).toBeNull());

    fireEvent.click(historyButton);
    await screen.findByRole("button", { name: "关闭历史记录" });
    fireEvent.keyDown(window, { key: "Escape" });
    await waitFor(() => expect(screen.queryByRole("button", { name: "关闭历史记录" })).toBeNull());
  });
});
