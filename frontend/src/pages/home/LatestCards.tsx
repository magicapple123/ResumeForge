/**
 * 最近动态三卡：最近岗位 / 最近生成的简历 / 最近投出去的。
 * （自 HomePage 拆出，逐字搬运，行为等价。）
 */
import { Card, Col, Empty, Listy, Row, Space, Tag, Typography } from "antd";
import { ListyItem } from "../../components/common/ListyItem";
import { Link } from "react-router-dom";
import type { Stats } from "../../types";
import { formatDateTime } from "../../utils/format";

export function LatestCards({ stats }: { stats: Stats | undefined }) {
  return (
    <>
      <Row gutter={[16, 16]} style={{ marginTop: 16 }}>
        <Col xs={24} lg={12}>
          <Card title="最近岗位" extra={<Link to="/jobs">查看全部</Link>}>
            {(stats?.latest_jobs.length ?? 0) === 0 ? (
              <Empty description="暂无岗位，去「岗位广场」手动添加" />
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
          <Card title="最近生成的简历" extra={<Link to="/resumes">查看全部</Link>}>
            {(stats?.latest_resumes.length ?? 0) === 0 ? (
              <Empty description="暂无简历记录，去「岗位广场」选个岗位试试" />
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
          title="最近投出去的"
          extra={<Link to="/tracker">看进度</Link>}
        >
          <Listy
            items={stats?.latest_applications ?? []}
            rowKey={(item) => item.id}
            itemRender={(item) => (
              <ListyItem>
                <Space>
                  <Link to="/tracker">{item.job_title || "未命名岗位"}</Link>
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
