// SPDX-License-Identifier: Apache-2.0
/** 渠道转化率（清单 §17.3-A1）：按「投递渠道」字段分桶的投递数 / 面试率 / Offer 率。
 *
 * 口径三条（与后端 analytics_breakdowns.channel_stats 一一对应）：
 * 1. 分母是该渠道的投递数，分子是"当前状态到过面试及以上"（Offer 也算到过面试）；
 * 2. 渠道与「内推」是两套口径：渠道里的"内推"是记录字段，内推模块是独立对象，
 *    两者只能二选一相加——所以这张卡顶部必须写清来源；
 * 3. 12 条样本下每个渠道都亮"样本少于 5 条"徽标，不把百分比当稳定结论。
 */
import { Col, Empty, Row, Tag, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { AnalyticsDashboard } from "../../types";
import { formatRate } from "../../utils/format";
import SectionCard from "./SectionCard";
import StatCard from "./StatCard";

export default function ChannelConversionBlock({ data }: { data: AnalyticsDashboard }) {
  useLocale();
  const rows = data.channel_stats.filter((item) => item.total > 0);
  return (
    <SectionCard
      title={t("analyticsPage.channelConversion.title")}
      description={t("analyticsPage.channelConversion.description")}
    >
      {rows.length === 0 ? (
        <Empty description={t("analyticsPage.channelConversion.empty")} />
      ) : (
        <Row gutter={[16, 16]}>
          {rows.map((item) => (
            <Col xs={24} sm={12} xl={8} key={item.channel}>
              <StatCard
                title={item.label}
                value={formatRate(item.interview_rate)}
                hint={t("analyticsPage.channelConversion.hint", {
                  interview: item.interview_count,
                  total: item.total,
                  offer: item.offer_count,
                  offerRate: formatRate(item.offer_rate),
                })}
              />
              {item.small_sample ? <Tag>{t("analyticsPage.cohort.smallSample")}</Tag> : null}
            </Col>
          ))}
        </Row>
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        {t("analyticsPage.channelConversion.caliber")}
      </Typography.Paragraph>
    </SectionCard>
  );
}
