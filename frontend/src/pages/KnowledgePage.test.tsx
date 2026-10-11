/**
 * 知识库页面：列表渲染、筛选、新建、编辑、删除确认与 Markdown 预览。
 *
 * 删除走 RowActions 的「更多」菜单 + 二次确认（modal.confirm），编辑/删除用图标按钮而非裸文字。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Knowledge, KnowledgeSummary } from "../types";
import KnowledgePage from "./KnowledgePage";

const apiMocks = vi.hoisted(() => ({
  listKnowledgePage: vi.fn(),
  listKnowledgeCategories: vi.fn(),
  listKnowledgeTags: vi.fn(),
  getKnowledge: vi.fn(),
  createKnowledge: vi.fn(),
  updateKnowledge: vi.fn(),
  deleteKnowledge: vi.fn(),
}));

vi.mock("../api/knowledge", () => apiMocks);

function makeKnowledge(overrides: Partial<Knowledge> = {}): Knowledge {
  return {
    id: 1,
    title: "STAR 法则",
    category: "简历技巧",
    tags: ["简历", "STAR"],
    content: "# 核心要点\n\n用 **STAR 法则** 组织经历，给出**量化结果**。",
    source: "手动录入",
    created_at: "2026-09-18T00:00:00",
    updated_at: "2026-09-18T00:00:00",
    ...overrides,
  };
}

/** 列表行摘要（分页端点响应）：与 Knowledge 的差别是没有 content 全文。 */
function makeSummary(entry: Knowledge): KnowledgeSummary {
  const { content, ...rest } = entry;
  return { ...rest, content_excerpt: content.slice(0, 200) };
}

function makePage(items: Knowledge[], total = items.length) {
  return { items: items.map(makeSummary), total };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AntdApp>
        <KnowledgePage />
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  apiMocks.listKnowledgePage.mockResolvedValue(makePage([makeKnowledge()]));
  apiMocks.getKnowledge.mockResolvedValue(makeKnowledge());
  apiMocks.listKnowledgeCategories.mockResolvedValue(["面经", "简历技巧", "求职策略"]);
  apiMocks.listKnowledgeTags.mockResolvedValue({ tags: ["简历", "STAR", "求职策略"] });
  apiMocks.createKnowledge.mockImplementation(async (payload) =>
    makeKnowledge({ id: 2, ...payload, tags: payload.tags }),
  );
  apiMocks.updateKnowledge.mockImplementation(async (id, payload) =>
    makeKnowledge({ id, ...payload }),
  );
  apiMocks.deleteKnowledge.mockResolvedValue(undefined);
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("KnowledgePage", () => {
  it("renders entries with title, category and tags", async () => {
    renderPage();

    expect(await screen.findByText("STAR 法则")).toBeInTheDocument();
    expect(screen.getByText("简历技巧")).toBeInTheDocument();
    expect(screen.getByText("简历")).toBeInTheDocument();
    expect(screen.getByText("STAR")).toBeInTheDocument();
    expect(apiMocks.listKnowledgePage).toHaveBeenCalledWith(
      { q: "", category: "", tag: "" },
      1,
      12,
    );
  });

  it("passes the search keyword to the API", async () => {
    renderPage();
    await screen.findByText("STAR 法则");

    const searchInput = screen.getByPlaceholderText("搜索标题或正文");
    fireEvent.change(searchInput, { target: { value: "量化" } });
    fireEvent.keyDown(searchInput, { key: "Enter", code: "Enter", keyCode: 13 });

    await waitFor(() => {
      expect(apiMocks.listKnowledgePage).toHaveBeenLastCalledWith(
        { q: "量化", category: "", tag: "" },
        1,
        12,
      );
    });
  });

  it("标签筛选走服务端：选择标签后带 tag 参数重新请求并回到第 1 页", async () => {
    // 收口轮：标签从「当前页内再筛选」改为服务端筛选（分页前过滤）。
    // 先翻到第 2 页，再选标签——应回第 1 页并以 tag 重新拉取。
    const pageOne = Array.from({ length: 12 }, (_, index) =>
      makeKnowledge({ id: index + 1, title: `条目-${index + 1}` }),
    );
    apiMocks.listKnowledgePage
      .mockResolvedValueOnce(makePage(pageOne, 13))
      .mockResolvedValueOnce(makePage([makeKnowledge({ id: 13, title: "第 13 条" })], 13))
      .mockResolvedValueOnce(makePage([makeKnowledge({ title: "标签命中" })], 1));
    renderPage();

    expect(await screen.findByText("条目-1")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("2")[0]);
    expect(await screen.findByText("第 13 条")).toBeInTheDocument();

    const combobox = screen.getByRole("combobox", { name: "标签筛选" });
    fireEvent.mouseDown(combobox);
    const option = await screen.findByText(
      (content, element) => content === "简历" && !!element?.closest(".ant-select-item-option"),
    );
    fireEvent.click(option);

    await waitFor(() => {
      expect(apiMocks.listKnowledgePage).toHaveBeenLastCalledWith(
        { q: "", category: "", tag: "简历" },
        1,
        12,
      );
    });
    expect(await screen.findByText("标签命中")).toBeInTheDocument();
  });

  it("标签下拉选项来自全库标签端点 /knowledge/tags，而非当前页条目的标签", async () => {
    // 「全库专属标签」不属于当前页任何条目（列表里只有 简历/STAR/求职策略 的条目），
    // 只有选项来自 listKnowledgeTags 时它才会出现在下拉里。
    apiMocks.listKnowledgeTags.mockResolvedValue({
      tags: ["简历", "STAR", "求职策略", "全库专属标签"],
    });
    renderPage();
    await screen.findByText("STAR 法则");

    fireEvent.mouseDown(screen.getByRole("combobox", { name: "标签筛选" }));
    expect(
      await screen.findByText(
        (content, element) =>
          content === "全库专属标签" && !!element?.closest(".ant-select-item-option"),
      ),
    ).toBeInTheDocument();
  });

  it("creates a new entry through the form modal", async () => {
    renderPage();
    await screen.findByText("STAR 法则");

    fireEvent.click(screen.getByRole("button", { name: /新增知识/ }));
    fireEvent.change(screen.getByPlaceholderText("如：STAR 法则 / 自我介绍模板"), {
      target: { value: "自我介绍模板" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => {
      expect(apiMocks.createKnowledge).toHaveBeenCalledTimes(1);
    });
    const payload = apiMocks.createKnowledge.mock.calls[0][0];
    expect(payload.title).toBe("自我介绍模板");
    expect(payload.category).toBe("其他"); // 未改分类时使用表单默认值
  });

  it("edits an entry through the row menu", async () => {
    renderPage();
    await screen.findByText("STAR 法则");

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("编辑"));

    // 行操作菜单渲染在 portal 里，点击曾沿 React 树冒泡回卡片的 DetailTrigger，
    // 把详情预览一起弹出来；「编辑」只应打开编辑弹窗。
    expect(screen.queryByRole("heading", { name: "核心要点" })).toBeNull();

    fireEvent.change(await screen.findByPlaceholderText("如：STAR 法则 / 自我介绍模板"), {
      target: { value: "STAR 法则（修订）" },
    });
    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => {
      expect(apiMocks.updateKnowledge).toHaveBeenCalledTimes(1);
    });
    const [id, payload] = apiMocks.updateKnowledge.mock.calls[0];
    expect(id).toBe(1);
    expect(payload.title).toBe("STAR 法则（修订）");
  });

  it("编辑态改选另一个分类能生效", async () => {
    renderPage();
    await screen.findByText("STAR 法则");

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("编辑"));

    // 编辑弹窗里的「分类」下拉（tags 模式）：曾因 maxCount={1} 把所有未选中项
    // 置灰禁用，导致改选不了其他分类；现在点「求职策略」应正常选中。
    const modal = (await screen.findByText("编辑条目：STAR 法则")).closest(".ant-modal")!;
    const categorySelect = within(modal as HTMLElement)
      // 弹窗里分类在前、标签在后。
      .getAllByRole("combobox")[0];
    fireEvent.mouseDown(categorySelect);
    fireEvent.click(await screen.findByText("求职策略"));

    fireEvent.click(screen.getByRole("button", { name: /保\s*存/ }));

    await waitFor(() => {
      expect(apiMocks.updateKnowledge).toHaveBeenCalledTimes(1);
    });
    const [, payload] = apiMocks.updateKnowledge.mock.calls[0];
    expect(payload.category).toBe("求职策略");
  });

  it("renders markdown content in the preview modal", async () => {
    renderPage();
    await screen.findByText("STAR 法则");

    fireEvent.click(screen.getByRole("button", { name: /查\s*看/ }));

    // AssistantMessageContent 把「# 核心要点」解析成 h4，而不是显示原始井号。
    expect(await screen.findByRole("heading", { name: "核心要点" })).toBeInTheDocument();
    // 正文里的加粗被解析成 <strong>。
    expect(screen.getByText("量化结果").tagName).toBe("STRONG");
  });

  it("deletes an entry after confirmation", async () => {
    renderPage();
    await screen.findByText("STAR 法则");

    fireEvent.click(screen.getByRole("button", { name: "更多操作" }));
    fireEvent.click(await screen.findByText("删除"));

    // 二次确认弹窗出现，确认后才真正调用删除。
    const confirmations = await screen.findAllByText("删除条目「STAR 法则」？");
    expect(confirmations.length).toBeGreaterThan(0);
    fireEvent.click(screen.getByRole("button", { name: "OK" }));

    await waitFor(() => {
      expect(apiMocks.deleteKnowledge).toHaveBeenCalledWith(1);
    });
  });

  it("shows the empty state when there are no entries", async () => {
    apiMocks.listKnowledgePage.mockResolvedValue({ items: [], total: 0 });
    renderPage();

    expect(await screen.findByText(/知识库还是空的/)).toBeInTheDocument();
  });

  it("翻到第 2 页取到旧全量之外的新页记录", async () => {
    const pageOne = Array.from({ length: 12 }, (_, index) =>
      makeKnowledge({ id: index + 1, title: `条目-${index + 1}` }),
    );
    apiMocks.listKnowledgePage
      .mockResolvedValueOnce(makePage(pageOne, 13))
      .mockResolvedValueOnce(makePage([makeKnowledge({ id: 13, title: "第 13 条" })], 13));
    renderPage();

    expect(await screen.findByText("条目-1")).toBeInTheDocument();
    expect(screen.queryByText("第 13 条")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("2")[0]);

    await waitFor(() => {
      expect(apiMocks.listKnowledgePage).toHaveBeenLastCalledWith(
        { q: "", category: "", tag: "" },
        2,
        12,
      );
    });
    expect(await screen.findByText("第 13 条")).toBeInTheDocument();
  });
});
