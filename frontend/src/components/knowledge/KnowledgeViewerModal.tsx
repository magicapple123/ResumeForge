// SPDX-License-Identifier: Apache-2.0
/**
 * 知识条目详情弹窗（#29C/#29D/#29E）：分类/公司/关联岗位/标签/来源 + reason +
 * 摘要 + 要点 + Markdown 正文。
 *
 * 列表行只有摘要（content_excerpt），全文由页面在打开时取详情再传进来；弹窗本身
 * 只读（footer=null，关闭只走右上角 ×），与全站只读弹窗口径一致。
 */
import { Modal, Space, Tag, Typography } from "antd";
import { AssistantMessageContent } from "../../features/assistant/components/AssistantMessageContent";
import { knowledgeCategoryLabel } from "../../i18n/enum/knowledge";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { formatDateTime } from "../../utils/format";
import type { Knowledge } from "../../types";

interface Props {
  open: boolean;
  loading: boolean;
  entry: Knowledge | null;
  onClose: () => void;
}

export default function KnowledgeViewerModal({ open, loading, entry, onClose }: Props) {
  useLocale();
  const keyPoints = (entry?.key_points ?? []).filter(Boolean);
  return (
    <Modal
      open={open}
      title={entry?.title}
      width={760}
      footer={null}
      onCancel={onClose}
      mask={{ closable: false }}
    >
      {loading || !entry ? (
        <Typography.Text type="secondary">{t("knowledgePage.semantic.loading")}</Typography.Text>
      ) : (
        <>
          <Space wrap style={{ marginBottom: 8 }}>
            <Tag color={entry.category ? "blue" : "default"}>
              {entry.category
                ? knowledgeCategoryLabel(entry.category)
                : t("knowledgePage.filter.category.uncategorized")}
            </Tag>
            {entry.company ? (
              <Tag>{t("knowledgePage.card.company", { company: entry.company })}</Tag>
            ) : null}
            {entry.job_id ? <Tag>{t("knowledgePage.card.job", { id: entry.job_id })}</Tag> : null}
            {entry.tags.map((tag) => (
              <Tag key={tag}>{tag}</Tag>
            ))}
            {entry.source ? (
              <Typography.Text type="secondary">{entry.source}</Typography.Text>
            ) : null}
            <Typography.Text type="secondary">
              {t("knowledgePage.card.updated", { time: formatDateTime(entry.updated_at) })}
            </Typography.Text>
          </Space>
          {entry.reason ? (
            <Typography.Paragraph type="secondary" style={{ marginBottom: 8 }}>
              {t("knowledgePage.card.reason", { reason: entry.reason })}
            </Typography.Paragraph>
          ) : null}
          {entry.summary ? (
            <div style={{ marginBottom: 8 }}>
              <Typography.Text strong>{t("knowledgePage.card.summary")}</Typography.Text>
              <Typography.Paragraph style={{ marginBottom: 0 }}>
                {entry.summary}
              </Typography.Paragraph>
            </div>
          ) : null}
          {keyPoints.length > 0 ? (
            <div style={{ marginBottom: 8 }}>
              <Typography.Text strong>{t("knowledgePage.card.keyPoints")}</Typography.Text>
              <ul style={{ margin: "4px 0 0", paddingInlineStart: 20 }}>
                {keyPoints.map((point) => (
                  <li key={point}>{point}</li>
                ))}
              </ul>
            </div>
          ) : null}
          <div className="knowledge-card-content">
            <AssistantMessageContent content={entry.content} />
          </div>
        </>
      )}
    </Modal>
  );
}
