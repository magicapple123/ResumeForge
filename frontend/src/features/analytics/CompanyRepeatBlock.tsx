// SPDX-License-Identifier: Apache-2.0
/** 同公司多投（清单 §17.3-A3）：投了 >=2 个岗位的公司，以及"投了 >=3 次但 0 面试"清单。
 *
 * 两份清单的门槛由后端决定（analytics_breakdowns.REPEAT_MIN_APPLICATIONS /
 * NO_INTERVIEW_MIN_APPLICATIONS），前端只展示，不另算一遍。
 * 数据为空时给可读空态——真实库 12 条记录分属 12 家公司，"同公司多投"当前确实为 0，
 * 这不是缺数据，而是这批数据的事实。
 *
 * R13：榜首的条形榜单可以按「投递数 / 面试率 / 名称」重排（本地排序，整块数据都在手里）。
 * 柱长与右侧数值都跟着所选字段走——按面试率排时柱子就是面试率，0% 不画柱子。
 */
import { Typography } from "antd";
import { useMemo, useState } from "react";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { CompanyRepeat } from "../../types";
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

function repeatHint(item: CompanyRepeat): string {
  return t("analyticsPage.companyRepeats.itemHint", {
    total: item.total,
    interview: item.interview_count,
    offer: item.offer_count,
  });
}

/** 没有公司名时用归一化键当名字：榜单上不能出现一行空标签。 */
function nameOf(item: CompanyRepeat): string {
  return item.company || item.company_key;
}

function repeatInput(item: CompanyRepeat): RankInput {
  return { name: nameOf(item), total: item.total, interviewCount: item.interview_count };
}

export default function CompanyRepeatBlock({
  repeats,
  noInterview,
}: {
  repeats: CompanyRepeat[];
  noInterview: CompanyRepeat[];
}) {
  useLocale();
  const [metric, setMetric] = useState<RankMetric>(DEFAULT_RANK_METRIC);
  const ranked = useMemo(() => sortRanked(repeats, repeatInput, metric), [repeats, metric]);
  return (
    <SectionCard
      title={t("analyticsPage.companyRepeats.title")}
      description={t("analyticsPage.companyRepeats.description")}
      extra={
        <RankMetricControl value={metric} onChange={setMetric} disabled={repeats.length === 0} />
      }
    >
      {repeats.length === 0 ? (
        <EmptyState description={t("analyticsPage.companyRepeats.empty")} />
      ) : (
        <>
          <HorizontalBarChart
            ariaLabel={t("analyticsPage.companyRepeats.title")}
            align="start"
            valueSuffix={barSuffixOf(metric)}
            items={ranked.map((item) => ({
              key: item.company_key,
              label: nameOf(item),
              count: barValueOf(repeatInput(item), metric),
            }))}
          />
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            {ranked
              .map((item) =>
                t("analyticsPage.companyRepeats.itemLine", {
                  company: nameOf(item),
                  hint: repeatHint(item),
                }),
              )
              .join(t("analyticsPage.companyRepeats.lineSeparator"))}
          </Typography.Paragraph>
          <Typography.Paragraph strong style={{ marginTop: 12, marginBottom: 4 }}>
            {t("analyticsPage.companyRepeats.noInterviewTitle")}
          </Typography.Paragraph>
          {noInterview.length === 0 ? (
            <Typography.Text type="secondary">
              {t("analyticsPage.companyRepeats.noInterviewEmpty")}
            </Typography.Text>
          ) : (
            <Typography.Text>
              {noInterview
                .map((item) => nameOf(item))
                .join(t("analyticsPage.companyRepeats.nameSeparator"))}
            </Typography.Text>
          )}
        </>
      )}
    </SectionCard>
  );
}
