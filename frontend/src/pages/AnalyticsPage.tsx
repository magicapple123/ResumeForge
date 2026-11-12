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
import { Col, Empty, Row, Typography } from "antd";
import PageSkeleton from "../components/common/PageSkeleton";
import ErrorState from "../components/common/ErrorState";
import { useState } from "react";
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

export default function AnalyticsPage() {
  // 本页用模块级 t()：必须订阅语言变化，否则切语言后整页文案不重渲染。
  useLocale();
  const [trendMonths, setTrendMonths] = useState(6);
  const { data, loading, error, reload } = useApi(
    () => getAnalyticsDashboard(trendMonths),
    [trendMonths],
  );

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
          <Typography.Text type="secondary">{t("analyticsPage.subtitle")}</Typography.Text>
        </div>
      </div>

      {loading ? (
        <PageSkeleton rows={8} />
      ) : error ? (
        <ErrorState
          description={t("analyticsPage.loadError", { error })}
          onRetry={() => void reload()}
        />
      ) : !data ? (
        <Empty description={t("analyticsPage.empty.noData")} />
      ) : (
        <AnalyticsBody
          data={data}
          mainFunnel={mainFunnel}
          trendMonths={trendMonths}
          onTrendMonthsChange={setTrendMonths}
          onReload={() => void reload()}
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
  onReload: () => void;
}

function AnalyticsBody({
  data,
  mainFunnel,
  trendMonths,
  onTrendMonthsChange,
  onReload,
}: BodyProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一段不重渲染。
  useLocale();
  return (
    <>
      <OverviewSection data={data} />
      <FunnelSection data={data} mainFunnel={mainFunnel} />
      {/* 第 17 条 P1：渠道转化 + 投递→当前阶段耗时（都不依赖事件表） */}
      <ChannelConversionBlock data={data} />
      <StatusDurationBlock data={data} />
      <CohortSection data={data} />
      <TrendSection
        data={data}
        trendMonths={trendMonths}
        onTrendMonthsChange={onTrendMonthsChange}
      />
      <ChannelsSection data={data} />
      {/* 第 17 条 P2：同公司多投 + 简历版本效果（带样本量） */}
      <CompanyRepeatBlock
        repeats={data.company_repeats.repeats}
        noInterview={data.company_repeats.no_interview}
      />
      <ResumeEffectBlock data={data} />
      {/* 第 17 条 P3：周投递目标 + 生成成本/耗时 */}
      <GoalCostBlock data={data} onSaved={onReload} />
      <ResumeSection data={data} />
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col span={24} />
      </Row>
    </>
  );
}
