/** 岗位详情抽屉：JD 全文、技能标签、投递链接与操作入口。 */
import { CheckCircleOutlined, FileTextOutlined, LinkOutlined, PushpinOutlined } from "@ant-design/icons";
import { Button, Descriptions, Divider, Drawer, Space, Typography } from "antd";
import type { ReactNode } from "react";
import type { Job } from "../types";
import SkillTags from "./SkillTags";

interface Props {
  job: Job | null;
  onClose: () => void;
  onGenerate: (job: Job) => void;
}

interface TextSectionProps {
  title: string;
  icon: ReactNode;
  content: string;
  emptyText: string;
  variant: "description" | "requirements" | "note";
}

function TextSection({ title, icon, content, emptyText, variant }: TextSectionProps) {
  return (
    <section className={`job-detail-text-section job-detail-text-section--${variant}`}>
      <div className="job-detail-section-heading">
        <span className="job-detail-section-icon">{icon}</span>
        <Typography.Text strong>{title}</Typography.Text>
      </div>
      <Typography.Paragraph
        type={content ? undefined : "secondary"}
        className="job-detail-text"
      >
        {content || emptyText}
      </Typography.Paragraph>
    </section>
  );
}

export default function JobDetailDrawer({ job, onClose, onGenerate }: Props) {
  return (
    <Drawer title="岗位详情" width="min(640px, 100vw)" open={!!job} onClose={onClose}>
      {job && (
        <>
          <Typography.Title level={4} style={{ marginTop: 0 }}>
            {job.title}
          </Typography.Title>
          <Descriptions column={2} size="small" style={{ marginBottom: 16 }}>
            <Descriptions.Item label="公司">{job.company || "-"}</Descriptions.Item>
            <Descriptions.Item label="工作地点">{job.location || "-"}</Descriptions.Item>
            <Descriptions.Item label="薪资范围">{job.salary || "-"}</Descriptions.Item>
            <Descriptions.Item label="岗位类型">{job.job_type || "-"}</Descriptions.Item>
            <Descriptions.Item label="状态">{job.status || "-"}</Descriptions.Item>
          </Descriptions>

          {job.keywords.length > 0 && (
            <>
              <Divider orientation="left" plain style={{ margin: "8px 0" }}>
                岗位技能标签
              </Divider>
              <SkillTags tags={job.keywords} max={20} />
            </>
          )}

          <div className="job-detail-text-sections">
            <TextSection
              title="职位描述"
              icon={<FileTextOutlined />}
              content={job.description}
              emptyText="暂无职位描述"
              variant="description"
            />
            <TextSection
              title="任职要求"
              icon={<CheckCircleOutlined />}
              content={job.requirements}
              emptyText="暂无任职要求"
              variant="requirements"
            />
            <TextSection
              title="备注"
              icon={<PushpinOutlined />}
              content={job.note}
              emptyText="暂无备注"
              variant="note"
            />
          </div>

          <Space className="job-detail-actions">
            <Button type="primary" icon={<FileTextOutlined />} onClick={() => onGenerate(job)}>
              用 AI 生成简历
            </Button>
            {job.source_url && (
              <Button
                icon={<LinkOutlined />}
                href={job.source_url}
                target="_blank"
                rel="noopener noreferrer"
              >
                前往投递
              </Button>
            )}
          </Space>
        </>
      )}
    </Drawer>
  );
}
