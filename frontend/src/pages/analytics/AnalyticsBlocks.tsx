// SPDX-License-Identifier: Apache-2.0
/** 求职数据看板的两个展示区块（2026-10-28 从 AnalyticsPage 拆出）。
 *
 * 拆分理由：AnalyticsPage 迁入 i18n 后超过 500 行预算，而这两个区块是**独立的数据展示**
 * （投递最多的公司 / 真实时间线），只依赖 analytics 后端类型与通用图表组件，不碰页面状态。
 */
import { Col, Empty, Row, Tag, Typography } from "antd";
import { Link } from "react-router-dom";
import DataGapNotice from "../../components/analytics/DataGapNotice";
import HorizontalBarChart from "../../components/analytics/HorizontalBarChart";
import StatCard from "../../components/analytics/StatCard";
import { t } from "../../i18n";
import type { MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type {
  AnalyticsDashboard,
  ReferralStatus,
  TrackCohort,
  TrackStatus,
} from "../../types";
import { formatRate } from "../../utils/format";


/** 阶段转化/耗时卡的显示名：**键是协议值**（`applied` / `screening` …，与后端逐字对应），
 *  值指向语言包 key。与「求职进度」页共用 `trackerForm.status.*` 词表——同一个协议值在
 *  两处必须是同一个名字，各写一份迟早会漂。`types/tracker.ts` 的 `TRACK_STATUS_LABELS`
 *  一个字都没动（列表卡片仍在用）。 */
const TRACK_STATUS_LABEL_KEYS: Record<TrackStatus, MessageKey> = {
  applied: "trackerForm.status.applied",
  screening: "trackerForm.status.screening",
  assessment: "trackerForm.status.assessment",
  interview: "trackerForm.status.interview",
  offer: "trackerForm.status.offer",
  rejected: "trackerForm.status.rejected",
  unknown: "trackerForm.status.unknown",
};

/** 内推状态显示名：同上，与内推表单共用 `referralForm.status.*` 词表。
 *  `types/referral.ts` 的 `REFERRAL_STATUS_LABELS` 一个字都没动。 */
const REFERRAL_STATUS_LABEL_KEYS: Record<ReferralStatus, MessageKey> = {
  active: "referralForm.status.active",
  submitted: "referralForm.status.submitted",
  closed: "referralForm.status.closed",
  invalid: "referralForm.status.invalid",
};

/** 内推状态显示名；未知取值原样显示（与旧的 `?? item.key` 同义）。 */
export function referralStatusLabel(key: string): string {
  const labelKey = REFERRAL_STATUS_LABEL_KEYS[key as ReferralStatus];
  return labelKey ? t(labelKey) : key;
}

/** 阶段名：协议值 → 语言包文案；未知取值原样显示。 */
function trackStatusLabel(status: string): string {
  const labelKey = TRACK_STATUS_LABEL_KEYS[status as TrackStatus];
  return labelKey ? t(labelKey) : status;
}

/** 后端把明显非公司名的记录（纯数字 ID、单字垃圾、空）归并到这个中性占位。 */
// i18n-ok: 与后端 `services/analytics.UNKNOWN_COMPANY_LABEL` 逐字匹配，用于过滤而非展示
const UNKNOWN_COMPANY_LABEL = "未填写公司";

/** 「投递最多的公司」：展示清洗后的真实公司前 5 名。
 *
 * 明显非公司名已被后端归并到「未填写公司」并从榜单剔除——这里只画真公司，缺口用
 * `DataGapNotice` 诚实交代，绝不把垃圾当公司名展示（宁可少显示也不要假数据）。
 */
export function TopCompaniesBlock({ data }: { data: AnalyticsDashboard }) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一段不重渲染。
  useLocale();
  const realGroups = data.top_companies.filter((item) => item.label !== UNKNOWN_COMPANY_LABEL);
  const displayed = realGroups.slice(0, 5);
  // 前 5 之外（含后端折进 other 的长尾）如实并入"另有 N 家"，不让榜单总数对不上。
  const otherCount = Math.max(0, realGroups.length + data.other_company_count - displayed.length);
  const unknownCount = data.top_companies
    .filter((item) => item.label === UNKNOWN_COMPANY_LABEL)
    .reduce((sum, item) => sum + item.count, 0);

  if (data.total_applications === 0) {
    return <Empty description={t("analyticsPage.empty.noApplications")} />;
  }
  if (realGroups.length === 0) {
    // 有记录但全都没填公司名：诚实说明缺口，而不是画一张空榜或展示垃圾。
    return (
      <DataGapNotice
        missing={unknownCount}
        label={t("analyticsPage.topCompanies.missingCompany")}
        action={<Link to="/tracker">{t("analyticsPage.action.goFill")}</Link>}
      />
    );
  }
  return (
    <>
      <HorizontalBarChart
        ariaLabel={t("analyticsPage.topCompanies.title")}
        align="start"
        items={displayed.map((item) => ({
          key: item.key,
          label: item.label,
          count: item.count,
        }))}
      />
      {otherCount > 0 ? (
        <Typography.Text type="secondary">
          {t("analyticsPage.topCompanies.other", { count: otherCount })}
        </Typography.Text>
      ) : null}
      {unknownCount > 0 ? (
        <DataGapNotice
          missing={unknownCount}
          label={t("analyticsPage.topCompanies.missingCompanyRanking")}
          action={<Link to="/tracker">{t("analyticsPage.action.goFill")}</Link>}
        />
      ) : null}
    </>
  );
}

/** 「真实时间线」（RF-18）：基于状态变化事件表的阶段转化与耗时。
 *
 * 只展示事件能证明的事：每项带分子/分母副文案与小样本徽标；历史记录（早于事件
 * 记录功能、无阶段数据）如实说明缺口。**不做**任何「使用产品能提高 X%」式的推断。
 */
export function CohortBlock({ cohort }: { cohort: TrackCohort }) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一段不重渲染。
  useLocale();
  if (cohort.event_track_count === 0) {
    return (
      <Empty
        description={
          cohort.historical_track_count > 0
            ? t("analyticsPage.cohort.emptyHistorical", {
                count: cohort.historical_track_count,
              })
            : t("analyticsPage.cohort.empty")
        }
      />
    );
  }
  return (
    <>
      {cohort.historical_track_count > 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
          {t("analyticsPage.cohort.historicalNotice", {
            historical: cohort.historical_track_count,
            total: cohort.event_track_count + cohort.historical_track_count,
          })}
        </Typography.Paragraph>
      ) : null}
      <Row gutter={[16, 16]}>
        {cohort.conversions.map((item) => (
          <Col xs={24} sm={12} xl={6} key={`${item.from_status}-${item.to_status}`}>
            <StatCard
              title={`${trackStatusLabel(item.from_status)} → ${trackStatusLabel(item.to_status)}`}
              value={formatRate(item.rate)}
              hint={
                item.denominator === 0
                  ? t("analyticsPage.cohort.noRecords")
                  : t("analyticsPage.cohort.conversionHint", {
                      numerator: item.numerator,
                      denominator: item.denominator,
                    })
              }
            />
            {item.small_sample && <Tag>{t("analyticsPage.cohort.smallSample")}</Tag>}
          </Col>
        ))}
      </Row>
      <Row gutter={[16, 16]} style={{ marginTop: 8 }}>
        {cohort.durations.map((item) => (
          <Col xs={24} sm={12} xl={6} key={`${item.from_status}-${item.to_status}`}>
            <StatCard
              title={t("analyticsPage.cohort.durationTitle", {
                from: trackStatusLabel(item.from_status),
                to: trackStatusLabel(item.to_status),
              })}
              value={
                item.median_days === null
                  ? t("analyticsPage.cohort.noComparableData")
                  : t("analyticsPage.cohort.medianDays", { days: item.median_days })
              }
              hint={t("analyticsPage.cohort.basedOn", {
                numerator: item.numerator,
                denominator: item.denominator,
              })}
            />
            {item.small_sample && <Tag>{t("analyticsPage.cohort.smallSample")}</Tag>}
          </Col>
        ))}
      </Row>
      {cohort.undated_event_count > 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 8, marginBottom: 0 }}>
          {t("analyticsPage.cohort.undatedNotice", { count: cohort.undated_event_count })}
        </Typography.Paragraph>
      ) : null}
    </>
  );
}
