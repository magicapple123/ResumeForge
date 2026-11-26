// SPDX-License-Identifier: Apache-2.0
/** 渠道转化率（清单 §17.3-A1）：按「投递渠道」字段分桶的投递数 / 面试率 / Offer 率。
 *
 * 口径三条（与后端 analytics_breakdowns.channel_stats 一一对应）：
 * 1. 分母是该渠道的投递数，分子是"当前状态到过面试及以上"（Offer 也算到过面试）；
 * 2. 渠道与「内推」是两套口径：渠道里的"内推"是记录字段，内推模块是独立对象，
 *    两者只能二选一相加——所以这张卡顶部必须写清来源；
 * 3. 12 条样本下每个渠道都亮"样本少于 5 条"徽标，不把百分比当稳定结论。
 *
 * R13：这是一个**榜单**（渠道之间比转化），所以给三段控件「投递数 / 面试率 / 名称」。
 * 原来每个渠道一张 StatCard，卡片之间没有共同基线，长短不可比；改成条形榜单后柱长就是所选
 * 字段的值，按面试率排时看到的就是"哪个渠道更会约面试"，0% 的渠道不画柱子。
 * 分子/分母、Offer 率与小样本徽标一个都没丢，挪到榜单下面逐条列出。
 */
import { Flex, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { AnalyticsDashboard, ChannelStat } from "../../types";
import { formatRate } from "../../utils/format";
import HorizontalBarChart from "./HorizontalBarChart";
import RankMetricControl from "./RankMetricControl";
import SectionCard from "./SectionCard";
import EmptyState from "../../components/common/EmptyState";
import {
  barSuffixOf,
  barValueOf,
  DEFAULT_RANK_METRIC,
  sortRanked,
  type RankInput,
  type RankMetric,
} from "./rankOrder";

function channelHint(item: ChannelStat): string {
  return t("analyticsPage.channelConversion.hint", {
    interview: item.interview_count,
    total: item.total,
    offer: item.offer_count,
    offerRate: formatRate(item.offer_rate),
  });
}

function channelInput(item: ChannelStat): RankInput {
  return { name: item.label, total: item.total, interviewCount: item.interview_count };
}

export default function ChannelConversionBlock({ data }: { data: AnalyticsDashboard }) {
  useLocale();
  const [metric, setMetric] = useState<RankMetric>(DEFAULT_RANK_METRIC);
  const rows = useMemo(
    () => data.channel_stats.filter((item) => item.total > 0),
    [data.channel_stats],
  );
  const ranked = useMemo(() => sortRanked(rows, channelInput, metric), [rows, metric]);
  return (
    <SectionCard
      title={t("analyticsPage.channelConversion.title")}
      description={t("analyticsPage.channelConversion.description")}
      extra={<RankMetricControl value={metric} onChange={setMetric} disabled={rows.length === 0} />}
    >
      {rows.length === 0 ? (
        <EmptyState description={t("analyticsPage.channelConversion.empty")} />
      ) : (
        <>
          <HorizontalBarChart
            ariaLabel={t("analyticsPage.channelConversion.title")}
            align="start"
            valueSuffix={barSuffixOf(metric)}
            // 渠道名短且互不重复，配色按渠道取（与漏斗的阶段色无关：这两件事没有对应关系）。
            items={ranked.map((item) => ({
              key: item.channel,
              label: item.label,
              count: barValueOf(channelInput(item), metric),
            }))}
          />
          <Flex wrap gap={12} style={{ marginTop: 12 }}>
            {ranked.map((item) => (
              <Flex key={item.channel} align="center" gap={6}>
                <Typography.Text strong>{item.label}</Typography.Text>
                <Typography.Text type="secondary">{channelHint(item)}</Typography.Text>
                {item.small_sample ? <Tag>{t("analyticsPage.cohort.smallSample")}</Tag> : null}
              </Flex>
            ))}
          </Flex>
        </>
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        {t("analyticsPage.channelConversion.caliber")}
      </Typography.Paragraph>
    </SectionCard>
  );
}
