// SPDX-License-Identifier: Apache-2.0
/** 投递 → 当前阶段耗时（清单 §17.3-A2）：按当前状态分组的中位天数。
 *
 * **不依赖状态变化事件表**：只用用户填过的 applied_at 与 status_date。所以它能给
 * "投递到现在这个状态一共花了多久"，但给不出相邻阶段之间的耗时（那要事件）。
 * 样本数（有可用日期对的条数 vs 该状态总条数）必须一起展示。
 */
import { Col, Empty, Row, Tag, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { AnalyticsDashboard, StatusDuration } from "../../types";
import SectionCard from "./SectionCard";
import StatCard from "./StatCard";

function durationValue(item: StatusDuration): string {
  return item.median_days === null
    ? t("analyticsPage.statusDuration.noComparable")
    : t("analyticsPage.statusDuration.medianDays", { days: item.median_days });
}

export default function StatusDurationBlock({ data }: { data: AnalyticsDashboard }) {
  useLocale();
  const rows = data.status_durations.filter((item) => item.denominator > 0);
  const skipped = data.status_durations.reduce((sum, item) => sum + item.skipped_negative, 0);
  return (
    <SectionCard
      title={t("analyticsPage.statusDuration.title")}
      description={t("analyticsPage.statusDuration.description")}
    >
      {rows.length === 0 ? (
        <Empty description={t("analyticsPage.statusDuration.empty")} />
      ) : (
        <Row gutter={[16, 16]}>
          {rows.map((item) => (
            <Col xs={24} sm={12} xl={8} key={item.status}>
              <StatCard
                title={item.label}
                value={durationValue(item)}
                hint={t("analyticsPage.statusDuration.basedOn", {
                  sample: item.sample_count,
                  total: item.denominator,
                })}
              />
              {item.small_sample ? <Tag>{t("analyticsPage.cohort.smallSample")}</Tag> : null}
            </Col>
          ))}
        </Row>
      )}
      {skipped > 0 ? (
        <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
          {t("analyticsPage.statusDuration.skippedNegative", { count: skipped })}
        </Typography.Paragraph>
      ) : null}
    </SectionCard>
  );
}
