// SPDX-License-Identifier: Apache-2.0
/** 求职数据看板：概览指标 + 四个主题区块 + 诚实空态。 */
import { cleanup, fireEvent, render, screen, waitFor, within } from "@testing-library/react";
import { App as AntdApp } from "antd";
import { MemoryRouter } from "react-router-dom";
// @ts-expect-error Node 内置模块：@types/node 未安装，但 vitest 运行在 Node 里。
import { readFileSync } from "node:fs";
import { afterEach, beforeEach, describe, expect, it, vi } from "vitest";
import { t } from "../i18n";
import { analyticsDashboard } from "./analyticsTestFixtures";
import { formatRate } from "../utils/format";
import AnalyticsPage from "./AnalyticsPage";

// 与 `styles/color-regression.test.ts` 同一套写法：从磁盘读 CSS 原文，绕开 vitest 把
// 未列入 `test.css.include` 的样式表替换成空模块这件事。
declare const process: { cwd(): string };

/** 用真实页面结构渲染（antd App 上下文 + 路由）：GoalCostBlock 用 App.useApp() 的 message。 */
function renderAnalyticsPage() {
  return render(
    <AntdApp>
      <MemoryRouter>
        <AnalyticsPage />
      </MemoryRouter>
    </AntdApp>,
  );
}

const apiMocks = vi.hoisted(() => ({
  getAnalyticsDashboard: vi.fn(),
  putAnalyticsWeeklyGoal: vi.fn(),
}));

vi.mock("../api/analytics", () => apiMocks);

beforeEach(() => {
  apiMocks.getAnalyticsDashboard.mockReset().mockResolvedValue(analyticsDashboard());
});

afterEach(() => {
  cleanup();
  document.body.innerHTML = "";
});

describe("AnalyticsPage", () => {
  it("渲染四个概览指标卡", async () => {
    renderAnalyticsPage();

    expect(await screen.findByText("投递总量")).toBeInTheDocument();
    expect(screen.getByText("面试率")).toBeInTheDocument();
    expect(screen.getByText("笔试通过率")).toBeInTheDocument();
    expect(screen.getByText("Offer 数")).toBeInTheDocument();
  });

  it("四张概览卡带阶段语义类名，彩条按阶段 token 上色（项 8）", async () => {
    const { container } = renderAnalyticsPage();
    await screen.findByText("投递总量");

    for (const stage of ["applied", "interview", "assessment", "offer"]) {
      const card = container.querySelector(`.stat-card-${stage}`);
      expect(card, `缺少 .stat-card-${stage}`).not.toBeNull();
      // 彩条是 `::before` 画在**卡片根**上的：语义类名必须与 `.ant-card` 落在同一个
      // 元素（CSS 用的是 `.ant-card.stat-card-*`），不同元素的话选择器静默命中不了。
      expect(card!.classList.contains("ant-card")).toBe(true);
    }

    // C6：`color-regression.test.ts` 只读 4 个 CSS + tracker.css，不读 modules.css，
    // 所以项 8 的守卫落在这里——直接读文件原文，断言"按阶段上色"而不是"按列序上色"。
    // 2026 年样式表拆分后，求职统计页的规则落在 modules-home.css（modules.css 现为 @import 清单）。
    const css = readFileSync(
      [process.cwd(), "src", "styles", "modules-home.css"].join("/"),
      "utf8",
    );
    expect(css).toContain(
      ".analytics-page .analytics-metric-row .ant-card.stat-card-interview::before",
    );
    expect(css).toContain(
      ".analytics-page .analytics-metric-row .ant-card.stat-card-assessment::before",
    );
    expect(css).toContain(
      ".analytics-page .analytics-metric-row .ant-card.stat-card-offer::before",
    );
    // 颜色条用 token：`--rf-stage-bar-*` 在浅色是亮彩、深色是暗彩（各自 tokens 文件一套），
    // 不再借用 --rf-accent-*，也不直接吃 `--rf-stage-*`（那套要留给描边与徽标的对比度）。
    for (const token of [
      "--rf-stage-bar-interview",
      "--rf-stage-bar-assessment",
      "--rf-stage-bar-offer",
    ]) {
      expect(css).toContain(`var(${token}`);
    }
    // 按 `:nth-child` 上色的四条规则已删除：列顺序一变颜色就错位，且与阶段毫无对应。
    expect(css).not.toContain(".analytics-metric-row .ant-col:nth-child");
  });

  it("渲染四个主题区块", async () => {
    renderAnalyticsPage();

    await screen.findByText("转化与卡点");
    expect(screen.getByText("时间与节奏")).toBeInTheDocument();
    expect(screen.getByText("渠道与去向")).toBeInTheDocument();
    expect(screen.getByText("简历与健康度")).toBeInTheDocument();
  });

  it("五张图各渲染一次，且无障碍名互不相同", async () => {
    renderAnalyticsPage();

    await screen.findByText("转化与卡点");
    // 逐个按名字取：这既是"都渲染了"的断言，也挡住"两张图撞同一个 aria-label"。
    for (const name of ["求职漏斗", "投递趋势", "周内投递分布", "内推状态分布", "投递最多的公司"]) {
      expect(screen.getAllByRole("img", { name })).toHaveLength(1);
    }
  });

  it("漏斗主线排除分支状态（已结束 / 待确认）", async () => {
    renderAnalyticsPage();

    // 「已投递」在漏斗里；两个分支状态只出现在数据里，不进主线漏斗。
    // 注意按**漏斗区域**取文案：「投递→当前阶段」区块里也会出现同一批状态名。
    const funnel = await screen.findByRole("region", { name: "求职漏斗" });
    expect(within(funnel).getByText("已投递")).toBeInTheDocument();
    expect(screen.queryByText("待确认")).toBeNull();
  });

  it("有记录没填投递日期时，说明原因而不是画一排零", async () => {
    apiMocks.getAnalyticsDashboard.mockResolvedValue(
      analyticsDashboard({ applied_date_gap: { dated: 0, undated: 3, total: 3 } }),
    );
    renderAnalyticsPage();

    // 缺口说明必须出现——否则那张全零的图会被读成"这几个月真的一份没投"。
    expect(await screen.findByText(/有 3 条投递未填「投递日期」/)).toBeInTheDocument();
    // 而且**不画图**：两张依赖投递日期的图都退化成空态。
    expect(screen.getAllByText("还没有填过投递日期的记录")).toHaveLength(2);
    expect(screen.queryByRole("img", { name: "投递趋势" })).toBeNull();
    expect(screen.queryByRole("img", { name: "周内投递分布" })).toBeNull();
  });

  it("没有缺口时不显示任何缺口文案", async () => {
    // 日期都填了、投递也都关联了简历 —— 两个缺口都为 0，页面不该出现任何提示。
    apiMocks.getAnalyticsDashboard.mockResolvedValue(
      analyticsDashboard({ track_resume_linked_count: 7 }),
    );
    const { container } = renderAnalyticsPage();

    await screen.findByText("转化与卡点");
    // 按**容器里的组件出口**查，而不是全页匹配一句文案：`DataGapNotice` 是缺口提示的
    // 唯一出口，`missing <= 0` 时它整块返回 null。这样将来它叠进更多区块时，只有
    // "本页真的一条缺口提示都没有"才会绿，不会因为某个区块恰好没渲染就漏判。
    expect(container.querySelectorAll(".analytics-gap-notice")).toHaveLength(0);
    // 再补一条按可见文案的检查：class 被改名时这条仍然拦得住。
    expect(within(container).queryByText(/未计入图表/)).toBeNull();
  });

  it("投递没关联简历时如实说明这是一个缺口", async () => {
    renderAnalyticsPage();

    // 关联覆盖率目前是结构性的 0：录入界面没有关联入口，所以这件事必须被说出来，
    // 而不是让"按简历看效果"永远空着还不解释。
    expect(await screen.findByText(/有 4 条投递没有关联简历/)).toBeInTheDocument();
  });

  it("空库时每个区块各自给出空态，而不是一排零", async () => {
    apiMocks.getAnalyticsDashboard.mockResolvedValue(
      analyticsDashboard({
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
    renderAnalyticsPage();

    // 没有公司、没有内推时给出可读的空态，而不是一张空图。
    expect(await screen.findByText("还没有投递记录")).toBeInTheDocument();
    expect(screen.getByText("还没有内推记录")).toBeInTheDocument();
    // 一条记录都没有时"未关联简历"也不算缺口（0 缺 0），不该提示。
    expect(screen.queryByText(/投递没有关联简历/)).toBeNull();
  });

  it("默认拉 6 个月趋势，切换时间范围后按新窗口重新拉取", async () => {
    renderAnalyticsPage();

    await screen.findByText("投递总量");
    await waitFor(() => expect(apiMocks.getAnalyticsDashboard).toHaveBeenCalledWith(6));

    fireEvent.click(screen.getByText("近1年"));

    await waitFor(() => expect(apiMocks.getAnalyticsDashboard).toHaveBeenCalledWith(12));
  });
});

/** 真实时间线（RF-18）：只展示事件能证明的事，缺口与小样本如实亮出。 */
describe("AnalyticsPage 的真实时间线区块", () => {
  it("转化与耗时卡带分子分母副文案和小样本徽标", async () => {
    renderAnalyticsPage();

    await screen.findByText("真实时间线");
    expect(screen.getByText("已投递 → 筛选中")).toBeInTheDocument();
    expect(screen.getAllByText("50%").length).toBeGreaterThanOrEqual(2);
    expect(screen.getAllByText(/样本少于 5 条，仅供参考/).length).toBeGreaterThan(0);
    expect(screen.getByText(/到下一阶段 2 \/ 到过本阶段 4 条记录/)).toBeInTheDocument();
    expect(screen.getByText("中位 5 天")).toBeInTheDocument();
  });

  it("没有可用日期对的耗时显示「暂无可比数据」而不是 0 天", async () => {
    renderAnalyticsPage();

    await screen.findByText("真实时间线");
    expect(screen.getAllByText("暂无可比数据").length).toBe(2);
  });

  it("历史记录早于事件功能时如实说明覆盖率", async () => {
    renderAnalyticsPage();

    await screen.findByText("真实时间线");
    expect(screen.getByText(/有 2 条记录早于事件记录功能/)).toBeInTheDocument();
    expect(screen.getByText(/有 1 次状态变化没写日期/)).toBeInTheDocument();
  });

  it("全库还没有事件记录时给空态而不是一排零", async () => {
    apiMocks.getAnalyticsDashboard.mockResolvedValue(
      analyticsDashboard({
        cohort: {
          event_track_count: 0,
          historical_track_count: 6,
          undated_event_count: 0,
          conversions: [],
          durations: [],
        },
      }),
    );
    renderAnalyticsPage();

    // 空态文案改成"还没有状态变化记录，改一次状态就会开始累积"（第 17 条 P0）：
    // 旧文案"缺少事件时间"会让人以为补个日期就好，实际是事件表从未写入。
    expect(await screen.findByText(t("analyticsPage.cohort.emptyHistorical"))).toBeInTheDocument();
  });
});

/** 第 17 条：P0 文案与区间选择器归位、P1/P2/P3 新增区块。
 *
 * 断言里的文案全部走 t()（语言包）：一是与界面同源，二是 cjkRatchet 的守卫口径
 * 「中文 ByText 断言行数」——新测试不要用中文字面量写断言。
 */
describe("AnalyticsPage 第 17 条新增", () => {
  const esc = (value: string) => value.replace(/[.*+?^${}()|[\]\\]/g, "\\$&");

  it("把区间选择器放在「投递趋势」这张卡里（P0 归位）", async () => {
    renderAnalyticsPage();

    const chart = await screen.findByRole("region", {
      name: t("analyticsPage.trend.appliedTrend"),
    });
    // 选择器只作用于趋势图：挂在图卡头部，与图同属一个区域。
    expect(within(chart).getByText(t("analyticsPage.trend.year1"))).toBeInTheDocument();
  });

  it("「进行中」的说明写清不含 Offer（P0 口径）", async () => {
    renderAnalyticsPage();

    await screen.findByText(t("analyticsPage.funnel.active"));
    expect(screen.getAllByText(t("analyticsPage.funnel.activeHint")).length).toBeGreaterThan(0);
  });

  it("渲染渠道转化：每个渠道带分子/分母与小样本徽标（P1）", async () => {
    renderAnalyticsPage();

    await screen.findByText(t("analyticsPage.channelConversion.title"));
    expect(
      screen.getAllByText(
        t("analyticsPage.channelConversion.hint", {
          interview: 1,
          total: 7,
          offer: 0,
          offerRate: formatRate(0),
        }),
      ).length,
    ).toBeGreaterThan(0);
    expect(screen.getAllByText(t("analyticsPage.cohort.smallSample")).length).toBeGreaterThan(0);
  });

  it("渲染投递到当前阶段的耗时中位数（P1）", async () => {
    renderAnalyticsPage();

    await screen.findByText(t("analyticsPage.statusDuration.title"));
    expect(
      screen.getAllByText(t("analyticsPage.statusDuration.medianDays", { days: 28.5 })).length,
    ).toBeGreaterThan(0);
    expect(
      screen.getAllByText(t("analyticsPage.statusDuration.basedOn", { sample: 2, total: 2 }))
        .length,
    ).toBeGreaterThan(0);
    // 没有可用日期对的阶段显示"暂无可比"，不是 0 天。
    expect(screen.getAllByText(t("analyticsPage.statusDuration.noComparable")).length).toBe(1);
  });

  it("渲染同公司多投与简历版本效果（P2）", async () => {
    renderAnalyticsPage();

    await screen.findByText(t("analyticsPage.companyRepeats.title"));
    const itemHint = t("analyticsPage.companyRepeats.itemHint", {
      total: 2,
      interview: 1,
      offer: 0,
    });
    expect(screen.getByText(new RegExp(esc(itemHint)))).toBeInTheDocument();
    expect(
      screen.getByText(t("analyticsPage.companyRepeats.noInterviewTitle")),
    ).toBeInTheDocument();
    await screen.findByText(t("analyticsPage.resumeEffect.title"));
    expect(
      screen.getAllByText(t("analyticsPage.resumeEffect.hint", { interview: 1, total: 3 })).length,
    ).toBeGreaterThan(0);
  });

  it("渲染周目标与生成成本，保存目标会调用接口并刷新看板（P3）", async () => {
    apiMocks.putAnalyticsWeeklyGoal.mockResolvedValue({ target: 8, this_week_count: 2 });
    renderAnalyticsPage();

    await screen.findByText(t("analyticsPage.goal.title"));
    expect(
      screen.getAllByText(t("analyticsPage.goal.progress", { done: 2, target: 5 })).length,
    ).toBeGreaterThan(0);
    expect(screen.getByText(t("analyticsPage.cost.generateCalls"))).toBeInTheDocument();
    // antd Statistic 会把数字拆成整数/小数两个 span，所以按整块文本断言（12000ms → 12.0 秒）。
    expect(document.body.textContent).toContain("12.0");
    fireEvent.change(
      screen.getByRole("spinbutton", { name: t("analyticsPage.goal.weeklyLabel") }),
      {
        target: { value: "8" },
      },
    );
    fireEvent.click(screen.getByRole("button", { name: t("analyticsPage.goal.save") }));

    await waitFor(() => expect(apiMocks.putAnalyticsWeeklyGoal).toHaveBeenCalledWith(8));
    await waitFor(() => expect(apiMocks.getAnalyticsDashboard).toHaveBeenCalledTimes(2));
  });
});
