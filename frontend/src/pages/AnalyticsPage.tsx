// SPDX-License-Identifier: Apache-2.0
/** 求职数据看板（R-14）：概览指标 + 主题区块 + 第 17 条新增的四块指标。
 *
 * 数据全部来自后端 /api/analytics/dashboard，前端只做展示。图表用自绘 SVG
 * （FunnelChart / BarChart / HorizontalBarChart），不引 echarts / antv / plots。
 * 每个指标的口径见 backend/app/services/analytics.py 的模块 docstring——那里也写明了
 * 因数据模型不支持而**刻意不提供**的指标，别再提。
 *
 * 三条贯穿全页的约束：
 *
 * 1. **不许画会撒谎的零**：趋势图与周内分布只统计填了「投递日期」的记录；若一条都没有，
 *    画一排零轴会被读成"这几个月真的一份没投"。所以：有缺口就显示 DataGapNotice 说明
 *    原因，整张图没有输入就显示空态而不是零轴。
 * 2. **每张图的 aria-label 必须互不相同**，否则读屏软件与测试都分不清是哪张图。
 * 3. **比率必须带分子/分母**：12 条样本下任何百分比都不可靠，small_sample 徽标与
 *    "N / M"副文案是诚实的一部分（第 17 条验收红线）。
 *
 * 第 17 条（2026-11-10）把既有区块拆到 features/analytics/AnalyticsSections.tsx，
 * 页面只保留编排与加载态——本文件已接近 500 行预算，不要再往里塞展示逻辑。
 */
import { Button, Space, Typography } from "antd";
import PageSkeleton from "../components/common/PageSkeleton";
import ErrorState from "../components/common/ErrorState";
import { useState } from "react";
import AnalyticsNav from "../features/analytics/AnalyticsNav";
import { formatServerTime } from "../utils/serverTime";
import { downloadDashboardCsv } from "../features/analytics/exportCsv";
import { getAnalyticsDashboard } from "../api/analytics";
import ChannelConversionBlock from "../features/analytics/ChannelConversionBlock";
import CompanyRepeatBlock from "../features/analytics/CompanyRepeatBlock";
import GoalCostBlock from "../features/analytics/GoalCostBlock";
import ResumeEffectBlock from "../features/analytics/ResumeEffectBlock";
import StatusDurationBlock from "../features/analytics/StatusDurationBlock";
import {
  ChannelsSection,
  CohortSection,
  FunnelSection,
  OverviewSection,
  ResumeSection,
  TrendSection,
} from "../features/analytics/AnalyticsSections";
import { useApi } from "../hooks/useApi";
import { FUNNEL_STATUSES } from "../types";
import type { AnalyticsDashboard, FunnelStage } from "../types";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import EmptyState from "../components/common/EmptyState";

/**
 * UI 最大档位 = 一次取满的月数（T13）。
 *
 * 档位切换是**纯前端切片**：原先 `trendMonths` 进依赖数组，每切一次就整页重载一次
 * （骨架屏闪一下、所有卡片重新挂载、服务端重算全表）。现在只取一次 12 个月，
 * `TrendSection` 里 `slice(-trendMonths)`。两者必须同源——加档位时同时改这里。
 */
const MAX_TREND_MONTHS = 12;

export default function AnalyticsPage() {
  // 本页用模块级 t()：必须订阅语言变化，否则切语言后整页文案不重渲染。
  useLocale();
  const [trendMonths, setTrendMonths] = useState(6);
  const { data, loading, error, reload, setData } = useApi(
    () => getAnalyticsDashboard(MAX_TREND_MONTHS),
    [],
  );
  // 保存周目标后就地合并：目标值只影响这一张卡，没必要把整页重取一遍。
  const handleGoalSaved = (target: number) => {
    if (!data) return;
    setData({ ...data, weekly_goal: { ...data.weekly_goal, target } });
  };

  // 漏斗主线：只画推进主线（已投递→筛选中→测评/笔试→面试→Offer），
  // 「已结束」「待确认」属于分支，不在主线漏斗里，但后端仍会下发其计数。
  const mainFunnel = (data?.funnel ?? []).filter((stage) =>
    (FUNNEL_STATUSES as readonly string[]).includes(stage.status),
  );

  return (
    <div className="analytics-page">
      <div className="profile-page-header">
        <div>
          <Typography.Title level={3} style={{ margin: 0 }}>
            {t("analyticsPage.title")}
          </Typography.Title>
          <Typography.Text type="secondary">
            {data
              ? t("analyticsPage.updatedAt", {
                  time: formatServerTime(data.generated_at, { timeOnly: true }),
                })
              : t("analyticsPage.subtitle")}
          </Typography.Text>
        </div>
        <Space>
          {/* 有数据时的刷新是**轻量**的：不撤内容、不闪骨架，只在按钮上转圈。 */}
          <Button onClick={() => void reload()} loading={loading} disabled={!data}>
            {t("analyticsPage.refresh")}
          </Button>
          <Button
            disabled={!data}
            onClick={() => {
              if (data) downloadDashboardCsv(data, data.generated_at.slice(0, 10));
            }}
          >
            {t("analyticsPage.exportCsv")}
          </Button>
        </Space>
      </div>

      {/* 渲染门：**有数据就渲染内容**，刷新中不把整页换回骨架（那会让正在看的区块闪一下）。 */}
      {!data ? (
        loading ? (
          <PageSkeleton rows={8} />
        ) : error ? (
          <ErrorState
            description={t("analyticsPage.loadError", { error })}
            onRetry={() => void reload()}
          />
        ) : (
          <EmptyState description={t("analyticsPage.empty.noData")} />
        )
      ) : (
        <AnalyticsBody
          data={data}
          mainFunnel={mainFunnel}
          trendMonths={trendMonths}
          onTrendMonthsChange={setTrendMonths}
          onGoalSaved={handleGoalSaved}
        />
      )}
    </div>
  );
}

interface BodyProps {
  data: AnalyticsDashboard;
  mainFunnel: FunnelStage[];
  trendMonths: number;
  onTrendMonthsChange: (value: number) => void;
  onGoalSaved: (target: number) => void;
}

function AnalyticsBody({
  data,
  mainFunnel,
  trendMonths,
  onTrendMonthsChange,
  onGoalSaved,
}: BodyProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一段不重渲染。
  useLocale();
  return (
    <>
      <AnalyticsNav />
      {/* 每一段都带 id：导航靠 `scrollIntoView` + `IntersectionObserver` 定位。
          id 与 `ANALYTICS_SECTIONS` 必须一一对应，改一处要改两处。 */}
      <div id="analytics-overview" className="analytics-section">
        <OverviewSection data={data} />
      </div>
      <div id="analytics-funnel" className="analytics-section">
        <FunnelSection data={data} mainFunnel={mainFunnel} />
      </div>
      {/* 第 17 条 P1：渠道转化 + 投递→当前阶段耗时（都不依赖事件表） */}
      <div id="analytics-channel" className="analytics-section">
        <ChannelConversionBlock data={data} />
      </div>
      <div id="analytics-duration" className="analytics-section">
        <StatusDurationBlock data={data} />
      </div>
      <div id="analytics-cohort" className="analytics-section">
        <CohortSection data={data} />
      </div>
      <div id="analytics-trend" className="analytics-section">
        <TrendSection
          data={data}
          trendMonths={trendMonths}
          onTrendMonthsChange={onTrendMonthsChange}
        />
      </div>
      <div id="analytics-channels" className="analytics-section">
        <ChannelsSection data={data} />
      </div>
      {/* 第 17 条 P2：同公司多投 + 简历版本效果（带样本量） */}
      <div id="analytics-repeat" className="analytics-section">
        <CompanyRepeatBlock
          repeats={data.company_repeats.repeats}
          noInterview={data.company_repeats.no_interview}
        />
      </div>
      <div id="analytics-resume-effect" className="analytics-section">
        <ResumeEffectBlock data={data} />
      </div>
      {/* 第 17 条 P3：周投递目标 + 生成成本/耗时 */}
      <div id="analytics-goal" className="analytics-section">
        <GoalCostBlock data={data} onSaved={onGoalSaved} />
      </div>
      <div id="analytics-resume" className="analytics-section">
        <ResumeSection data={data} />
      </div>
    </>
  );
}
