// SPDX-License-Identifier: Apache-2.0
/**
 * 事实台账页面：列表渲染、占位符高亮、快捷确认、空态与错误态。
 *
 * 重点覆盖"界面会不会把还没核实的内容显示得像已经确认过"——这是这个功能唯一
 * 会造成真实后果的失误（用户照着它投出带【待补】的简历）。
 */
import { App as AntdApp } from "antd";
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import type { Claim, ClaimPageList, ClaimSummary } from "../types";
import ClaimsPage from "./ClaimsPage";

const apiMocks = vi.hoisted(() => ({
  listClaimsPage: vi.fn(),
  getClaim: vi.fn(),
  createClaim: vi.fn(),
  updateClaim: vi.fn(),
  deleteClaim: vi.fn(),
  batchDeleteClaims: vi.fn(),
  getClaimBaseline: vi.fn(),
  draftClaims: vi.fn(),
}));

vi.mock("../api/claims", () => apiMocks);

function makeClaim(overrides: Partial<Claim> = {}): Claim {
  return {
    id: 1,
    title: "检索接口",
    category: "项目经历",
    subject: "校园知识检索平台",
    source_fact: "负责检索接口的实现与联调。",
    candidate_wording: "实现检索接口并联调上线",
    sources: [],
    responsibility_level: "参与",
    verification_status: "待确认",
    allowed_uses: [],
    interview_details: { decisions: [], difficulties: [], verification: [], result: null },
    boundary: "",
    risk_notes: [],
    last_verified: "",
    created_at: "2026-09-18T00:00:00",
    updated_at: "2026-09-18T00:00:00",
    warnings: [],
    ...overrides,
  };
}

/** 分页列表行摘要（GET /api/claims/page）：原文/表述换成 ≤200 字摘要字段。 */
function makeSummary(claim: Claim): ClaimSummary {
  return {
    id: claim.id,
    title: claim.title,
    category: claim.category,
    subject: claim.subject,
    source_fact_excerpt: claim.source_fact,
    candidate_wording_excerpt: claim.candidate_wording,
    responsibility_level: claim.responsibility_level,
    verification_status: claim.verification_status,
    last_verified: claim.last_verified,
    warnings: claim.warnings,
    created_at: claim.created_at,
    updated_at: claim.updated_at,
  };
}

/** 分页端点响应：摘要行 + 全筛选集的 SQL 汇总（与旧端点口径一致）。 */
function makePage(items: Claim[], total = items.length): ClaimPageList {
  return {
    items: items.map(makeSummary),
    total,
    confirmed_count: items.filter((item) => item.verification_status === "已确认").length,
    pending_count: items.filter((item) => item.verification_status === "待确认").length,
    category_counts: {},
  };
}

const EMPTY_BASELINE = {
  confirmed_count: 0,
  baseline_text: "",
  blocked_wording: [],
  warnings: [],
};

function renderPage() {
  // 页面里有指向「开始深挖」的跳转，所以要给它一个 Router 上下文。
  return render(
    <MemoryRouter>
      <AntdApp>
        <ClaimsPage />
      </AntdApp>
    </MemoryRouter>,
  );
}

beforeEach(() => {
  for (const mock of Object.values(apiMocks)) mock.mockReset();
  apiMocks.listClaimsPage.mockResolvedValue(makePage([makeClaim()]));
  // 「标记已确认」与编辑都要先按 id 取全量（分页行只有 ≤200 字摘要）。
  apiMocks.getClaim.mockResolvedValue(makeClaim());
  apiMocks.getClaimBaseline.mockResolvedValue(EMPTY_BASELINE);
});

afterEach(() => {
  cleanup();
});

describe("ClaimsPage", () => {
  it("renders entries with the original fact and the resume wording", async () => {
    apiMocks.listClaimsPage.mockResolvedValue(makePage([makeClaim()]));
    renderPage();

    expect(await screen.findByText("检索接口")).toBeInTheDocument();
    expect(screen.getByText("负责检索接口的实现与联调。")).toBeInTheDocument();
    expect(screen.getByText("实现检索接口并联调上线")).toBeInTheDocument();
  });

  it("highlights placeholders so an unverified wording never looks finished", async () => {
    apiMocks.listClaimsPage.mockResolvedValue(
      makePage([
        makeClaim({
          candidate_wording: "优化了检索速度【待补：具体倍数】",
        }),
      ]),
    );
    const { container } = renderPage();

    await screen.findByText("检索接口");
    const marks = container.querySelectorAll("mark.claim-placeholder");
    expect(marks).toHaveLength(1);
    expect(marks[0].textContent).toBe("【待补：具体倍数】");
  });

  it("shows server-side warnings instead of judging in the browser", async () => {
    apiMocks.listClaimsPage.mockResolvedValue(
      makePage([makeClaim({ warnings: ["待确认的表述没有加【待补】占位符；导出终稿时…"] })]),
    );
    renderPage();

    expect(await screen.findByText(/待确认的表述没有加/)).toBeInTheDocument();
  });

  it("confirms an entry through the API and reloads the baseline", async () => {
    apiMocks.listClaimsPage.mockResolvedValue(makePage([makeClaim()]));
    apiMocks.updateClaim.mockResolvedValue(
      makeClaim({ verification_status: "已确认", warnings: [] }),
    );

    renderPage();
    await screen.findByText("检索接口");
    fireEvent.click(screen.getByRole("button", { name: /标记已确认/ }));

    // 分页行只有摘要：确认前必须先按 id 取全量，否则 claimPayload 会丢字段。
    await waitFor(() => {
      expect(apiMocks.getClaim).toHaveBeenCalledWith(1);
    });
    await waitFor(() => {
      expect(apiMocks.updateClaim).toHaveBeenCalledTimes(1);
    });
    const [, payload] = apiMocks.updateClaim.mock.calls[0];
    expect(payload.verification_status).toBe("已确认");
    // 其余字段必须原样带上，不能因为"只改状态"就把内容清空。
    expect(payload.source_fact).toBe("负责检索接口的实现与联调。");
    await waitFor(() => {
      expect(apiMocks.getClaimBaseline.mock.calls.length).toBeGreaterThan(1);
    });
  });

  it("surfaces the backend rejection when a confirmed entry still has a placeholder", async () => {
    apiMocks.listClaimsPage.mockResolvedValue(makePage([makeClaim()]));
    apiMocks.updateClaim.mockRejectedValue(
      new Error("简历表述里还有「【待补」这样的未完成标记，不能标记为「已确认」"),
    );

    renderPage();
    await screen.findByText("检索接口");
    fireEvent.click(screen.getByRole("button", { name: /标记已确认/ }));

    expect(await screen.findByText(/不能标记为「已确认」/)).toBeInTheDocument();
  });

  it("offers a way in when the ledger is empty", async () => {
    apiMocks.listClaimsPage.mockResolvedValue(makePage([]));
    renderPage();

    expect(await screen.findByText(/台账还是空的/)).toBeInTheDocument();
  });

  it("shows the error state rather than an empty list when loading fails", async () => {
    apiMocks.listClaimsPage.mockRejectedValue(new Error("接口不可用"));
    renderPage();

    expect(await screen.findByText("接口不可用")).toBeInTheDocument();
    // 加载失败时不能再显示"台账还是空的"，否则用户会以为自己没建过条目。
    expect(screen.queryByText(/台账还是空的/)).not.toBeInTheDocument();
  });

  it("offers a way into the drill from the ledger", async () => {
    // 深挖的输入就是台账条目，所以入口必须在这里——否则用户找不到它。
    apiMocks.listClaimsPage.mockResolvedValue(makePage([makeClaim()]));
    renderPage();

    expect(await screen.findByRole("button", { name: /开始深挖/ })).toBeInTheDocument();
  });

  it("passes the chosen filters to the API", async () => {
    apiMocks.listClaimsPage.mockResolvedValue(makePage([]));
    renderPage();
    await waitFor(() => {
      expect(apiMocks.listClaimsPage).toHaveBeenCalledWith(
        { category: "", status: "", keyword: "" },
        1,
        20,
      );
    });
  });

  it("翻到第 2 页按 page=2 重新请求服务端，取到第 21 条", async () => {
    // 服务端分页（RF-08 续）：一页 20 条，翻页时把页码下发 /claims/page。
    const pageOne = Array.from({ length: 20 }, (_, index) =>
      makeClaim({ id: index + 1, title: `条目-${index + 1}` }),
    );
    apiMocks.listClaimsPage
      .mockResolvedValueOnce(makePage(pageOne, 21))
      .mockResolvedValueOnce(makePage([makeClaim({ id: 21, title: "第 21 条" })], 21));
    renderPage();

    expect(await screen.findByText("条目-1")).toBeInTheDocument();
    expect(screen.queryByText("第 21 条")).not.toBeInTheDocument();

    fireEvent.click(screen.getAllByTitle("2")[0]);

    await waitFor(() => {
      expect(apiMocks.listClaimsPage).toHaveBeenLastCalledWith(
        { category: "", status: "", keyword: "" },
        2,
        20,
      );
    });
    expect(await screen.findByText("第 21 条")).toBeInTheDocument();
  });

  it("选择分类筛选后回第 1 页并把参数下发服务端", async () => {
    // 筛选变化必须重置页码：停在第 2 页时选分类，若仍请求 page=2 会漏掉第 1 页的命中。
    const pageOne = Array.from({ length: 20 }, (_, index) =>
      makeClaim({ id: index + 1, title: `条目-${index + 1}` }),
    );
    apiMocks.listClaimsPage
      .mockResolvedValueOnce(makePage(pageOne, 21))
      .mockResolvedValueOnce(makePage([makeClaim({ id: 21, title: "第 21 条" })], 21))
      .mockResolvedValueOnce(makePage([makeClaim({ title: "分类命中" })], 1));
    renderPage();

    expect(await screen.findByText("条目-1")).toBeInTheDocument();
    fireEvent.click(screen.getAllByTitle("2")[0]);
    await screen.findByText("第 21 条");

    fireEvent.mouseDown(screen.getAllByRole("combobox")[0]);
    // 卡片上也有「项目经历」分类 Tag，必须把匹配收窄到下拉选项本身。
    const option = await screen.findByText(
      (content, element) => content === "项目经历" && !!element?.closest(".ant-select-item-option"),
    );
    fireEvent.click(option);

    await waitFor(() => {
      expect(apiMocks.listClaimsPage).toHaveBeenLastCalledWith(
        { category: "项目经历", status: "", keyword: "" },
        1,
        20,
      );
    });
    expect(await screen.findByText("分类命中")).toBeInTheDocument();
  });

  it("批量选择：右键进多选 → 勾 2 条 → 删除所选（直接删，撤销在 Toast）→ 一次批量删除请求带全部 id 并刷新", async () => {
    apiMocks.listClaimsPage.mockResolvedValue(
      makePage([makeClaim(), makeClaim({ id: 2, title: "数据分析流水线" })]),
    );
    apiMocks.batchDeleteClaims.mockResolvedValue({ deleted: 2 });
    renderPage();

    await screen.findByText("检索接口");
    fireEvent.contextMenu(screen.getByText("检索接口"));
    fireEvent.click(await screen.findByRole("menuitem", { name: /批量选择/ }));

    fireEvent.click(screen.getByRole("checkbox", { name: "选择台账条目 检索接口" }));
    fireEvent.click(screen.getByRole("checkbox", { name: "选择台账条目 数据分析流水线" }));
    expect(screen.getByText("已选 2 项")).toBeInTheDocument();

    fireEvent.click(screen.getByRole("button", { name: "删除所选" }));
    // 软删可撤销：不再前置确认，点一下就直接发请求（撤销在 Toast 上）。

    await waitFor(() => {
      expect(apiMocks.batchDeleteClaims).toHaveBeenCalledTimes(1);
    });
    expect(apiMocks.batchDeleteClaims).toHaveBeenCalledWith([1, 2]);
    // 成功后清空选择、刷新列表与统计（列表端点被重新调用）。
    expect(await screen.findByText(/已删除 2 条台账/)).toBeInTheDocument();
    expect(screen.queryByText(/已选/)).not.toBeInTheDocument();
    await waitFor(() => {
      expect(apiMocks.listClaimsPage.mock.calls.length).toBeGreaterThan(1);
    });
  });
});
