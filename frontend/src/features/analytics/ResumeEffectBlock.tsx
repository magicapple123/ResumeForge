// SPDX-License-Identifier: Apache-2.0
/** 简历版本效果（清单 §17.3-B4）：按关联简历分组的投递数与面试数。
 *
 * 关联入口在录入界面已有（RF-17），但真实库覆盖率极低——所以**每组都显示样本量与
 * 小样本徽标**，并明确写"不做因果归因"：好岗位才认真配简历，关联本身有选择偏差。
 *
 * R13：与其他两块榜单同一套三段控件「投递数 / 面试率 / 名称」。柱长与右侧数值跟着所选
 * 字段走（按面试率排时柱子就是面试率，0% 不画柱子），这样"哪一版简历更会进面"才是
 * 一眼能读出来的事，而不是靠脑子把每张卡上的百分比记住再比较。
 *
 * T32（统计口径含外部）：这张卡里有**两套口径，永不混算**——
 *
 * 1. 上面的柱图是**内部简历**（`resume_id` → `resume_record`），标题旁边直接标
 *    「仅内部简历」；
 * 2. 下面一小块是**外部简历**（`external_resume_id` → `external_resume`），独立标题、
 *    独立空态、独立列表。
 *
 * 为什么不合成一张排行榜：两张表的 id 空间独立且会撞号（界面上才要写 `internal:3` /
 * `external:3`），合起来会出现两个"3 号简历"，同名同号的两行谁也没法核对。外部那份也
 * 因此**不画柱**：柱子天然会被读成"同一批简历的排名"，而它们不是同一批。
 */
import { Flex, Space, Tag, Typography } from "antd";
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
  const externalRows = data.external_resume_effects;
  const ranked = useMemo(() => sortRanked(rows, resumeInput, metric), [rows, metric]);
  // 外部那份沿用同一套排序字段：控件问的是"这三块榜单按哪个维度看"，不是"只看内部"。
  const externalRanked = useMemo(
    () => sortRanked(externalRows, resumeInput, metric),
    [externalRows, metric],
  );
  return (
    <SectionCard
      title={t("analyticsPage.resumeEffect.title")}
      description={t("analyticsPage.resumeEffect.description")}
      extra={
        <Space size={8}>
          {/* 口径标在标题旁：柱图里只有内部简历，读者不该靠"数不到外部"才发现这件事。 */}
          <Tag>{t("analyticsPage.resumeEffect.internalOnly")}</Tag>
          <RankMetricControl
            value={metric}
            onChange={setMetric}
            disabled={rows.length === 0 && externalRows.length === 0}
          />
        </Space>
      }
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
              key: `internal-${item.resume_id}`,
              label: nameOf(item),
              count: barValueOf(resumeInput(item), metric),
            }))}
          />
          <Flex wrap gap={12} style={{ marginTop: 12 }}>
            {ranked.map((item) => (
              <Flex key={`internal-${item.resume_id}`} align="center" gap={6}>
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
      {/* ===== 外部简历：独立口径（T32），不与上面那块混算 ===== */}
      <div style={{ marginTop: 16 }}>
        <Flex align="center" gap={8} wrap>
          <Typography.Text strong>{t("analyticsPage.resumeEffect.externalTitle")}</Typography.Text>
          <Tag color="blue">{t("analyticsPage.resumeEffect.kindExternal")}</Tag>
        </Flex>
        <Typography.Paragraph type="secondary" style={{ marginTop: 4, marginBottom: 8 }}>
          {t("analyticsPage.resumeEffect.externalDescription")}
        </Typography.Paragraph>
        {externalRanked.length === 0 ? (
          <EmptyState description={t("analyticsPage.resumeEffect.externalEmpty")} />
        ) : (
          <Flex vertical gap={6}>
            {externalRanked.map((item) => (
              <Flex key={`external-${item.resume_id}`} align="center" gap={6} wrap>
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
        )}
      </div>
    </SectionCard>
  );
}
