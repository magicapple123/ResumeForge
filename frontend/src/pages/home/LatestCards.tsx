// SPDX-License-Identifier: Apache-2.0
/**
 * 最近动态三卡：最近岗位 / 最近生成的简历 / 最近投出去的。
 * （自 HomePage 拆出，逐字搬运，行为等价。）
 */
import { Card, Col, Empty, Listy, Row, Space, Tag, Typography } from "antd";
import { ListyItem } from "../../components/common/ListyItem";
import { Link } from "react-router-dom";
import type { Stats } from "../../types";
import { formatDateTime } from "../../utils/format";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function LatestCards({ stats }: { stats: Stats | undefined }) {
  // 本组件用模块级 t()，必须订阅语言变化。
  useLocale();
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card
            title={t("homePage.latest.jobs.title")}
            extra={<Link to="/jobs">{t("homePage.action.viewAll")}</Link>}
          >
            {(stats?.latest_jobs.length ?? 0) === 0 ? (
              <Empty description={t("homePage.latest.jobs.empty")} />
            ) : (
              <Listy
                items={stats?.latest_jobs ?? []}
                rowKey={(job) => job.id}
                itemRender={(job) => (
                  <ListyItem>
                    <Space>
                      <Link to="/jobs">{job.title}</Link>
                      <Tag>{job.company}</Tag>
                      <Typography.Text type="secondary">
                        {formatDateTime(job.created_at)}
                      </Typography.Text>
                    </Space>
                  </ListyItem>
                )}
              />
            )}
          </Card>
        </Col>
        <Col xs={24} lg={12}>
          <Card
            title={t("homePage.latest.resumes.title")}
            extra={<Link to="/resumes">{t("homePage.action.viewAll")}</Link>}
          >
            {(stats?.latest_resumes.length ?? 0) === 0 ? (
              <Empty description={t("homePage.latest.resumes.empty")} />
            ) : (
              <Listy
                items={stats?.latest_resumes ?? []}
                rowKey={(resume) => resume.id}
                itemRender={(resume) => (
                  <ListyItem>
                    <Space>
                      <Link to="/resumes">{resume.title}</Link>
                      <Typography.Text type="secondary">
                        {formatDateTime(resume.created_at)}
                      </Typography.Text>
                    </Space>
                  </ListyItem>
                )}
              />
            )}
          </Card>
        </Col>
      </Row>

      {(stats?.latest_applications.length ?? 0) > 0 && (
        <Card
          style={{ marginTop: 16 }}
          title={t("homePage.latest.applications.title")}
          extra={<Link to="/tracker">{t("homePage.action.viewProgress")}</Link>}
        >
          <Listy
            items={stats?.latest_applications ?? []}
            rowKey={(item) => item.id}
            itemRender={(item) => (
              <ListyItem>
                <Space>
                  <Link to="/tracker">{item.job_title || t("homePage.latest.untitledJob")}</Link>
                  <Tag>{item.company}</Tag>
                  <Typography.Text type="secondary">
                    {formatDateTime(item.updated_at)}
                  </Typography.Text>
                </Space>
              </ListyItem>
            )}
          />
        </Card>
      )}
    </>
  );
}
