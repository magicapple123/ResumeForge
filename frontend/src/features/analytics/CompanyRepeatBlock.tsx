// SPDX-License-Identifier: Apache-2.0
/** 同公司多投（清单 §17.3-A3）：投了 >=2 个岗位的公司，以及"投了 >=3 次但 0 面试"清单。
 *
 * 两份清单的门槛由后端决定（analytics_breakdowns.REPEAT_MIN_APPLICATIONS /
 * NO_INTERVIEW_MIN_APPLICATIONS），前端只展示，不另算一遍。
 * 数据为空时给可读空态——真实库 12 条记录分属 12 家公司，"同公司多投"当前确实为 0，
 * 这不是缺数据，而是这批数据的事实。
 */
import { Empty, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { CompanyRepeat } from "../../types";
import HorizontalBarChart from "./HorizontalBarChart";
import SectionCard from "./SectionCard";

function repeatHint(item: CompanyRepeat): string {
  return t("analyticsPage.companyRepeats.itemHint", {
    total: item.total,
    interview: item.interview_count,
    offer: item.offer_count,
  });
}

export default function CompanyRepeatBlock({
  repeats,
  noInterview,
}: {
  repeats: CompanyRepeat[];
  noInterview: CompanyRepeat[];
}) {
  useLocale();
  return (
    <SectionCard
      title={t("analyticsPage.companyRepeats.title")}
      description={t("analyticsPage.companyRepeats.description")}
    >
      {repeats.length === 0 ? (
        <Empty description={t("analyticsPage.companyRepeats.empty")} />
      ) : (
        <>
          <HorizontalBarChart
            ariaLabel={t("analyticsPage.companyRepeats.title")}
            align="start"
            items={repeats.map((item) => ({
              key: item.company_key,
              label: item.company || item.company_key,
              count: item.total,
            }))}
          />
          <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
            {repeats
              .map((item) =>
                t("analyticsPage.companyRepeats.itemLine", {
                  company: item.company || item.company_key,
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
                .map((item) => item.company || item.company_key)
                .join(t("analyticsPage.companyRepeats.nameSeparator"))}
            </Typography.Text>
          )}
        </>
      )}
    </SectionCard>
  );
}
