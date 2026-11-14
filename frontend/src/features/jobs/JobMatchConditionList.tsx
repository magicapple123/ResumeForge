// SPDX-License-Identifier: Apache-2.0
/** 岗位匹配度的「逐条对照」列表（从 JobMatchModal 拆出，压 500 行预算）。 */
import EmptyState from "../../components/common/EmptyState";
import { Space, Tag, Typography } from "antd";
import { MATCH_STATUS_META, type MatchCondition } from "../../types";
import { t } from "../../i18n";
import { MATCH_STATUS_LABEL_KEYS } from "../../i18n/enum/apply";
import { useLocale } from "../../i18n/i18nContext";

export default function JobMatchConditionList({ conditions }: { conditions: MatchCondition[] }) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  if (conditions.length === 0) {
    return <EmptyState inline description={t("jobMatch.empty.none")} />;
  }
  return (
    <ul className="job-match-conditions">
      {conditions.map((condition, index) => {
        const meta = MATCH_STATUS_META[condition.status];
        return (
          <li key={`${condition.label}-${index}`} className="job-match-condition">
            <Space wrap size={8}>
              <Tag color={meta.color}>{t(MATCH_STATUS_LABEL_KEYS[condition.status])}</Tag>
              <Typography.Text strong>{condition.label}</Typography.Text>
            </Space>
            {condition.jd_quote && (
              <Typography.Paragraph type="secondary" className="job-match-quote">
                {t("jobMatch.condition.jdQuote", { quote: condition.jd_quote })}
              </Typography.Paragraph>
            )}
            <Typography.Paragraph className="job-match-evidence">
              {t("jobMatch.condition.evidence", {
                evidence: condition.evidence || t("jobMatch.condition.evidenceMissing"),
              })}
            </Typography.Paragraph>
          </li>
        );
      })}
    </ul>
  );
}
