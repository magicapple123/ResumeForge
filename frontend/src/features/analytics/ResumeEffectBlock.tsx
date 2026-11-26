// SPDX-License-Identifier: Apache-2.0
/** 简历版本效果（清单 §17.3-B4）：按关联简历分组的投递数与面试数。
 *
 * 关联入口在录入界面已有（RF-17），但真实库覆盖率极低——所以**每组都显示样本量与
 * 小样本徽标**，并明确写"不做因果归因"：好岗位才认真配简历，关联本身有选择偏差。
 *
 * R13：与其他两块榜单同一套三段控件「投递数 / 面试率 / 名称」。柱长与右侧数值跟着所选
 * 字段走（按面试率排时柱子就是面试率，0% 不画柱子），这样"哪一版简历更会进面"才是
 * 一眼能读出来的事，而不是靠脑子把每张卡上的百分比记住再比较。
 */
import { Flex, Tag, Typography } from "antd";
import { useMemo, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { AnalyticsDashboard, ResumeEffect } from "../../types";
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

/** 没有标题时用「未命名简历」，与统计口径里的同一兜底文案保持一致。 */
function nameOf(item: ResumeEffect): string {
  return item.resume_title || t("analyticsPage.resumeEffect.untitled");
}

function resumeInput(item: ResumeEffect): RankInput {
  return { name: nameOf(item), total: item.total, interviewCount: item.interview_count };
}

export default function ResumeEffectBlock({ data }: { data: AnalyticsDashboard }) {
  useLocale();
  const [metric, setMetric] = useState<RankMetric>(DEFAULT_RANK_METRIC);
  const rows = data.resume_effects;
  const ranked = useMemo(() => sortRanked(rows, resumeInput, metric), [rows, metric]);
  return (
    <SectionCard
      title={t("analyticsPage.resumeEffect.title")}
      description={t("analyticsPage.resumeEffect.description")}
      extra={<RankMetricControl value={metric} onChange={setMetric} disabled={rows.length === 0} />}
    >
      {rows.length === 0 ? (
        <EmptyState description={t("analyticsPage.resumeEffect.empty")} />
      ) : (
        <>
          <HorizontalBarChart
            ariaLabel={t("analyticsPage.resumeEffect.title")}
            align="start"
            valueSuffix={barSuffixOf(metric)}
            items={ranked.map((item) => ({
              key: String(item.resume_id),
              label: nameOf(item),
              count: barValueOf(resumeInput(item), metric),
            }))}
          />
          <Flex wrap gap={12} style={{ marginTop: 12 }}>
            {ranked.map((item) => (
              <Flex key={item.resume_id} align="center" gap={6}>
                <Typography.Text strong>{nameOf(item)}</Typography.Text>
                <Typography.Text type="secondary">
                  {t("analyticsPage.resumeEffect.hint", {
                    interview: item.interview_count,
                    total: item.total,
                  })}
                </Typography.Text>
                {item.small_sample ? <Tag>{t("analyticsPage.cohort.smallSample")}</Tag> : null}
              </Flex>
            ))}
          </Flex>
        </>
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        {t("analyticsPage.resumeEffect.bias")}
      </Typography.Paragraph>
    </SectionCard>
  );
}
