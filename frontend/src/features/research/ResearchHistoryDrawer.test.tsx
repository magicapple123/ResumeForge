// SPDX-License-Identifier: Apache-2.0
/**
 * 调研历史抽屉（T07）：列表 → 详情、30 天过时提示、清空的内联二次确认、
 * 以及「重新调研」只回填不提交。
 *
 * 断言文案一律走 `t()`（cjkRatchet 把测试里的中文也算作待迁移文案）；
 * 后端数据（公司名、岗位名）是**数据**，用常量收起来。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { ResearchHistoryDetail, ResearchHistoryPage } from "../../api/research";
import { t } from "../../i18n";
import ResearchHistoryDrawer from "./ResearchHistoryDrawer";

const COMPANY = "腾讯";
const ROLE = "后端开发";

const apiMocks = vi.hoisted(() => ({
  listResearchHistory: vi.fn(),
  getResearchHistory: vi.fn(),
  deleteResearchHistory: vi.fn(),
  clearResearchHistory: vi.fn(),
}));

vi.mock("../../api/research", async (importOriginal) => {
  const actual = await importOriginal<typeof import("../../api/research")>();
  return {
    ...actual,
    listResearchHistory: apiMocks.listResearchHistory,
    getResearchHistory: apiMocks.getResearchHistory,
    deleteResearchHistory: apiMocks.deleteResearchHistory,
    clearResearchHistory: apiMocks.clearResearchHistory,
  };
});

function detail(overrides: Partial<ResearchHistoryDetail> = {}): ResearchHistoryDetail {
  return {
    id: 1,
    company: COMPANY,
    company_raw: COMPANY,
    role: ROLE,
    deep: true,
    status: "ok",
    search_count: 6,
    elapsed_ms: 12_000,
    job_id: null,
    knowledge_entry_id: 9,
    created_at: "2026-11-10T02:00:00",
    jd_excerpt: "岗位职责：写服务",
    jd_hash: "abc",
    brief: {
      status: "ok",
      reason: "",
      markdown: "## 结论\n腾讯主营社交与游戏。",
      sources: [],
      deep: true,
      tool_calls: 0,
      query_terms: 0,
      billed_searches: 0,
      fetched_pages: 0,
      tool_call_budget: 0,
      tool_budget_exceeded: false,
    },
    sources: [],
    cards: [],
    ...overrides,
  };
}

function page(overrides: Partial<ResearchHistoryPage> = {}): ResearchHistoryPage {
  return {
    items: [
      {
        id: 1,
        company: COMPANY,
        company_raw: COMPANY,
        role: ROLE,
        deep: true,
        status: "ok",
        search_count: 6,
        elapsed_ms: 12_000,
        job_id: null,
        knowledge_entry_id: 9,
        created_at: "2026-11-10T02:00:00",
        excerpt: "腾讯主营社交与游戏",
      },
      {
        id: 2,
        company: COMPANY,
        company_raw: COMPANY,
        role: ROLE,
        deep: false,
        status: "failed",
        search_count: 2,
        elapsed_ms: 5_000,
        job_id: null,
        knowledge_entry_id: 9,
        created_at: "2026-11-08T02:00:00",
        excerpt: "上次失败",
      },
    ],
    next_cursor: null,
    total: 2,
    bytes: 2048,
    ...overrides,
  };
}

function renderDrawer(onRerun = vi.fn()) {
  render(
    <MemoryRouter>
      <AntdApp>
        <ResearchHistoryDrawer open company={COMPANY} onClose={() => undefined} onRerun={onRerun} />
      </AntdApp>
    </MemoryRouter>,
  );
  return onRerun;
}

beforeEach(() => {
  apiMocks.listResearchHistory.mockReset();
  apiMocks.getResearchHistory.mockReset();
  apiMocks.deleteResearchHistory.mockReset();
  apiMocks.clearResearchHistory.mockReset();
  apiMocks.listResearchHistory.mockResolvedValue(page());
});

afterEach(() => cleanup());

describe("ResearchHistoryDrawer 列表", () => {
  it("列出每次调研的公司·岗位，并给出总条数与估算体积", async () => {
    renderDrawer();
    expect((await screen.findAllByText(`${COMPANY} · ${ROLE}`)).length).toBe(2);
    expect(
      screen.getByText(t("companyResearch.history.summary", { count: 2, size: "2 KB" })),
    ).toBeTruthy();
  });

  it("清空要二次确认，文案写明知识库最新一条不受影响", async () => {
    renderDrawer();
    fireEvent.click(
      await screen.findByRole("button", { name: t("companyResearch.history.clear") }),
    );

    expect(screen.getByText(t("companyResearch.history.clearBody"))).toBeTruthy();
    expect(apiMocks.clearResearchHistory).not.toHaveBeenCalled();

    fireEvent.click(
      screen.getByRole("button", {
        name: t("companyResearch.history.clearAction", { count: 2 }),
      }),
    );
    await waitFor(() =>
      expect(apiMocks.clearResearchHistory).toHaveBeenCalledWith({ company: COMPANY }),
    );
  });

  it("没有历史时给空态，而不是空白抽屉", async () => {
    apiMocks.listResearchHistory.mockResolvedValue(page({ items: [], total: 0, bytes: 0 }));
    renderDrawer();
    expect(await screen.findByText(t("companyResearch.history.empty"))).toBeTruthy();
  });
});

describe("ResearchHistoryDrawer 详情", () => {
  it("超过 30 天的记录给「可能已过时」提示", async () => {
    const old = detail({ created_at: "2020-01-01T00:00:00" });
    apiMocks.getResearchHistory.mockResolvedValue(old);
    renderDrawer();
    fireEvent.click((await screen.findAllByText(`${COMPANY} · ${ROLE}`))[0]);

    const days = Math.floor(
      (Date.now() - new Date(old.created_at as string).getTime()) / 86_400_000,
    );
    expect(await screen.findByText(t("companyResearch.history.staleDays", { days }))).toBeTruthy();
  });

  it("「重新调研」把这次的输入回传给页面（不自己提交）", async () => {
    const old = detail();
    apiMocks.getResearchHistory.mockResolvedValue(old);
    const onRerun = renderDrawer();
    fireEvent.click((await screen.findAllByText(`${COMPANY} · ${ROLE}`))[0]);

    fireEvent.click(
      await screen.findByRole("button", { name: t("companyResearch.history.rerun") }),
    );
    expect(onRerun).toHaveBeenCalledWith(expect.objectContaining({ id: 1, role: ROLE }));
  });
});
