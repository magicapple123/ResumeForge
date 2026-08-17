/** 简历记录预览弹窗（历史记录用）：加载详情与渲染 HTML 后展示。 */
import { EditOutlined } from "@ant-design/icons";
import { Alert, App, Button, Modal, Skeleton, Space, Tag, Typography } from "antd";
import { useEffect, useState } from "react";
import { getResume, fetchResumeHtml, renderResume, updateResume } from "../api/resumes";
import { RESUME_ENHANCEMENT_LEVELS } from "../config";
import type { ResumeContent, ResumeDetail } from "../types";
import ExportButtons from "./ExportButtons";
import ResumeEditorModal from "./ResumeEditorModal";
import ResumePreview from "./ResumePreview";

interface Props {
  recordId: number | null;
  onClose: () => void;
}

export default function ResumeDetailModal({ recordId, onClose }: Props) {
  const { message } = App.useApp();
  const [detail, setDetail] = useState<ResumeDetail | null>(null);
  const [html, setHtml] = useState("");
  const [error, setError] = useState("");
  const [editorOpen, setEditorOpen] = useState(false);

  useEffect(() => {
    if (!recordId) return;
    setDetail(null);
    setHtml("");
    setError("");
    setEditorOpen(false);
    void Promise.all([getResume(recordId), fetchResumeHtml(recordId)])
      .then(([data, rendered]) => {
        setDetail(data);
        setHtml(rendered);
      })
      .catch((err) => setError(err instanceof Error ? err.message : "加载失败"));
  }, [recordId]);

  const enhancementLabel = RESUME_ENHANCEMENT_LEVELS.find(
    (item) => item.value === detail?.enhancement_level,
  )?.label;

  const saveEditedResume = async (content: ResumeContent) => {
    if (!detail) return;
    const updated = await updateResume(detail.id, content);
    const rendered = await renderResume(updated.content);
    setDetail(updated);
    setHtml(rendered);
    message.success("简历修改已保存");
  };

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
            <Tag color={detail.enhancement_enabled ? "green" : undefined}>
              美化拓展：{detail.enhancement_enabled ? enhancementLabel ?? "已开启" : "未开启"}
            </Tag>
            <Typography.Text type="secondary" style={{ fontSize: 13 }}>
              生成于 {detail.created_at.replace("T", " ").slice(0, 16)}
            </Typography.Text>
          </Space>
          <ResumePreview html={html} warnings={detail.warnings} />
          <div style={{ marginTop: 16, display: "flex", justifyContent: "space-between", alignItems: "center" }}>
            <Button icon={<EditOutlined />} onClick={() => setEditorOpen(true)}>
              微调内容
            </Button>
            <ExportButtons recordId={detail.id} />
          </div>
        </div>
      )}
      <ResumeEditorModal
        open={editorOpen}
        content={detail?.content ?? null}
        onClose={() => setEditorOpen(false)}
        onSave={saveEditedResume}
      />
    </Modal>
  );
}
