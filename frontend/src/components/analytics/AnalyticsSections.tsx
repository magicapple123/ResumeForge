// SPDX-License-Identifier: Apache-2.0
/** 求职数据看板的四个既有主题区块（2026-11-10 第 17 条从 AnalyticsPage 拆出）。
 *
 * 拆分理由：AnalyticsPage 已到 455 行，本轮要补 P1-P3 五块新指标，再往里塞就顶穿
 * 500 行预算。这里只做**纯展示搬迁**（逻辑与标记与拆分前逐字一致），页面状态仍在
 * AnalyticsPage（趋势区间选择器的值由它持有并下发）。
 */
import { Col, Empty, Row, Segmented, Typography } from "antd";
import { Link } from "react-router-dom";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { AnalyticsDashboard, FunnelStage } from "../../types";
import { formatRate } from "../../utils/format";
import BarChart from "./BarChart";
import ChartBlock from "./ChartBlock";
import DataGapNotice from "./DataGapNotice";
import FunnelChart from "./FunnelChart";
import HorizontalBarChart from "./HorizontalBarChart";
import SectionCard from "./SectionCard";
import StatCard from "./StatCard";
import { CohortBlock, TopCompaniesBlock } from "../../pages/analytics/AnalyticsBlocks";
import {
  funnelStageLabel,
  recordSourceLabel,
  referralStatusLabel,
  trendMonthLabel,
  weekdayLabel,
} from "../../pages/analytics/analyticsLabels";

/** 提醒四档的展示名。紧急度的判定在后端 reminder_urgency（唯一实现），这里只取短名。 */
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

/** 顶部四张概览卡（投递总量 / 面试率 / 笔试通过率 / Offer 数）。 */
export function OverviewSection({ data }: { data: AnalyticsDashboard }) {
  useLocale();
  return (
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
  );
}

/** 转化与卡点：主线漏斗 + 进行中/停滞/没有下一步。
 *  "进行中不含 Offer" 的说明在 activeHint 里（两个数并肩却差一个 Offer 时必须解释）。 */
export function FunnelSection({
  data,
  mainFunnel,
}: {
  data: AnalyticsDashboard;
  mainFunnel: FunnelStage[];
}) {
  useLocale();
  return (
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
            <FunnelChart
              stages={mainFunnel.map((stage) => ({
                ...stage,
                label: funnelStageLabel(stage.status, stage.label),
              }))}
            />
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
  );
}

/** 时间与节奏：趋势/周内分布/最近新增/提醒四档。
 *  区间选择器挂在「投递趋势」这张小卡上（它只作用于趋势图，挂区块标题上像整页筛选）。 */
export function TrendSection({
  data,
  trendMonths,
  onTrendMonthsChange,
}: {
  data: AnalyticsDashboard;
  trendMonths: number;
  onTrendMonthsChange: (value: number) => void;
}) {
  useLocale();
  const gap = data.applied_date_gap;
  const hasAppliedDates = gap.dated > 0;
  const reminders = data.reminder_counts as ReminderBucketKeys & { total: number };
  return (
    <SectionCard
      title={t("analyticsPage.trend.title")}
      description={t("analyticsPage.trend.description")}
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
            {hasAppliedDates ? (
              <BarChart
                points={data.trend.map((point) => ({
                  label: trendMonthLabel(point.month, point.label),
                  count: point.count,
                }))}
                ariaLabel={t("analyticsPage.trend.appliedTrend")}
              />
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
              <BarChart
                points={data.weekday.map((item) => ({
                  key: item.key,
                  label: weekdayLabel(item.key, item.label),
                  count: item.count,
                }))}
                ariaLabel={t("analyticsPage.trend.weekdayTitle")}
              />
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
  );
}

/** 渠道与去向：内推转化/状态、投递最多的公司、记录来源。 */
export function ChannelsSection({ data }: { data: AnalyticsDashboard }) {
  useLocale();
  return (
    <SectionCard
      title={t("analyticsPage.channels.title")}
      description={t("analyticsPage.channels.description")}
    >
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
      <div style={{ marginTop: 16 }}>
        <ChartBlock
          title={t("analyticsPage.channels.sourcesTitle")}
          hint={t("analyticsPage.channels.sourcesHint")}
        >
          <Row gutter={[16, 16]}>
            {data.record_sources.map((item) => (
              <Col xs={8} key={item.key}>
                <div className="analytics-source-tile">
                  <StatCard title={recordSourceLabel(item.key, item.label)} value={item.count} />
                </div>
              </Col>
            ))}
          </Row>
        </ChartBlock>
      </div>
    </SectionCard>
  );
}

/** 简历与健康度。 */
export function ResumeSection({ data }: { data: AnalyticsDashboard }) {
  useLocale();
  const unlinkedApplications = data.total_applications - data.track_resume_linked_count;
  return (
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
  );
}

/** 真实时间线（RF-18）区块：只展示事件能证明的事，缺口与小样本如实亮出。 */
export function CohortSection({ data }: { data: AnalyticsDashboard }) {
  useLocale();
  return (
    <SectionCard
      title={t("analyticsPage.cohort.title")}
      description={t("analyticsPage.cohort.description")}
    >
      <CohortBlock cohort={data.cohort} />
    </SectionCard>
  );
}
