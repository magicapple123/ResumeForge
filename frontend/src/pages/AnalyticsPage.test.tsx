// SPDX-License-Identifier: Apache-2.0
/** 求职数据看板：概览指标 + 四个主题区块 + 诚实空态。 */
import { cleanup, fireEvent, render, screen, waitFor } from "@testing-library/react";
import { MemoryRouter } from "react-router-dom";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import AnalyticsPage from "./AnalyticsPage";

const apiMocks = vi.hoisted(() => ({ getAnalyticsDashboard: vi.fn() }));

vi.mock("../api/analytics", () => apiMocks);

/** 一份"各字段齐全"的看板：字段与后端 `DashboardOut` 一一对应。 */
function dashboard(overrides: Record<string, unknown> = {}) {
  return {
    total_applications: 7,
    valid_applications: 6,
    interview_count: 2,
    interview_rate: 0.3333,
    assessment_count: 3,
    assessment_to_interview_count: 2,
    assessment_pass_rate: 0.6667,
    offer_count: 1,
    offer_rate: 0.1667,
    funnel: [
      { status: "applied", label: "已投递", count: 1 },
      { status: "screening", label: "筛选中", count: 1 },
      { status: "assessment", label: "测评/笔试", count: 1 },
      { status: "interview", label: "面试", count: 1 },
      { status: "offer", label: "Offer", count: 1 },
      { status: "rejected", label: "已结束", count: 1 },
      { status: "unknown", label: "待确认", count: 1 },
    ],
    trend: [
      { month: "2026-04", label: "4月", count: 0 },
      { month: "2026-05", label: "5月", count: 1 },
      { month: "2026-06", label: "6月", count: 2 },
      { month: "2026-07", label: "7月", count: 1 },
      { month: "2026-08", label: "8月", count: 3 },
      { month: "2026-09", label: "9月", count: 0 },
    ],
    active_count: 4,
    stalled_count: 2,
    no_next_action_count: 1,
    weekday: [
      { key: "0", label: "周一", count: 3 },
      { key: "1", label: "周二", count: 0 },
      { key: "2", label: "周三", count: 0 },
      { key: "3", label: "周四", count: 0 },
      { key: "4", label: "周五", count: 0 },
      { key: "5", label: "周六", count: 0 },
      { key: "6", label: "周日", count: 0 },
    ],
    applied_date_gap: { dated: 7, undated: 0, total: 7 },
    recent_7d_count: 2,
    recent_30d_count: 5,
    reminder_counts: { overdue: 1, soon: 0, upcoming: 0, later: 0, total: 1 },
    top_companies: [
      { key: "甲", label: "甲", count: 3 },
      { key: "乙", label: "乙", count: 2 },
    ],
    other_company_count: 0,
    record_sources: [
      { key: "apply", label: "投递台自动记录", count: 4 },
      { key: "manual", label: "手动添加", count: 3 },
      { key: "recognized", label: "识别导入", count: 0 },
    ],
    referral: { total: 2, converted: 1, rate: 0.5 },
    referral_status: [
      { key: "active", count: 1 },
      { key: "submitted", count: 1 },
      { key: "closed", count: 0 },
      { key: "invalid", count: 0 },
    ],
    cohort: {
      event_track_count: 4,
      historical_track_count: 2,
      undated_event_count: 1,
      conversions: [
        {
          from_status: "applied",
          to_status: "screening",
          numerator: 2,
          denominator: 4,
          rate: 0.5,
          small_sample: false,
        },
        {
          from_status: "screening",
          to_status: "assessment",
          numerator: 1,
          denominator: 2,
          rate: 0.5,
          small_sample: true,
        },
        {
          from_status: "assessment",
          to_status: "interview",
          numerator: 0,
          denominator: 1,
          rate: 0.0,
          small_sample: true,
        },
        {
          from_status: "interview",
          to_status: "offer",
          numerator: 0,
          denominator: 1,
          rate: 0.0,
          small_sample: true,
        },
      ],
      durations: [
        {
          from_status: "applied",
          to_status: "screening",
          numerator: 2,
          denominator: 4,
          median_days: 5.0,
          skipped_negative: 0,
          small_sample: false,
        },
        {
          from_status: "screening",
          to_status: "assessment",
          numerator: 1,
          denominator: 2,
          median_days: 3.0,
          skipped_negative: 0,
          small_sample: true,
        },
        {
          from_status: "assessment",
          to_status: "interview",
          numerator: 0,
          denominator: 1,
          median_days: null,
          skipped_negative: 0,
          small_sample: true,
        },
        {
          from_status: "interview",
          to_status: "offer",
          numerator: 0,
          denominator: 1,
          median_days: null,
          skipped_negative: 0,
          small_sample: true,
        },
      ],
    },
    resume_count: 22,
    resume_scanned_count: 22,
    resume_with_warnings_count: 1,
    resume_with_placeholders_count: 2,
    unverified_claim_count: 1,
    track_resume_linked_count: 3,
    ...overrides,
  };
}

function renderPage() {
  return render(
    <MemoryRouter>
      <AnalyticsPage />
    </MemoryRouter>,
  );
}

beforeEach(() => {
  apiMocks.getAnalyticsDashboard.mockReset().mockResolvedValue(dashboard());
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("AnalyticsPage", () => {
  it("渲染四个概览指标卡", async () => {
    renderPage();

    expect(await screen.findByText("投递总量")).toBeInTheDocument();
    expect(screen.getByText("面试率")).toBeInTheDocument();
    expect(screen.getByText("笔试通过率")).toBeInTheDocument();
    expect(screen.getByText("Offer 数")).toBeInTheDocument();
  });

  it("渲染四个主题区块", async () => {
    renderPage();

    await screen.findByText("转化与卡点");
    expect(screen.getByText("时间与节奏")).toBeInTheDocument();
    expect(screen.getByText("渠道与去向")).toBeInTheDocument();
    expect(screen.getByText("简历与健康度")).toBeInTheDocument();
  });

  it("五张图各渲染一次，且无障碍名互不相同", async () => {
    renderPage();

    await screen.findByText("转化与卡点");
    // 逐个按名字取：这既是"都渲染了"的断言，也挡住"两张图撞同一个 aria-label"。
    for (const name of ["求职漏斗", "投递趋势", "周内投递分布", "内推状态分布", "投递最多的公司"]) {
      expect(screen.getAllByRole("img", { name })).toHaveLength(1);
    }
  });

  it("漏斗主线排除分支状态（已结束 / 待确认）", async () => {
    renderPage();

    // 「已投递」在漏斗里；两个分支状态只出现在数据里，不进主线漏斗。
    expect(await screen.findByText("已投递")).toBeInTheDocument();
    expect(screen.queryByText("待确认")).toBeNull();
  });

  it("有记录没填投递日期时，说明原因而不是画一排零", async () => {
    apiMocks.getAnalyticsDashboard.mockResolvedValue(
      dashboard({ applied_date_gap: { dated: 0, undated: 3, total: 3 } }),
    );
    renderPage();

    // 缺口说明必须出现——否则那张全零的图会被读成"这几个月真的一份没投"。
    expect(await screen.findByText(/有 3 条投递未填「投递日期」/)).toBeInTheDocument();
    // 而且**不画图**：两张依赖投递日期的图都退化成空态。
    expect(screen.getAllByText("还没有填过投递日期的记录")).toHaveLength(2);
    expect(screen.queryByRole("img", { name: "投递趋势" })).toBeNull();
    expect(screen.queryByRole("img", { name: "周内投递分布" })).toBeNull();
  });

  it("没有缺口时不显示任何缺口文案", async () => {
    // 日期都填了、投递也都关联了简历 —— 两个缺口都为 0，页面不该出现任何提示。
    apiMocks.getAnalyticsDashboard.mockResolvedValue(dashboard({ track_resume_linked_count: 7 }));
    renderPage();

    await screen.findByText("转化与卡点");
    expect(screen.queryByText(/未计入下方图表/)).toBeNull();
  });

  it("投递没关联简历时如实说明这是一个缺口", async () => {
    renderPage();

    // 关联覆盖率目前是结构性的 0：录入界面没有关联入口，所以这件事必须被说出来，
    // 而不是让"按简历看效果"永远空着还不解释。
    expect(await screen.findByText(/有 4 条投递没有关联简历/)).toBeInTheDocument();
  });

  it("空库时每个区块各自给出空态，而不是一排零", async () => {
    apiMocks.getAnalyticsDashboard.mockResolvedValue(
      dashboard({
        total_applications: 0,
        valid_applications: 0,
        interview_count: 0,
        offer_count: 0,
        active_count: 0,
        stalled_count: 0,
        no_next_action_count: 0,
        applied_date_gap: { dated: 0, undated: 0, total: 0 },
        top_companies: [],
        referral: { total: 0, converted: 0, rate: 0.0 },
        referral_status: [
          { key: "active", count: 0 },
          { key: "submitted", count: 0 },
          { key: "closed", count: 0 },
          { key: "invalid", count: 0 },
        ],
        track_resume_linked_count: 0,
      }),
    );
    renderPage();

    // 没有公司、没有内推时给出可读的空态，而不是一张空图。
    expect(await screen.findByText("还没有投递记录")).toBeInTheDocument();
    expect(screen.getByText("还没有内推记录")).toBeInTheDocument();
    // 一条记录都没有时"未关联简历"也不算缺口（0 缺 0），不该提示。
    expect(screen.queryByText(/投递没有关联简历/)).toBeNull();
  });

  it("默认拉 6 个月趋势，切换时间范围后按新窗口重新拉取", async () => {
    renderPage();

    await screen.findByText("投递总量");
    await waitFor(() => expect(apiMocks.getAnalyticsDashboard).toHaveBeenCalledWith(6));

    fireEvent.click(screen.getByText("近1年"));

    await waitFor(() => expect(apiMocks.getAnalyticsDashboard).toHaveBeenCalledWith(12));
  });
});

/** 真实时间线（RF-18）：只展示事件能证明的事，缺口与小样本如实亮出。 */
describe("AnalyticsPage 的真实时间线区块", () => {
  it("转化与耗时卡带分子分母副文案和小样本徽标", async () => {
    renderPage();

    await screen.findByText("真实时间线");
    expect(screen.getByText("已投递 → 筛选中")).toBeInTheDocument();
    expect(screen.getAllByText("50%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/样本少于 5 条，仅供参考/).length).toBeGreaterThan(0);
    expect(screen.getByText(/到下一阶段 2 \/ 到过本阶段 4 条记录/)).toBeInTheDocument();
    expect(screen.getByText("中位 5 天")).toBeInTheDocument();
  });

  it("没有可用日期对的耗时显示「暂无可比数据」而不是 0 天", async () => {
    renderPage();

    await screen.findByText("真实时间线");
    expect(screen.getAllByText("暂无可比数据").length).toBe(2);
  });

  it("历史记录早于事件功能时如实说明覆盖率", async () => {
    renderPage();

    await screen.findByText("真实时间线");
    expect(screen.getByText(/有 2 条记录早于事件记录功能/)).toBeInTheDocument();
    expect(screen.getByText(/有 1 次状态变化没写日期/)).toBeInTheDocument();
  });

  it("全库还没有事件记录时给空态而不是一排零", async () => {
    apiMocks.getAnalyticsDashboard.mockResolvedValue(
      dashboard({
        cohort: {
          event_track_count: 0,
          historical_track_count: 6,
          undated_event_count: 0,
          conversions: [],
          durations: [],
        },
      }),
    );
    renderPage();

    expect(await screen.findByText(/现有 6 条进度记录早于事件记录功能/)).toBeInTheDocument();
  });
});
