/** 内推转化率统计卡：有效内推 / 已转化 / 转化率三格。
 *
 * `converted` 由后端按关联漏斗后置位派生，前端只展示、不自己算口径。
 */
import { Card, Col, Row, Statistic } from "antd";
import type { ReferralStats } from "../../types";

interface Props {
  stats: ReferralStats | null;
}

export default function ReferralStatsCard({ stats }: Props) {
  const convertedRate = stats?.total ? Math.round((stats.rate ?? 0) * 100) : 0;

  return (
    <Card size="small" title="内推转化率">
      <Row gutter={16}>
        <Col span={8}>
          <Statistic title="有效内推" value={stats?.total ?? 0} />
        </Col>
        <Col span={8}>
          <Statistic title="已转化" value={stats?.converted ?? 0} />
        </Col>
        <Col span={8}>
          <Statistic
            title="转化率"
            value={convertedRate}
            suffix="%"
            styles={{ content: { color: convertedRate >= 50 ? "#389e0d" : undefined } }}
          />
        </Col>
      </Row>
    </Card>
  );
}
