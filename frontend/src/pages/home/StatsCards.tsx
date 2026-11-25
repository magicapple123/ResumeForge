// SPDX-License-Identifier: Apache-2.0
/**
 * 首页统计卡：岗位总数 / 开放中岗位 / 已生成简历（CR-37 去掉了「近 7 天生成」）。
 *
 * 「近 7 天生成」是个负向指标：新用户那格永远是 0，读起来像"你什么都没做"；它也不驱动
 * 任何动作。任务书给的两条路里选了「直接去掉」——「本周投递」需要后端新增周维度计数，
 * 为一个可有可无的数字加接口不划算。
 */
import { FileTextOutlined, RocketOutlined, SearchOutlined } from "@ant-design/icons";
import { Card, Col, Row, Statistic } from "antd";
import type { Stats } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function StatsCards({ stats, loading }: { stats: Stats | undefined; loading: boolean }) {
  // 本组件用模块级 t()，必须订阅语言变化。
  useLocale();
  return (
    <Row gutter={[16, 16]}>
      <Col xs={24} sm={12} lg={8}>
        <Card loading={loading}>
          <Statistic
            title={t("homePage.stats.jobCount")}
            value={stats?.job_count ?? 0}
            prefix={<SearchOutlined />}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8}>
        <Card loading={loading}>
          <Statistic
            title={t("homePage.stats.openJobCount")}
            value={stats?.open_job_count ?? 0}
            prefix={<RocketOutlined />}
          />
        </Card>
      </Col>
      <Col xs={24} sm={12} lg={8}>
        <Card loading={loading}>
          <Statistic
            title={t("homePage.stats.resumeCount")}
            value={stats?.resume_count ?? 0}
            prefix={<FileTextOutlined />}
          />
        </Card>
      </Col>
    </Row>
  );
}
