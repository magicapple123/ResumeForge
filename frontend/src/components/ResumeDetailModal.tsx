/** 简历记录预览弹窗（历史记录用）：加载详情与渲染 HTML 后展示。 */
import { Alert, Modal, Skeleton, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { getResume, fetchResumeHtml } from "../api/resumes";
import { RESUME_TONES } from "../config";
import type { ResumeDetail } from "../types";
import ExportButtons from "./ExportButtons";
import ResumePreview from "./ResumePreview";

interface Props {
  recordId: number | null;
  onClose: () => void;
}

export default function ResumeDetailModal({ recordId, onClose }: Props) {
  const [detail, setDetail] = useState<ResumeDetail | null>(null);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");

  useEffect(() => {
    if (!recordId) return;
    setDetail(null);
    setHtml("");
    setError("");
    void Promise.all([getResume(recordId), fetchResumeHtml(recordId)])
      .then(([data, rendered]) => {
        setDetail(data);
        setHtml(rendered);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [recordId]);

  const toneLabel = RESUME_TONES.find((tone) => tone.value === detail?.tone)?.label ?? detail?.tone;

  return (
    <Modal
      title={detail?.title ?? "简历预览"}
      open={!!recordId}
      onCancel={onClose}
      width={860}
      footer={null}
      destroyOnClose
    >
      {error ? (
        <Alert type="error" showIcon message={error} />
      ) : !detail || !html ? (
        <Skeleton active paragraph={{ rows: 8 }} />
      ) : (
        <div>
          <Space style={{ marginBottom: 12 }} wrap>
            <Tag color="blue">目标岗位：{detail.job_title || "-"}</Tag>
            {detail.company && <Tag>{detail.company}</Tag>}
            <Tag>模型：{detail.model || "-"}</Tag>
            {toneLabel && <Tag>风格：{toneLabel}</Tag>}
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              生成于 {detail.created_at.replace("T", " ").slice(0, 16)}
            </Typography.Text>
          </Space>
          <ResumePreview html={html} warnings={detail.warnings} />
          <div style={{ marginTop: 16, textAlign: "right" }}>
            <ExportButtons recordId={detail.id} />
          </div>
        </div>
      )}
    </Modal>
  );
}
