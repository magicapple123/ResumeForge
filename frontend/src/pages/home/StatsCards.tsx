/**
 * 首页统计卡：岗位总数 / 开放中岗位 / 已生成简历 / 近 7 天生成。
 * （自 HomePage 拆出，逐字搬运，行为等价。）
 */
import { FileTextOutlined, RocketOutlined, SearchOutlined, StarOutlined } from "@ant-design/icons";
import { Card, Col, Row, Statistic } from "antd";
import type { Stats } from "../../types";

export function StatsCards({ stats, loading }: { stats: Stats | undefined; loading: boolean }) {
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} xl={6}>
        <Card loading={loading}>
          <Statistic title="岗位总数" value={stats?.job_count ?? 0} prefix={<SearchOutlined />} />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card loading={loading}>
          <Statistic
            title="开放中岗位"
            value={stats?.open_job_count ?? 0}
            prefix={<RocketOutlined />}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card loading={loading}>
          <Statistic
            title="已生成简历"
            value={stats?.resume_count ?? 0}
            prefix={<FileTextOutlined />}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} xl={6}>
        <Card loading={loading}>
          <Statistic
            title="近 7 天生成"
            value={stats?.week_resume_count ?? 0}
            prefix={<StarOutlined />}
          />
        </Card>
      </Col>
    </Row>
  );
}
