// SPDX-License-Identifier: Apache-2.0
/** 手写简历时使用的岗位参考面板：只展示岗位快照，不参与简历保存。 */
import {
  CheckCircleOutlined,
  FileTextOutlined,
  InfoCircleOutlined,
  TagsOutlined,
} from "@ant-design/icons";
import { Descriptions, Typography } from "antd";
import type { ReactNode } from "react";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";
import { jobTypeLabelKey } from "../i18n/enum/jobs";
import type { Job } from "../types";
import SkillTags from "./SkillTags";

interface Props {
  job: Pick<
    Job,
    | "title"
    | "company"
    | "location"
    | "salary"
    | "job_type"
    | "description"
    | "requirements"
    | "keywords"
  > & {
    // 兼容正在迁移的旧前端类型；后端缺少该字段时按空内容展示。
    additional_info?: string;
  };
}

interface ReferenceSectionProps {
  title: string;
  icon: ReactNode;
  content: string;
  emptyText: string;
}

function ReferenceSection({ title, icon, content, emptyText }: ReferenceSectionProps) {
  return (
    <section className="job-reference-section">
      <div className="job-reference-section-heading">
        <span className="job-reference-section-icon" aria-hidden="true">
          {icon}
        </span>
        <Typography.Text strong>{title}</Typography.Text>
      </div>
      <Typography.Paragraph
        className="job-reference-section-content"
        type={content ? undefined : "secondary"}
      >
        {content || emptyText}
      </Typography.Paragraph>
    </section>
  );
}

export default function JobRequirementPanel({ job }: Props) {
  useLocale();
  // 岗位类型是落库的协议值，只有展示名走语言包；表里没有的取值原样显示。
  const jobTypeKey = jobTypeLabelKey(job.job_type);
  return (
    <aside
      className="job-reference-panel"
      aria-label={t("componentsMisc2.jobReference.ariaLabel", { title: job.title })}
    >
      <div className="job-reference-header">
        <Typography.Text className="job-reference-eyebrow">
          {t("componentsMisc2.jobReference.eyebrow")}
        </Typography.Text>
        <Typography.Title level={5} className="job-reference-title">
          {job.title}
        </Typography.Title>
        {job.company && <Typography.Text type="secondary">{job.company}</Typography.Text>}
      </div>

      {(job.location || job.job_type || job.salary) && (
        <Descriptions className="job-reference-meta" size="small" column={1} colon={false}>
          {job.location && (
            <Descriptions.Item label={t("componentsMisc2.jobReference.location")}>
              {job.location}
            </Descriptions.Item>
          )}
          {job.job_type && (
            <Descriptions.Item label={t("componentsMisc2.jobReference.type")}>
              {jobTypeKey ? t(jobTypeKey) : job.job_type}
            </Descriptions.Item>
          )}
          {job.salary && (
            <Descriptions.Item label={t("componentsMisc2.jobReference.salary")}>
              {job.salary}
            </Descriptions.Item>
          )}
        </Descriptions>
      )}

      <ReferenceSection
        title={t("componentsMisc2.jobReference.description")}
        icon={<FileTextOutlined />}
        content={job.description}
        emptyText={t("componentsMisc2.jobReference.emptyDescription")}
      />
      <ReferenceSection
        title={t("componentsMisc2.jobReference.requirements")}
        icon={<CheckCircleOutlined />}
        content={job.requirements}
        emptyText={t("componentsMisc2.jobReference.emptyRequirements")}
      />

      <section className="job-reference-section">
        <div className="job-reference-section-heading">
          <span className="job-reference-section-icon" aria-hidden="true">
            <TagsOutlined />
          </span>
          <Typography.Text strong>{t("componentsMisc2.jobReference.skills")}</Typography.Text>
        </div>
        {job.keywords.length > 0 ? (
          <SkillTags tags={job.keywords} max={20} />
        ) : (
          <Typography.Text type="secondary">
            {t("componentsMisc2.jobReference.emptySkills")}
          </Typography.Text>
        )}
      </section>

      <ReferenceSection
        title={t("componentsMisc2.jobReference.other")}
        icon={<InfoCircleOutlined />}
        content={job.additional_info ?? ""}
        emptyText={t("componentsMisc2.jobReference.emptyOther")}
      />
    </aside>
  );
}
