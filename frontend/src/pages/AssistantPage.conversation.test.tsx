import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type {
  AssistantConversationBrief,
  AssistantConversationDetail,
  AssistantStreamEvent,
} from "../types";
import { MessageAttachments } from "../features/assistant/components/AssistantMessageContent";
import {
  AssistantMessageContent,
  MessageReasoning,
  MessageSources,
  StreamingStatus,
} from "./AssistantPage";
import {
  CONVERSATIONS,
  CREATED_AT,
  conversationDetail,
  deferred,
  makeSkill,
  openFirstConversation as harnessOpenFirstConversation,
  renderPage,
  renderPageWithLocationProbe,
  watchEmptyState,
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
  it("offers pinned and favorite filters and conversation actions", async () => {
    renderPage();

    await screen.findByRole("button", { name: "会话一" });
    fireEvent.click(screen.getAllByRole("button", { name: "更多对话操作" })[0]);
    const actionMenu = await waitFor(() => {
      const menu = document.querySelector(".assistant-conversation-actions-menu");
      if (!menu) throw new Error("conversation action menu has not opened");
      return menu;
    });
    // 按文案点，不按位置：菜单顺序会变，位置断言会静默指到别的操作上。
    fireEvent.click(within(actionMenu as HTMLElement).getByText("置顶对话"));

    await waitFor(() =>
      expect(apiMocks.updateAssistantConversation).toHaveBeenCalledWith(1, { pinned: true }),
    );
    expect(screen.getByRole("radio", { name: "全部" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "收藏" })).toBeInTheDocument();
    expect(screen.getByRole("radio", { name: "已归档" })).toBeInTheDocument();
  });

  it("offers starter prompts for an empty conversation", async () => {
    renderPage();

    expect(await screen.findByText("你好，我是投投")).toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: "查找招聘信息" }));

    expect(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题")).toHaveValue(
      "请帮我查找与目标方向相关的招聘信息，并优先给出官网链接。",
    );
    expect(screen.getByRole("switch", { name: "联网搜索" })).toBeChecked();
  });

  it("does not flash the empty state while the conversation is still loading", async () => {
    const delayedList = deferred<AssistantConversationBrief[]>();
    apiMocks.listAssistantConversations.mockImplementation(() => delayedList.promise);

    const stopWatching = watchEmptyState();
    renderPage();
    delayedList.resolve(CONVERSATIONS);

    expect(await screen.findByText("你好，我是投投")).toBeInTheDocument();
    // 进来是草稿：不会自动打开最近那条会话（那正是"进来先看到上次对话"的老行为）。
    await waitFor(() => expect(apiMocks.listAssistantConversations).toHaveBeenCalled());
    expect(apiMocks.getAssistantConversation).not.toHaveBeenCalled();

    // 不能出现"先画引导、再被骨架屏顶掉、随后又画回来"——那种闪烁会在这里留下 remove
    // （甚至 remove + add）。草稿态下空态从第一帧就是最终态，所以"没有 remove"才是要钉住的性质；
    // 首次挂载是否被观察器记到 add，取决于 React 首次提交与观察器启动的先后，不该写死。
    const events = stopWatching();
    expect(events.filter((kind) => kind === "remove")).toEqual([]);
    expect(events.length).toBeLessThanOrEqual(1);
  });

  it("shows how many skills are shaping the reply", async () => {
    skillApiMocks.listSkills.mockResolvedValue([
      makeSkill(1, "面试官追问", true),
      makeSkill(2, "简历诊断", true),
      makeSkill(3, "暂时不用", false),
    ]);

    renderPage();

    // 页头那枚常驻提示已经去掉了（截图反馈：右上角不需要技能模块），数量改由输入框
    // 旁的技能按钮承担——它同时也是一键开关的入口。
    // CI 慢机上按钮挂载和技能列表响应都可能超过默认 1s：找到按钮时它可能还在 loading、
    // 文本还是「技能」。两段等待都放宽预算——等的就是正确值出现，就绪即返回不增加耗时。
    const control = await screen.findByRole("button", { name: "技能" }, { timeout: 5000 });
    await waitFor(() => expect(control).toHaveTextContent("技能（2）"), { timeout: 5000 });
    // 没有启用的技能不参与作答，因此不计入数量。
    expect(control).not.toHaveTextContent("3");
  });

  it("takes the user to the workbench that manages skills", async () => {
    // 一个都没启用时，空态里有直达工作台的入口（本次不再走页头那枚提示）。
    renderPageWithLocationProbe();
    fireEvent.click(await screen.findByRole("button", { name: "到技能工作台添加技能" }));

    expect(screen.getByTestId("current-path")).toHaveTextContent("/skills");
  });

  it("tells a first-time user that skills exist", async () => {
    renderPage();

    expect(await screen.findByText("到技能工作台添加技能")).toBeInTheDocument();
  });

  it("keeps loaded messages visible while refreshing the active conversation", async () => {
    const refreshedDetail = deferred<AssistantConversationDetail>();
    const loadedDetail: AssistantConversationDetail = {
      ...conversationDetail(1),
      messages: [
        {
          id: 1,
          conversation_id: 1,
          role: "assistant",
          content: "已加载的回复",
          quoted_message_id: null,
          attachments: [],
          context: {},
          status: "complete",
          error: "",
          model: "test-model",
          created_at: CREATED_AT,
        },
      ],
    };
    let detailRequests = 0;
    apiMocks.getAssistantConversation.mockImplementation(() => {
      detailRequests += 1;
      return detailRequests === 1 ? Promise.resolve(loadedDetail) : refreshedDetail.promise;
    });

    renderPage();
    await openFirstConversation();
    expect(await screen.findByText("已加载的回复")).toBeInTheDocument();
    fireEvent.change(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题"), {
      target: { value: "继续分析" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    await waitFor(() => expect(detailRequests).toBe(2));
    expect(screen.getByText("已加载的回复")).toBeInTheDocument();
    expect(document.querySelector(".assistant-messages .ant-skeleton")).not.toBeInTheDocument();

    refreshedDetail.resolve(loadedDetail);
  });

  it("positions a loaded conversation at the latest message without smooth scrolling", async () => {
    const delayedDetail = deferred<AssistantConversationDetail>();
    apiMocks.getAssistantConversation.mockImplementation(() => delayedDetail.promise);

    renderPage();
    await openFirstConversation();
    await waitFor(() => expect(apiMocks.getAssistantConversation).toHaveBeenCalledWith(1));
    expect(scrollIntoViewMock).not.toHaveBeenCalled();

    delayedDetail.resolve({
      ...conversationDetail(1),
      messages: [
        {
          id: 1,
          conversation_id: 1,
          role: "assistant",
          content: "最新回复",
          quoted_message_id: null,
          attachments: [],
          context: {},
          status: "complete",
          error: "",
          model: "test-model",
          created_at: CREATED_AT,
        },
      ],
    });

    expect(await screen.findByText("最新回复")).toBeInTheDocument();
    await waitFor(() =>
      expect(scrollIntoViewMock).toHaveBeenCalledWith({ behavior: "auto", block: "end" }),
    );
    expect(scrollIntoViewMock).not.toHaveBeenCalledWith(
      expect.objectContaining({ behavior: "smooth" }),
    );
  });

  it("renders assistant Markdown as structured, safe content", () => {
    render(
      <AssistantMessageContent
        content={
          "## 投递建议\n\n**先确认招聘政策**\n- 保留投递记录\n1. 关注官网说明\n查看 [招聘官网](https://careers.example.com/faq)、https://jobs.example.com 与 `冷却期`。"
        }
      />,
    );

    expect(screen.getByRole("heading", { name: "投递建议" })).toBeInTheDocument();
    expect(screen.getByText("先确认招聘政策").tagName).toBe("STRONG");
    expect(screen.getByText("保留投递记录")).toBeInTheDocument();
    expect(screen.getByText("关注官网说明")).toBeInTheDocument();
    expect(screen.getByRole("link", { name: "招聘官网" })).toHaveAttribute(
      "rel",
      "noopener noreferrer",
    );
    expect(screen.getByRole("link", { name: "https://jobs.example.com" })).toHaveAttribute(
      "href",
      "https://jobs.example.com/",
    );
    expect(screen.getByText("冷却期").tagName).toBe("CODE");
  });

  it("renders standard Markdown tables with accessible headers and cells", () => {
    render(
      <AssistantMessageContent content={"| 阶段 | 建议 |\n| --- | --- |\n| 网申 | 关注官网 |"} />,
    );

    expect(screen.getByRole("table")).toBeInTheDocument();
    expect(screen.getByRole("columnheader", { name: "阶段" })).toBeInTheDocument();
    expect(screen.getByRole("cell", { name: "网申" })).toBeInTheDocument();
  });

  it("truncates a long attachment name but keeps the whole one on hover", async () => {
    const longName = "一份名字特别长的参考资料，长到足以把聊天气泡顶变形的那种.txt";
    render(<MessageAttachments attachments={[{ name: longName, kind: "text", data: "正文" }]} />);

    // 截断靠 CSS（标签本身不换行），所以全名必须另有一处能看到。
    const chip = screen.getByText(longName).closest(".assistant-attachment-tag");
    expect(chip).not.toBeNull();

    fireEvent.mouseEnter(chip as HTMLElement);

    expect(await screen.findByRole("tooltip")).toHaveTextContent(longName);
  });

  it("stamps the reply being sent, before the server has a timestamp for it", async () => {
    const stream = deferred<void>();
    apiMocks.sendAssistantMessage.mockImplementation(
      async (_id: number, _payload: unknown, onEvent: (event: AssistantStreamEvent) => void) => {
        onEvent({ type: "progress", message: "正在分析" });
        await stream.promise;
      },
    );

    renderPage();
    fireEvent.change(screen.getByPlaceholderText("输入求职、岗位、简历或项目经历相关问题"), {
      target: { value: "看看这个岗位" },
    });
    fireEvent.click(screen.getByRole("button", { name: "发送消息" }));

    // 这条消息还没写进服务端，没有 created_at；但"什么时候发的"此时就该看得见。
    await screen.findByText("看看这个岗位");
    const stamp = await waitFor(() => {
      const node = document.querySelector(".assistant-message--user .assistant-message-time");
      if (!node) throw new Error("正在发送的气泡没有时间标记");
      return node;
    });
    expect(stamp.textContent).toMatch(/^\d{4}-\d{2}-\d{2} \d{2}:\d{2}$/);

    stream.resolve();
  });

  it("shows an accessible generating status", () => {
    render(<StreamingStatus message="正在生成回答" />);

    expect(screen.getByRole("status")).toHaveTextContent("正在生成回答");
  });

  it("keeps the reasoning collapsed until the user expands it", () => {
    render(<MessageReasoning reasoning="先看看岗位，再对比简历。" />);

    // 默认折叠：不展开就看不到正文，只有「思考过程」这个标题。
    expect(screen.queryByText("先看看岗位，再对比简历。")).not.toBeInTheDocument();
    // 展开后才显示。用 aria-label 定位，避开 antd 对两字中文标签自动插空格的问题。
    const toggle = screen.getByLabelText("思考过程");
    expect(toggle).toBeInTheDocument();
    fireEvent.click(toggle);
    expect(screen.getByText("先看看岗位，再对比简历。")).toBeInTheDocument();
  });

  it("renders nothing when there is no reasoning", () => {
    // 不开思考、或更早存下的历史消息里没有 reasoning 字段时，界面必须和加这个功能之前
    // 完全一致——不能凭空多出一个空面板（安全降级）。
    const { container } = render(<MessageReasoning reasoning="" />);
    expect(container).toBeEmptyDOMElement();
    expect(screen.queryByLabelText("思考过程")).not.toBeInTheDocument();
  });

  it("marks a truncated reasoning so it is not passed off as the whole thing", () => {
    render(<MessageReasoning reasoning="想了一部分…" truncated />);

    fireEvent.click(screen.getByLabelText("思考过程"));
    expect(screen.getByText(/只保留了前一部分/)).toBeInTheDocument();
  });

  it("keeps web sources collapsed until the user expands them", () => {
    render(
      <MessageSources
        sources={[{ title: "招聘官网", url: "https://example.com/job", snippet: "岗位信息" }]}
      />,
    );

    expect(screen.queryByRole("link", { name: "招聘官网" })).not.toBeInTheDocument();
    fireEvent.click(screen.getByRole("button", { name: /参考来源（1）/ }));
    const sourceLink = screen.getByRole("link", { name: "招聘官网" });
    expect(sourceLink).toHaveAttribute("rel", "noopener noreferrer");
    // 外链必须在新标签页打开，否则会把用户从助手页带走、丢掉当前对话上下文。
    expect(sourceLink).toHaveAttribute("target", "_blank");
  });
});
