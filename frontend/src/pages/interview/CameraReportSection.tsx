// SPDX-License-Identifier: Apache-2.0
/**
 * 报告里的「镜头与表达（实验性）」一节（F18）。
 *
 * 单独成组件的原因：`ReportCard` 已经 143 行，再塞播放器、指标条与删除确认会顶到
 * 500 行预算；而且这一节有**自己的取数**（录像是否存在），放在报告卡里会让一个纯展示
 * 组件开始发请求。
 *
 * 三个刻意的设计：
 * - 分数为 `null` 时**不显示 0 分**，而是"画面不足，无法评估"——0 分会被读成"表现极差"；
 * - 录像不存在时整块播放器不渲染（老数据 / 未开启录像都不会出现空播放器）；
 * - 「不进备份」这句常驻：用户换机器时不该以为文件丢了。
 */
import { DeleteOutlined, PlayCircleOutlined } from "@ant-design/icons";
import { Alert, App, Button, Popconfirm, Progress, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import {
  deleteInterviewRecording,
  getInterviewRecordingMeta,
  interviewRecordingUrl,
  type InterviewCameraAnalysis,
  type InterviewRecordingMeta,
} from "../../api/interview";
import { t } from "../../i18n";
import { formatEpochDate } from "../../utils/serverTime";
import { useLocale } from "../../i18n/i18nContext";

const METRIC_KEYS = [
  "face_visible",
  "gaze_at_camera",
  "head_stable",
  "framing_ok",
  "lighting_ok",
] as const;

export function CameraReportSection({
  sessionId,
  camera,
}: {
  sessionId: number;
  /** 报告里的 `report.camera`；没有分析过时为空。 */
  camera?: InterviewCameraAnalysis | null;
}) {
  useLocale();
  const { message } = App.useApp();
  const [meta, setMeta] = useState<InterviewRecordingMeta | null>(null);
  const [deleting, setDeleting] = useState(false);

  useEffect(() => {
    let alive = true;
    void getInterviewRecordingMeta(sessionId)
      .then((value) => {
        if (alive) setMeta(value);
      })
      .catch(() => undefined);
    return () => {
      alive = false;
    };
  }, [sessionId]);

  const remove = async () => {
    setDeleting(true);
    try {
      await deleteInterviewRecording(sessionId);
      setMeta(null);
      message.success(t("interviewCamera.report.deleted"));
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("interviewCamera.report.delete"));
    } finally {
      setDeleting(false);
    }
  };

  if (!camera && !meta) return null;

  const score = camera?.score ?? null;
  const metrics = camera?.metrics ?? {};
  const error = camera?.error ?? "";
  const insufficient = camera?.insufficient ?? score === null;

  return (
    <section className="interview-camera-report" aria-label={t("interviewCamera.report.title")}>
      <Space align="center" size={8} wrap>
        <Typography.Title level={5} style={{ margin: 0 }}>
          {t("interviewCamera.report.title")}
        </Typography.Title>
        {score !== null ? (
          <Tag color="blue">{t("interviewCamera.report.score", { score })}</Tag>
        ) : null}
        {camera?.count_in_total && camera.combined_score != null ? (
          <Tag color="purple">
            {t("interviewCamera.report.combined", { score: camera.combined_score })}
          </Tag>
        ) : null}
      </Space>

      {error ? (
        <Alert
          type="warning"
          showIcon
          title={t("interviewCamera.report.error", { reason: error })}
        />
      ) : null}

      {camera && insufficient ? (
        <Typography.Paragraph type="secondary" style={{ marginBottom: 0 }}>
          {t("interviewCamera.report.insufficient")}
          {camera.reason ? ` · ${camera.reason}` : ""}
        </Typography.Paragraph>
      ) : null}

      {camera && !insufficient ? (
        <>
          <Typography.Text type="secondary">
            {t("interviewCamera.report.frames", {
              analyzed: camera.analyzed_frames,
              visible: camera.visible_frames,
            })}
          </Typography.Text>
          <div className="interview-camera-metrics">
            {METRIC_KEYS.filter((key) => metrics[key] !== undefined).map((key) => (
              <div className="interview-camera-metric" key={key}>
                <Typography.Text type="secondary">
                  {t(`interviewCamera.metric.${key}`)}
                </Typography.Text>
                <Progress
                  percent={Math.round((metrics[key] ?? 0) * 100)}
                  size="small"
                  showInfo={false}
                />
              </div>
            ))}
          </div>
        </>
      ) : null}

      {camera?.notes?.length ? (
        <ul className="interview-camera-notes">
          {camera.notes.map((note) => (
            <li key={note}>{note}</li>
          ))}
        </ul>
      ) : null}

      {meta ? (
        <div className="interview-camera-playback">
          <Space align="center" size={6}>
            <PlayCircleOutlined aria-hidden="true" />
            <Typography.Text>{t("interviewCamera.report.playback")}</Typography.Text>
            {meta.expires_at ? (
              <Typography.Text type="secondary">{formatEpochDate(meta.expires_at)}</Typography.Text>
            ) : null}
          </Space>
          {/* 录像默认无音轨（getUserMedia audio:false），controls 仍保留进度拖动。 */}
          <video controls preload="metadata" src={interviewRecordingUrl(sessionId)} />
          <Space size={8} wrap>
            <Popconfirm
              title={t("interviewCamera.report.deleteConfirm")}
              okText={t("interviewCamera.report.delete")}
              cancelText={t("common.action.cancel")}
              onConfirm={() => void remove()}
            >
              <Button danger size="small" icon={<DeleteOutlined />} loading={deleting}>
                {t("interviewCamera.report.delete")}
              </Button>
            </Popconfirm>
            <Typography.Text type="secondary" style={{ fontSize: 12 }}>
              {t("interviewCamera.report.notInBackup")}
            </Typography.Text>
          </Space>
        </div>
      ) : null}
    </section>
  );
}

export default CameraReportSection;
