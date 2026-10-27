// SPDX-License-Identifier: Apache-2.0
/** 岗位详情抽屉：JD 全文、技能标签、投递链接与操作入口。 */
import {
  BulbOutlined,
  CheckCircleOutlined,
  EditOutlined,
  FileTextOutlined,
  FolderOpenOutlined,
  FunnelPlotOutlined,
  InfoCircleOutlined,
  LinkOutlined,
  MessageOutlined,
  PictureOutlined,
  PlayCircleOutlined,
  PushpinOutlined,
  RobotOutlined,
  SendOutlined,
  StarFilled,
  StarOutlined,
} from "@ant-design/icons";
import {
  Alert,
  Button,
  Descriptions,
  Divider,
  Drawer,
  Image,
  Space,
  Tooltip,
  Typography,
} from "antd";
import type { ReactNode } from "react";
import { useEffect, useState } from "react";
import { useNavigate } from "react-router-dom";
import type { Job } from "../types";
import { getMatchAnalyzingIds, subscribeMatchAnalysis } from "../utils/jobMatchAnalysisState";
import SkillTags from "./SkillTags";
import { t } from "../i18n";
import { useLocale } from "../i18n/i18nContext";

interface Props {
  job: Job | null;
  onClose: () => void;
  onGenerate: (job: Job) => void;
  onWrite: (job: Job) => void;
  onViewResumes: (job: Job) => void;
  onAnalyze: (job: Job) => void;
  onMatch: (job: Job) => void;
  onAddToQueue: (job: Job) => void;
  onAskAssistant: (job: Job) => void;
  onFavorite: (job: Job) => void;
  onOpenWebForm: (job: Job) => void;
  favoriteLoading?: boolean;
  queueLoading?: boolean;
  webFormLoading?: boolean;
}

interface TextSectionProps {
  title: string;
  icon: ReactNode;
  content: string;
  emptyText: string;
  variant: "description" | "requirements" | "additional" | "note";
}

function TextSection({ title, icon, content, emptyText, variant }: TextSectionProps) {
  return (
    <section className={`job-detail-text-section job-detail-text-section--${variant}`}>
      <div className="job-detail-section-heading">
        <span className="job-detail-section-icon">{icon}</span>
        <Typography.Text strong>{title}</Typography.Text>
      </div>
      <Typography.Paragraph type={content ? undefined : "secondary"} className="job-detail-text">
        {content || emptyText}
      </Typography.Paragraph>
    </section>
  );
}

export default function JobDetailDrawer({
  job,
  onClose,
  onGenerate,
  onWrite,
  onViewResumes,
  onAnalyze,
  onMatch,
  onAddToQueue,
  onAskAssistant,
  onFavorite,
  onOpenWebForm,
  favoriteLoading = false,
  queueLoading = false,
  webFormLoading = false,
}: Props) {
  useLocale();
  const navigate = useNavigate();
  // 匹配分析在弹窗（或用户已关掉弹窗）里后台进行时，这里也要看得见：
  // 订阅全局登记表，按钮转圈 + 文案点名，避免"后台在跑但界面毫无迹象"。
  const [matchAnalyzingIds, setMatchAnalyzingIds] =
    useState<ReadonlySet<number>>(getMatchAnalyzingIds);
  useEffect(
    () =>
      subscribeMatchAnalysis(() => {
        setMatchAnalyzingIds(new Set(getMatchAnalyzingIds()));
      }),
    [],
  );
  const matchAnalyzing = job != null && matchAnalyzingIds.has(job.id);
  return (
    <Drawer
      title={t("jobDetail.title")}
      size="min(640px, 100vw)"
      open={!!job}
      onClose={onClose}
      // 操作栏交给抽屉的 footer 插槽：它由抽屉布局常驻底部，内容不足一屏时
      // 也不会浮在正文中间；正文仍由 body 独立滚动。
      styles={{ footer: { padding: "12px 24px" } }}
      footer={
        job && (
          <Space className="job-detail-actions" wrap>
            <Button type="primary" icon={<FileTextOutlined />} onClick={() => onGenerate(job)}>
              {t("jobDetail.action.generate")}
            </Button>
            <Button icon={<EditOutlined />} onClick={() => onWrite(job)}>
              {t("jobDetail.action.write")}
            </Button>
            <Button icon={<FolderOpenOutlined />} onClick={() => onViewResumes(job)}>
              {t("jobDetail.action.viewResume")}
            </Button>
            {/* 两个"解读"性质不同，按钮相邻但用 Tooltip 讲清区别：需求解读只读 JD，
                匹配分析会读取你的资料与简历。 */}
            <Tooltip title={t("jobDetail.hint.readRequirement")}>
              <Button icon={<BulbOutlined />} onClick={() => onAnalyze(job)}>
                {t("jobDetail.action.readRequirement")}
              </Button>
            </Tooltip>
            <Tooltip
              title={
                matchAnalyzing ? t("jobDetail.hint.matchRunning") : t("jobDetail.hint.matchIdle")
              }
            >
              <Button
                icon={<RobotOutlined />}
                loading={matchAnalyzing}
                onClick={() => onMatch(job)}
              >
                {matchAnalyzing ? t("jobDetail.action.analyzing") : t("jobDetail.action.match")}
              </Button>
            </Tooltip>
            <Tooltip
              title={
                job.apply_supported === false
                  ? t("jobDetail.hint.unsupported")
                  : t("jobDetail.hint.applyDesk")
              }
            >
              <Button
                icon={<SendOutlined />}
                loading={queueLoading}
                disabled={queueLoading || job.apply_supported === false}
                onClick={() => onAddToQueue(job)}
              >
                {t("jobDetail.action.applyDesk")}
              </Button>
            </Tooltip>
            <Button icon={<MessageOutlined />} onClick={() => onAskAssistant(job)}>
              {t("jobDetail.action.askAssistant")}
            </Button>
            {/* 带 id 的跨模块动作（RF-11）：目标页按 job_id 自行过滤/预填，
                不必到了那边再选一遍岗位。纯跳页，无回调 prop。 */}
            <Button
              icon={<FunnelPlotOutlined />}
              onClick={() => navigate(`/tracker?job_id=${job.id}`)}
            >
              {t("jobDetail.section.progress")}
            </Button>
            <Button
              icon={<PlayCircleOutlined />}
              onClick={() => navigate(`/interview?job_id=${job.id}`)}
            >
              {t("jobDetail.action.interview")}
            </Button>
            {job.source_url && (
              <Button
                icon={<LinkOutlined />}
                loading={webFormLoading}
                disabled={webFormLoading}
                onClick={() => onOpenWebForm(job)}
              >
                {t("jobDetail.action.goApply")}
              </Button>
            )}
          </Space>
        )
      }
    >
      {job && (
        <>
          <div className="job-detail-title-row">
            <Typography.Title level={4} style={{ margin: 0 }}>
              {job.title}
            </Typography.Title>
            <Tooltip
              title={
                job.favorite ? t("jobDetail.action.unfavorite") : t("jobDetail.action.favorite")
              }
            >
              <Button
                type="text"
                aria-label={
                  job.favorite ? t("jobDetail.action.unfavorite") : t("jobDetail.action.favorite")
                }
                className={`job-favorite-button${job.favorite ? " is-favorite" : ""}`}
                icon={job.favorite ? <StarFilled /> : <StarOutlined />}
                loading={favoriteLoading}
                disabled={favoriteLoading}
                onClick={() => onFavorite(job)}
              />
            </Tooltip>
          </div>

          {/* 把原因写在页面上而不是只禁用按钮：用户是"手动录了一个岗位"，看到灰按钮会以为是 bug。 */}
          {job.apply_supported === false && (
            <Alert
              type="info"
              showIcon
              style={{ marginTop: 12 }}
              title={t("jobDetail.unsupported.title")}
              description={
                <Typography.Text type="secondary">
                  {t("jobDetail.unsupported.body")}
                </Typography.Text>
              }
            />
          )}

          <Descriptions column={2} size="small" style={{ marginTop: 16, marginBottom: 16 }}>
            <Descriptions.Item label={t("jobDetail.field.company")}>
              {job.company || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("jobDetail.field.location")}>
              {job.location || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("jobDetail.field.salary")}>
              {job.salary || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("jobDetail.field.jobType")}>
              {job.job_type || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("jobDetail.field.status")}>
              {job.status || "-"}
            </Descriptions.Item>
            <Descriptions.Item label={t("jobDetail.field.postedAt")}>
              {job.posted_at || "-"}
            </Descriptions.Item>
            {/* 「录入方式」是系统记录的这条岗位怎么进来的（手动填写/粘贴识别/采集…），
                与用户可编辑的「来源」是两回事；标签分开写，避免两个"来源"互相打架。 */}
            <Descriptions.Item label={t("jobDetail.field.recognitionSource")}>
              {/* i18n-ok: 录入方式的值是后端返回的协议值（RECOGNITION_SOURCES），不随界面语言变 */}
              {job.recognition_source || "手动"}
            </Descriptions.Item>
            {/* 0042 起「来源」是用户可编辑的独立字段（不再追加进备注）；没填就不占一行，
                免得详情里出现一排"-"里唯一有内容的是录入方式，看着像重复。 */}
            {job.origin_source && (
              <Descriptions.Item label={t("jobDetail.field.source")}>
                {job.origin_source}
              </Descriptions.Item>
            )}
          </Descriptions>

          {job.keywords.length > 0 && (
            <>
              <Divider titlePlacement="start" plain style={{ margin: "8px 0" }}>
                {t("jobDetail.section.skills")}
              </Divider>
              <SkillTags tags={job.keywords} max={20} />
            </>
          )}

          <div className="job-detail-text-sections">
            <TextSection
              title={t("jobDetail.section.description")}
              icon={<FileTextOutlined />}
              content={job.description}
              emptyText={t("jobDetail.empty.description")}
              variant="description"
            />
            <TextSection
              title={t("jobDetail.section.requirements")}
              icon={<CheckCircleOutlined />}
              content={job.requirements}
              emptyText={t("jobDetail.empty.requirements")}
              variant="requirements"
            />
            <TextSection
              title={t("jobDetail.section.extra")}
              icon={<InfoCircleOutlined />}
              content={job.additional_info}
              emptyText={t("jobDetail.empty.extra")}
              variant="additional"
            />
            <TextSection
              title={t("jobDetail.section.note")}
              icon={<PushpinOutlined />}
              content={job.note}
              emptyText={t("jobDetail.empty.note")}
              variant="note"
            />
            {(job.note_images?.length ?? 0) > 0 && (
              <section className="job-detail-text-section job-detail-text-section--note">
                <div className="job-detail-section-heading">
                  <span className="job-detail-section-icon">
                    <PictureOutlined />
                  </span>
                  <Typography.Text strong>{t("jobDetail.section.noteImages")}</Typography.Text>
                </div>
                <Space wrap>
                  {job.note_images.map((source, index) => (
                    <Image
                      key={`${index}-${source.slice(-16)}`}
                      src={source}
                      alt={t("jobDetail.alt.noteImage", { index: index + 1 })}
                      width={150}
                    />
                  ))}
                </Space>
              </section>
            )}
          </div>
        </>
      )}
    </Drawer>
  );
}
