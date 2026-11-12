// SPDX-License-Identifier: Apache-2.0
/** 简历版本效果（清单 §17.3-B4）：按关联简历分组的投递数与面试数。
 *
 * 关联入口在录入界面已有（RF-17），但真实库覆盖率极低——所以**每组都显示样本量与
 * 小样本徽标**，并明确写"不做因果归因"：好岗位才认真配简历，关联本身有选择偏差。
 */
import { Col, Empty, Row, Tag, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { AnalyticsDashboard } from "../../types";
import { formatRate } from "../../utils/format";
import SectionCard from "./SectionCard";
import StatCard from "./StatCard";

export default function ResumeEffectBlock({ data }: { data: AnalyticsDashboard }) {
  useLocale();
  return (
    <SectionCard
      title={t("analyticsPage.resumeEffect.title")}
      description={t("analyticsPage.resumeEffect.description")}
    >
      {data.resume_effects.length === 0 ? (
        <Empty description={t("analyticsPage.resumeEffect.empty")} />
      ) : (
        <Row gutter={[16, 16]}>
          {data.resume_effects.map((item) => (
            <Col xs={24} sm={12} xl={8} key={item.resume_id}>
              <StatCard
                title={item.resume_title || t("analyticsPage.resumeEffect.untitled")}
                value={formatRate(item.interview_rate)}
                hint={t("analyticsPage.resumeEffect.hint", {
                  interview: item.interview_count,
                  total: item.total,
                })}
              />
              {item.small_sample ? <Tag>{t("analyticsPage.cohort.smallSample")}</Tag> : null}
            </Col>
          ))}
        </Row>
      )}
      <Typography.Paragraph type="secondary" style={{ marginTop: 12, marginBottom: 0 }}>
        {t("analyticsPage.resumeEffect.bias")}
      </Typography.Paragraph>
    </SectionCard>
  );
}
