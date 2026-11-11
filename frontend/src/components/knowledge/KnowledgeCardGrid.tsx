// SPDX-License-Identifier: Apache-2.0
/**
 * 知识库卡片网格（#29C/#29D/#29E）：reason、摘要、关键点、公司 chip 与分类标签。
 *
 * 卡片本身就是「打开详情」的触发器（DetailTrigger），行操作/右键菜单与改版前一致：
 * 编辑、删除（软删由页面兜 5 秒撤销）、批量选择入口。列表响应只有 content_excerpt，
 * 正文全文在打开详情/编辑时再取——卡片不读全文。
 */
import { CheckSquareOutlined, DeleteOutlined, EditOutlined } from "@ant-design/icons";
import { Card, Checkbox, Tag, Typography } from "antd";
import { useMemo } from "react";
import type { ReactNode } from "react";
import { DetailTrigger } from "../common/RecordDetail";
import { RowActions, RowContextMenu } from "../common/RowActions";
import { knowledgeCategoryLabel } from "../../i18n/enum/knowledge";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { formatDateTime } from "../../utils/format";
import type { KnowledgeSummary } from "../../types";

interface Props {
  entries: KnowledgeSummary[];
  selecting: boolean;
  selectedIds: ReadonlySet<number>;
  onToggleSelect: (id: number) => void;
  onOpen: (entry: KnowledgeSummary) => void;
  onEdit: (entry: KnowledgeSummary) => void;
  onDelete: (entry: KnowledgeSummary) => void;
  onEnterSelecting: () => void;
}

function categoryLabel(entry: KnowledgeSummary): string {
  // #29G：分类可为空 = 未分类；空串没有协议展示名，页面侧补一个中性文案。
  return entry.category
    ? knowledgeCategoryLabel(entry.category)
    : t("knowledgePage.filter.category.uncategorized");
}

export default function KnowledgeCardGrid({
  entries,
  selecting,
  selectedIds,
  onToggleSelect,
  onOpen,
  onEdit,
  onDelete,
  onEnterSelecting,
}: Props) {
  useLocale();

  const actionsFor = useMemo(
    () => (entry: KnowledgeSummary) => {
      const more = [
        {
          key: "edit",
          label: t("knowledgePage.action.edit"),
          icon: <EditOutlined />,
          onClick: () => onEdit(entry),
        },
        {
          key: "delete",
          label: t("knowledgePage.action.delete"),
          danger: true,
          icon: <DeleteOutlined />,
          undo: true,
          onClick: () => onDelete(entry),
        },
      ];
      const all = selecting
        ? []
        : [
            {
              key: "batch_select",
              label: t("knowledgePage.action.batchSelect"),
              icon: <CheckSquareOutlined />,
              onClick: onEnterSelecting,
            },
            ...more,
          ];
      return {
        primary: [] as { key: string; label: string; icon?: ReactNode; onClick: () => void }[],
        more,
        all,
      };
    },
    [selecting, onEdit, onDelete, onEnterSelecting],
  );

  return (
    <div className="knowledge-grid">
      {entries.map((entry) => {
        const { primary, more, all } = actionsFor(entry);
        const keyPoints = (entry.key_points ?? []).filter(Boolean);
        const summary = (entry.summary ?? "").trim();
        return (
          // 右键菜单挂在 DOM 元素上（DetailTrigger 不透传 ref/事件，直接包它会失效）。
          <RowContextMenu key={entry.id} items={all}>
            <div>
              <DetailTrigger
                label={t("knowledgePage.card.openAria", { title: entry.title })}
                onOpen={() => onOpen(entry)}
              >
                <Card size="small" className="knowledge-card">
                  <div className="knowledge-card-head">
                    {selecting && (
                      <Checkbox
                        aria-label={t("knowledgePage.card.selectAria", { title: entry.title })}
                        checked={selectedIds.has(entry.id)}
                        onClick={(event) => event.stopPropagation()}
                        onChange={() => onToggleSelect(entry.id)}
                      />
                    )}
                    <Tag color={entry.category ? "blue" : "default"}>{categoryLabel(entry)}</Tag>
                    <RowActions primary={primary} more={more} disabled={selecting} />
                  </div>
                  <Typography.Title level={5} ellipsis={{ tooltip: entry.title }}>
                    {entry.title}
                  </Typography.Title>
                  <div className="knowledge-card-meta">
                    {entry.company ? (
                      <Tag>{t("knowledgePage.card.company", { company: entry.company })}</Tag>
                    ) : null}
                    {entry.job_id ? (
                      <Tag>{t("knowledgePage.card.job", { id: entry.job_id })}</Tag>
                    ) : null}
                  </div>
                  {entry.reason ? (
                    <Typography.Paragraph
                      type="secondary"
                      ellipsis={{ rows: 2 }}
                      style={{ marginBottom: 4 }}
                    >
                      {t("knowledgePage.card.reason", { reason: entry.reason })}
                    </Typography.Paragraph>
                  ) : null}
                  {summary ? (
                    <Typography.Paragraph ellipsis={{ rows: 3 }} style={{ marginBottom: 4 }}>
                      {summary}
                    </Typography.Paragraph>
                  ) : entry.content_excerpt ? (
                    <Typography.Paragraph
                      type="secondary"
                      ellipsis={{ rows: 3 }}
                      className="knowledge-card-content"
                    >
                      {entry.content_excerpt}
                    </Typography.Paragraph>
                  ) : null}
                  {keyPoints.length > 0 ? (
                    <ul style={{ margin: "0 0 4px", paddingInlineStart: 18 }}>
                      {keyPoints.slice(0, 3).map((point) => (
                        <li key={point}>
                          <Typography.Text type="secondary" ellipsis>
                            {point}
                          </Typography.Text>
                        </li>
                      ))}
                    </ul>
                  ) : null}
                  {entry.tags.length > 0 && (
                    <div className="knowledge-card-tags">
                      {entry.tags.map((tag) => (
                        <Tag key={tag}>{tag}</Tag>
                      ))}
                    </div>
                  )}
                  <div className="knowledge-card-meta">
                    {entry.source ? (
                      <Typography.Text type="secondary">{entry.source}</Typography.Text>
                    ) : null}
                    <Typography.Text type="secondary">
                      {formatDateTime(entry.updated_at)}
                    </Typography.Text>
                  </div>
                </Card>
              </DetailTrigger>
            </div>
          </RowContextMenu>
        );
      })}
    </div>
  );
}
