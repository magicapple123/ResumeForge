/** 岗位详情抽屉：JD 全文、技能标签、投递链接与操作入口。 */
import { FileTextOutlined, LinkOutlined } from "@ant-design/icons";
import { Button, Descriptions, Divider, Drawer, Space, Typography } from "antd";
import type { Job } from "../types";
import SkillTags from "./SkillTags";

interface Props {
  job: Job | null;
  onClose: () => void;
  onGenerate: (job: Job) => void;
}

export default function JobDetailDrawer({ job, onClose, onGenerate }: Props) {
  return (
    <Drawer title="岗位详情" width={640} open={!!job} onClose={onClose}>
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

          <Divider orientation="left" plain style={{ margin: "8px 0" }}>
            职位描述
          </Divider>
          <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
            {job.description || "暂无描述"}
          </Typography.Paragraph>

          {job.requirements && (
            <>
              <Divider orientation="left" plain style={{ margin: "8px 0" }}>
                任职要求
              </Divider>
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                {job.requirements}
              </Typography.Paragraph>
            </>
          )}

          {job.note && (
            <>
              <Divider orientation="left" plain style={{ margin: "8px 0" }}>
                备注
              </Divider>
              <Typography.Paragraph style={{ whiteSpace: "pre-wrap" }}>
                {job.note}
              </Typography.Paragraph>
            </>
          )}

          <Space style={{ marginTop: 16 }}>
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
