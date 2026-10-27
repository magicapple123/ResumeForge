// SPDX-License-Identifier: Apache-2.0
/** 内推转化率统计卡：有效内推 / 已转化 / 转化率三格。
 *
 * `converted` 由后端按关联漏斗后置位派生，前端只展示、不自己算口径。
 */
import { Card, Col, Row, Statistic } from "antd";
import type { ReferralStats } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  stats: ReferralStats | null;
}

export default function ReferralStatsCard({ stats }: Props) {
  // 本文件用模块级 t()：必须订阅语言变化，否则切语言后统计卡标题不重渲染。
  useLocale();
  const convertedRate = stats?.total ? Math.round((stats.rate ?? 0) * 100) : 0;

  return (
    <Card size="small" title={t("referralUi.stats.title")}>
      <Row gutter={16}>
        <Col span={8}>
          <Statistic title={t("referralUi.stats.valid")} value={stats?.total ?? 0} />
        </Col>
        <Col span={8}>
          <Statistic title={t("referralUi.stats.converted")} value={stats?.converted ?? 0} />
        </Col>
        <Col span={8}>
          <Statistic
            title={t("referralUi.stats.rate")}
            value={convertedRate}
            suffix="%"
            styles={{
              content: { color: convertedRate >= 50 ? "var(--rf-success-text)" : undefined },
            }}
          />
        </Col>
      </Row>
    </Card>
  );
}
