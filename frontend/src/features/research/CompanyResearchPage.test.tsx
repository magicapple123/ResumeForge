// SPDX-License-Identifier: Apache-2.0
/**
 * 公司与岗位调研页（T07）：
 * 默认深度关闭 / 必填校验 / 卡片字段（站点名·日期·极权威）/ 编号引用可点 /
 * 简报失败但卡片仍在（半成功态）/ 请求失败给重试。
 *
 * 断言文案一律走 `t()`（cjkRatchet 把测试里的中文字面量也算作待迁移文案）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { CompanyResearchResult, ResearchBrief } from "../../api/research";
import { t } from "../../i18n";
import CompanyResearchPage from "./CompanyResearchPage";
import { splitCitations } from "./citations";

const apiMocks = vi.hoisted(() => ({
  researchCompany: vi.fn(),
  // I-21：页面挂载后会读「最近一次调研」，测试里默认"没有"，避免真发请求。
  latestCompanyResearch: vi.fn(() => Promise.resolve({ entry: null, count: 0 })),
  // T07：历史抽屉挂载时才读，默认空列表（历史列表本身由抽屉自己的测试覆盖）。
  listResearchHistory: vi.fn(() =>
    Promise.resolve({ items: [], next_cursor: null, total: 0, bytes: 0 }),
  ),
}));

// 后端返回的中文（卡片标题、失败原因）是**数据**，不是界面文案：它们不进语言包，
// 所以先用常量收起来，断言里只引用常量（cjkRatchet 只数 ByText 参数里的中文）。
const COMPANY = "腾讯";
const SITE_NAME = "腾讯官网";
const OFFICIAL_TITLE = "腾讯控股有限公司 - 官方网站";
const BRIEF_FAILURE = "未配置 DeepSeek Key，无法生成联网简报";
const REQUEST_ERROR = "联网调研超时";
const CARD_SEARCH_FAILURE = "联网搜索服务暂时不可用，请稍后重试";

vi.mock("../../api/research", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/research")>();
  return {
    ...actual,
    researchCompany: apiMocks.researchCompany,
    latestCompanyResearch: apiMocks.latestCompanyResearch,
    listResearchHistory: apiMocks.listResearchHistory,
  };
});

function brief(overrides: Partial<ResearchBrief> = {}): ResearchBrief {
  return {
    status: "ok",
    reason: "",
    markdown: "## 公司概况\n腾讯主营社交与游戏[1]。",
    sources: [
      { number: 1, title: "腾讯官网", url: "https://www.tencent.com/about" },
      { number: 2, title: "财报报道", url: "https://news.example.com/q3" },
    ],
    deep: false,
    tool_calls: 1,
    query_terms: 2,
    billed_searches: 2,
    fetched_pages: 0,
    tool_call_budget: 2,
    tool_budget_exceeded: false,
    ...overrides,
  };
}

function result(overrides: Partial<CompanyResearchResult> = {}): CompanyResearchResult {
  return {
    company: "腾讯",
    role: "后端开发",
    deep: false,
    cards: [
      {
        kind: "official",
        title: OFFICIAL_TITLE,
        url: "https://www.tencent.com/about",
        snippet: "以互联网为基础的科技与文化公司。",
        site_name: SITE_NAME,
        site_icon: "https://www.tencent.com/favicon.ico",
        date: "",
        authority: 5,
        authority_high: true,
      },
      {
        kind: "news",
        title: "腾讯发布上一季度财报",
        url: "https://news.example.com/q3",
        snippet: "营收同比增长。",
        site_name: "财经网",
        site_icon: "",
        date: "2026-11-10",
        authority: 3,
        authority_high: false,
      },
    ],
    brief: brief(),
    sources: brief().sources,
    notes: [],
    usage: {
      deep: false,
      card_queries: 2,
      brief_query_terms: 2,
      brief_tool_calls: 1,
      search_calls: 4,
      tool_call_budget: 2,
      elapsed_ms: 10_600,
    },
    ...overrides,
  };
}

function renderPage() {
  // I-22：页面读 `?company=` 预填并用 Link 跳知识库，必须有 Router 上下文。
  render(
    <MemoryRouter>
      <AntdApp>
        <CompanyResearchPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

async function submitWith(company: string) {
  fireEvent.change(screen.getByTestId("research-company"), { target: { value: company } });
  fireEvent.click(screen.getByTestId("research-submit"));
}

/** antd 会把恰好两个汉字的按钮排成「重 试」，按名字取按钮时要容忍字间空白。 */
function looseName(text: string): RegExp {
  return new RegExp(`^${text.split("").join("\\s*")}$`);
}

beforeEach(() => {
  apiMocks.researchCompany.mockReset();
});

afterEach(() => cleanup());

describe("CompanyResearchPage 输入与默认态", () => {
  it("深度开关默认关闭，并把默认态写在界面上", () => {
    renderPage();
    expect(
      (screen.getByTestId("research-deep") as HTMLInputElement).getAttribute("aria-checked"),
    ).toBe("false");
    expect(screen.getByText(t("companyResearch.deep.defaultOff"))).toBeTruthy();
    expect(screen.getByText(t("companyResearch.deep.hint"))).toBeTruthy();
  });

  it("公司名为空时不发请求，只提示必填", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("research-submit"));
    expect(await screen.findByText(t("companyResearch.error.companyRequired"))).toBeTruthy();
    expect(apiMocks.researchCompany).not.toHaveBeenCalled();
  });

  it("提交时把三个输入和深度开关原样传给接口", async () => {
    apiMocks.researchCompany.mockResolvedValue(result());
    renderPage();
    fireEvent.change(screen.getByTestId("research-company"), { target: { value: " 腾讯 " } });
    fireEvent.change(screen.getByTestId("research-role"), { target: { value: "后端开发" } });
    fireEvent.change(screen.getByTestId("research-jd"), { target: { value: "岗位职责：写服务" } });
    fireEvent.click(screen.getByTestId("research-deep"));
    fireEvent.click(screen.getByTestId("research-submit"));

    await waitFor(() => expect(apiMocks.researchCompany).toHaveBeenCalledTimes(1));
    expect(apiMocks.researchCompany).toHaveBeenCalledWith({
      company: "腾讯",
      role: "后端开发",
      jd: "岗位职责：写服务",
      deep: true,
    });
  });
});

describe("CompanyResearchPage 结果展示", () => {
  it("卡片显示站点名、发布日期与「极权威」标", async () => {
    apiMocks.researchCompany.mockResolvedValue(result());
    renderPage();
    await submitWith("腾讯");

    expect(await screen.findByText(SITE_NAME)).toBeTruthy();
    expect(screen.getByText("2026-11-10")).toBeTruthy();
    // 只有 authority_high 的那张卡才有这个标。
    expect(screen.getAllByText(t("companyResearch.card.authorityBadge"))).toHaveLength(1);
    expect(screen.getByText(t("companyResearch.card.official"))).toBeTruthy();
    expect(screen.getByText(t("companyResearch.card.news"))).toBeTruthy();
  });

  it("简报里的 [1] 是指向后端同号来源的链接", async () => {
    apiMocks.researchCompany.mockResolvedValue(result());
    renderPage();
    await submitWith("腾讯");

    const citation = await screen.findByRole("link", {
      name: t("companyResearch.brief.citationAria", { number: 1 }),
    });
    expect(citation.getAttribute("href")).toBe("https://www.tencent.com/about");
    expect(citation.getAttribute("target")).toBe("_blank");
    expect(screen.getByText(t("companyResearch.brief.sources"))).toBeTruthy();
  });

  it("用量摘要显示搜索次数与耗时，并说明按词条计费", async () => {
    apiMocks.researchCompany.mockResolvedValue(result());
    renderPage();
    await submitWith("腾讯");
    const usage = await screen.findByTestId("research-usage");
    expect(usage.textContent).toContain(
      t("companyResearch.usage.summary", { count: 4, seconds: 11 }),
    );
    expect(usage.textContent).toContain(t("companyResearch.usage.billing"));
  });

  it("简报失败时卡片照常展示，只在简报面板里说原因", async () => {
    apiMocks.researchCompany.mockResolvedValue(
      result({
        brief: brief({
          status: "failed",
          reason: BRIEF_FAILURE,
          markdown: "",
          sources: [],
        }),
        sources: [],
        notes: [CARD_SEARCH_FAILURE],
      }),
    );
    renderPage();
    await submitWith("腾讯");

    expect(await screen.findByText(t("companyResearch.brief.failed"))).toBeTruthy();
    // 失败原因只出现一次（简报面板），notes 里不再重复。
    expect(screen.getAllByText(BRIEF_FAILURE)).toHaveLength(1);
    // A 路已经搜到的资料不能因为 B 路失败而消失。
    expect(screen.getByText(SITE_NAME)).toBeTruthy();
    expect(screen.getByText(t("companyResearch.notes.title"))).toBeTruthy();
  });

  it("请求失败时给错误态与重试按钮", async () => {
    apiMocks.researchCompany.mockRejectedValueOnce(new Error(REQUEST_ERROR));
    renderPage();
    await submitWith("腾讯");

    expect(await screen.findByText(REQUEST_ERROR)).toBeTruthy();
    // antd 会把两个汉字的按钮排成「重 试」，所以按字间允许空白的正则取。
    fireEvent.click(screen.getByRole("button", { name: looseName(t("common.retry")) }));
    await waitFor(() => expect(apiMocks.researchCompany).toHaveBeenCalledTimes(2));
  });
});

describe("CompanyResearchPage 调研历史入口", () => {
  it("右上角「调研历史」打开历史抽屉", async () => {
    renderPage();
    fireEvent.click(screen.getByTestId("research-history-open"));
    // 抽屉里没有历史记录时给空态，而不是一片空白。
    expect(await screen.findByText(t("companyResearch.history.emptyAll"))).toBeTruthy();
  });

  it("「最近一次调研」区域也能打开抽屉", async () => {
    apiMocks.researchCompany.mockResolvedValue(
      result({
        knowledge_entry: {
          id: 7,
          title: `${COMPANY} 调研简报`,
          company: COMPANY,
          reason: "主营社交与游戏",
          updated_at: "2026-11-16T02:00:00",
        },
      }),
    );
    renderPage();
    await submitWith(COMPANY);

    const latest = await screen.findByTestId("research-latest");
    fireEvent.click(
      within(latest).getByRole("button", { name: t("companyResearch.history.viewAll") }),
    );
    // 抽屉带着公司名打开：空态是「这家公司还没有调研历史」。
    expect(await screen.findByText(t("companyResearch.history.empty"))).toBeTruthy();
  });
});

describe("splitCitations", () => {
  it("把编号与文字切成交替的片段，多个编号都认", () => {
    expect(splitCitations("腾讯主营游戏[1]，财报见[2]。")).toEqual([
      "腾讯主营游戏",
      { citation: 1 },
      "，财报见",
      { citation: 2 },
      "。",
    ]);
  });

  it("没有编号时原样返回，纯编号也能切", () => {
    expect(splitCitations("没有引用")).toEqual(["没有引用"]);
    expect(splitCitations("[3]")).toEqual([{ citation: 3 }]);
    expect(splitCitations("")).toEqual([]);
  });
});
