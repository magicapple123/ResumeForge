// SPDX-License-Identifier: Apache-2.0
/** 求职数据看板（R-14）：概览指标 + 四个主题区块。
 *
 * 数据全部来自后端 `/api/analytics/dashboard`，前端只做展示。图表用自绘 SVG
 * （`FunnelChart` / `BarChart` / `HorizontalBarChart`），不引 echarts / antv / plots。
 * 每个指标的口径见 `backend/app/services/analytics.py` 的模块 docstring——那里也写明了
 * 因数据模型不支持而**刻意不提供**的指标，别再提。
 *
 * 两条贯穿全页的约束：
 *
 * 1. **不许画会撒谎的零**。趋势图与周内分布只统计填了「投递日期」的记录；若一条都没有，
 *    画一排零轴会被读成"这几个月真的一份没投"。所以：有缺口就显示 `DataGapNotice` 说明
 *    原因，整张图没有输入就显示空态而不是零轴。
 * 2. **每张图的 `aria-label` 必须互不相同**，否则读屏软件与测试都分不清是哪张图。
 */
import { Col, Empty, Row, Segmented, Typography } from "antd";
import PageSkeleton from "../components/common/PageSkeleton";
import ErrorState from "../components/common/ErrorState";
import { useState } from "react";
import { Link } from "react-router-dom";
import { getAnalyticsDashboard } from "../api/analytics";
import BarChart from "../components/analytics/BarChart";
import ChartBlock from "../components/analytics/ChartBlock";
import DataGapNotice from "../components/analytics/DataGapNotice";
import FunnelChart from "../components/analytics/FunnelChart";
import HorizontalBarChart from "../components/analytics/HorizontalBarChart";
import SectionCard from "../components/analytics/SectionCard";
import StatCard from "../components/analytics/StatCard";
import { useApi } from "../hooks/useApi";
import { FUNNEL_STATUSES } from "../types";
import type { AnalyticsDashboard, FunnelStage } from "../types";
import { formatRate } from "../utils/format";
import { t } from "../i18n";
import type { MessageKey } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import { CohortBlock, TopCompaniesBlock } from "./analytics/AnalyticsBlocks";
import { referralStatusLabel } from "./analytics/analyticsLabels";

/** 提醒四档的展示名。紧急度的判定在后端 `reminder_urgency`（唯一实现），
 *  这里只是给四档取短名。 */
const REMINDER_BUCKETS: { key: keyof ReminderBucketKeys; labelKey: MessageKey }[] = [
  { key: "overdue", labelKey: "analyticsPage.reminder.overdue" },
  { key: "soon", labelKey: "analyticsPage.reminder.soon" },
  { key: "upcoming", labelKey: "analyticsPage.reminder.upcoming" },
  { key: "later", labelKey: "analyticsPage.reminder.later" },
];

type ReminderBucketKeys = {
  overdue: number;
  soon: number;
  upcoming: number;
  later: number;
};

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
}

function AnalyticsBody({ data, mainFunnel, trendMonths, onTrendMonthsChange }: BodyProps) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一段不重渲染。
  useLocale();
  const gap = data.applied_date_gap;
  // 趋势图与周内分布都吃 applied_at：一条带日期的都没有时，它们只能画零轴。
  const hasAppliedDates = gap.dated > 0;
  const reminders = data.reminder_counts as ReminderBucketKeys & { total: number };
  const unlinkedApplications = data.total_applications - data.track_resume_linked_count;

  return (
    <>
      <Row gutter={[16, 16]} className="analytics-metric-row">
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            framed
            className="stat-card-applied"
            title={t("analyticsPage.overview.total")}
            value={data.total_applications}
            hint={t("analyticsPage.overview.validApplications", {
              count: data.valid_applications,
            })}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            framed
            className="stat-card-interview"
            title={t("analyticsPage.overview.interviewRate")}
            value={formatRate(data.interview_rate)}
            hint={t("analyticsPage.overview.interviewHint", {
              interview: data.interview_count,
              valid: data.valid_applications,
            })}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            framed
            className="stat-card-assessment"
            title={t("analyticsPage.overview.assessmentRate")}
            value={formatRate(data.assessment_pass_rate)}
            hint={t("analyticsPage.overview.assessmentHint", {
              toInterview: data.assessment_to_interview_count,
              assessment: data.assessment_count,
            })}
          />
        </Col>
        <Col xs={24} sm={12} xl={6}>
          <StatCard
            framed
            className="stat-card-offer"
            title={t("analyticsPage.overview.offerCount")}
            value={data.offer_count}
            valueStyle={{ color: "var(--rf-success-strong)" }}
            hint={t("analyticsPage.overview.offerHint", { rate: formatRate(data.offer_rate) })}
          />
        </Col>
      </Row>

      <SectionCard
        title={t("analyticsPage.funnel.title")}
        description={t("analyticsPage.funnel.description")}
      >
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={14}>
            <ChartBlock
              title={t("analyticsPage.funnel.chartTitle")}
              hint={t("analyticsPage.funnel.chartHint")}
            >
              <FunnelChart stages={mainFunnel} />
            </ChartBlock>
          </Col>
          <Col xs={24} xl={10}>
            <Row gutter={[16, 16]}>
              <Col span={8}>
                <StatCard
                  title={t("analyticsPage.funnel.active")}
                  value={data.active_count}
                  hint={t("analyticsPage.funnel.activeHint")}
                />
              </Col>
              <Col span={8}>
                <StatCard
                  title={t("analyticsPage.funnel.stalled")}
                  value={data.stalled_count}
                  hint={t("analyticsPage.funnel.stalledHint")}
                />
              </Col>
              <Col span={8}>
                <StatCard
                  title={t("analyticsPage.funnel.noNextAction")}
                  value={data.no_next_action_count}
                  hint={t("analyticsPage.funnel.noNextActionHint")}
                />
              </Col>
            </Row>
            <Typography.Paragraph style={{ marginTop: 12, marginBottom: 0 }}>
              <Link to="/tracker">{t("analyticsPage.funnel.action")}</Link>
            </Typography.Paragraph>
          </Col>
        </Row>
      </SectionCard>

      <SectionCard
        title={t("analyticsPage.cohort.title")}
        description={t("analyticsPage.cohort.description")}
      >
        <CohortBlock cohort={data.cohort} />
      </SectionCard>

      <SectionCard
        title={t("analyticsPage.trend.title")}
        description={t("analyticsPage.trend.description")}
        extra={
          <Segmented
            size="small"
            value={trendMonths}
            onChange={(value) => onTrendMonthsChange(Number(value))}
            options={[
              { label: t("analyticsPage.trend.month1"), value: 1 },
              { label: t("analyticsPage.trend.month3"), value: 3 },
              { label: t("analyticsPage.trend.month6"), value: 6 },
              { label: t("analyticsPage.trend.year1"), value: 12 },
            ]}
          />
        }
      >
        <DataGapNotice
          missing={gap.undated}
          available={gap.dated}
          label={t("analyticsPage.trend.missingDate")}
          action={<Link to="/tracker">{t("analyticsPage.action.goFill")}</Link>}
        />
        <Row gutter={[16, 16]}>
          <Col xs={24} xl={12}>
            <ChartBlock
              title={t("analyticsPage.trend.appliedTrend")}
              hint={t("analyticsPage.trend.byAppliedDate")}
            >
              {hasAppliedDates ? (
                <BarChart points={data.trend} ariaLabel={t("analyticsPage.trend.appliedTrend")} />
              ) : (
                <Empty description={t("analyticsPage.trend.emptyNoDates")} />
              )}
            </ChartBlock>
          </Col>
          <Col xs={24} xl={12}>
            <ChartBlock
              title={t("analyticsPage.trend.weekdayTitle")}
              hint={t("analyticsPage.trend.byAppliedDate")}
            >
              {hasAppliedDates ? (
                <BarChart points={data.weekday} ariaLabel={t("analyticsPage.trend.weekdayTitle")} />
              ) : (
                <Empty description={t("analyticsPage.trend.emptyNoDates")} />
              )}
            </ChartBlock>
          </Col>
        </Row>
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={12} sm={6}>
            <StatCard
              title={t("analyticsPage.trend.recent7d")}
              value={data.recent_7d_count}
              hint={t("analyticsPage.trend.byCreatedTime")}
            />
          </Col>
          <Col xs={12} sm={6}>
            <StatCard
              title={t("analyticsPage.trend.recent30d")}
              value={data.recent_30d_count}
              hint={t("analyticsPage.trend.byCreatedTime")}
            />
          </Col>
          {REMINDER_BUCKETS.map((bucket) => (
            <Col xs={12} sm={3} key={bucket.key}>
              <StatCard
                title={t("analyticsPage.trend.reminderTitle", { bucket: t(bucket.labelKey) })}
                value={reminders[bucket.key]}
                valueStyle={
                  bucket.key === "overdue" && reminders.overdue > 0
                    ? { color: "var(--rf-error-strong)" }
                    : undefined
                }
              />
            </Col>
          ))}
        </Row>
      </SectionCard>

      <SectionCard
        title={t("analyticsPage.channels.title")}
        description={t("analyticsPage.channels.description")}
      >
        {/* 顶部三张卡：两个核心指标 + 一条口径提示，把描述里的长句收敛成可扫读的提示 tile。 */}
        <Row gutter={[16, 16]}>
          <Col xs={24} sm={8}>
            <StatCard
              title={t("analyticsPage.channels.referralRate")}
              value={formatRate(data.referral.rate)}
              hint={t("analyticsPage.channels.referralRateHint", {
                converted: data.referral.converted,
                total: data.referral.total,
              })}
            />
          </Col>
          <Col xs={24} sm={8}>
            <StatCard
              title={t("analyticsPage.channels.referralTotal")}
              value={data.referral_status.reduce((sum, item) => sum + item.count, 0)}
              hint={t("analyticsPage.channels.referralTotalHint")}
            />
          </Col>
          <Col xs={24} sm={8}>
            <div className="analytics-hint-tile">
              <Typography.Text strong>{t("analyticsPage.channels.caliberTitle")}</Typography.Text>
              <Typography.Text type="secondary">
                {t("analyticsPage.channels.caliberBody")}
              </Typography.Text>
            </div>
          </Col>
        </Row>

        {/* 中部左右两栏：左内推状态分布，右投递最多的公司（前 5，缺口诚实说明）。 */}
        <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
          <Col xs={24} xl={12}>
            <ChartBlock
              title={t("analyticsPage.channels.referralStatusTitle")}
              hint={t("analyticsPage.channels.referralStatusHint")}
            >
              {data.referral_status.some((item) => item.count > 0) ? (
                <HorizontalBarChart
                  ariaLabel={t("analyticsPage.channels.referralStatusTitle")}
                  align="start"
                  items={data.referral_status.map((item) => ({
                    key: item.key,
                    label: referralStatusLabel(item.key),
                    count: item.count,
                  }))}
                />
              ) : (
                <Empty description={t("analyticsPage.channels.emptyReferrals")} />
              )}
            </ChartBlock>
          </Col>
          <Col xs={24} xl={12}>
            <ChartBlock
              title={t("analyticsPage.topCompanies.title")}
              hint={t("analyticsPage.topCompanies.chartHint")}
            >
              <TopCompaniesBlock data={data} />
            </ChartBlock>
          </Col>
        </Row>

        {/* 底部：三种记录来源的迷你 tile。 */}
        <div style={{ marginTop: 16 }}>
          <ChartBlock
            title={t("analyticsPage.channels.sourcesTitle")}
            hint={t("analyticsPage.channels.sourcesHint")}
          >
            <Row gutter={[16, 16]}>
              {data.record_sources.map((item) => (
                <Col xs={8} key={item.key}>
                  <div className="analytics-source-tile">
                    <StatCard title={item.label} value={item.count} />
                  </div>
                </Col>
              ))}
            </Row>
          </ChartBlock>
        </div>
      </SectionCard>

      <SectionCard
        title={t("analyticsPage.resume.title")}
        description={t("analyticsPage.resume.description")}
      >
        <Row gutter={[16, 16]}>
          <Col xs={12} sm={6}>
            <StatCard
              title={t("analyticsPage.resume.count")}
              value={data.resume_count}
              hint={
                data.resume_scanned_count < data.resume_count
                  ? t("analyticsPage.resume.scannedHint", { count: data.resume_scanned_count })
                  : t("analyticsPage.resume.allScanned")
              }
            />
          </Col>
          <Col xs={12} sm={6}>
            <StatCard
              title={t("analyticsPage.resume.withWarnings")}
              value={data.resume_with_warnings_count}
            />
          </Col>
          <Col xs={12} sm={6}>
            <StatCard
              title={t("analyticsPage.resume.withPlaceholders")}
              value={data.resume_with_placeholders_count}
            />
          </Col>
          <Col xs={12} sm={6}>
            <StatCard
              title={t("analyticsPage.resume.unverifiedClaims")}
              value={data.unverified_claim_count}
            />
          </Col>
        </Row>
        <DataGapNotice
          missing={unlinkedApplications}
          available={data.track_resume_linked_count}
          label={t("analyticsPage.resume.missingLink")}
          action={
            <Typography.Text type="secondary">
              {t("analyticsPage.resume.missingLinkAction")}
            </Typography.Text>
          }
        />
      </SectionCard>
    </>
  );
}
