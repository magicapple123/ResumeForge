// SPDX-License-Identifier: Apache-2.0
/** 历史复盘折叠列表：加载/错误/空态与「查看详情」富还原入口。
 *
 * 从 InterviewReviewPanel 拆出（2026-10-07，接近 500 行预算的预防性拆分）。
 * 只负责展示与行内操作；数据的增删改查（删除/刷新）由父组件经回调提供。
 */
import { DeleteOutlined, HistoryOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Collapse, Space, Typography } from "antd";
import EmptyState from "../common/EmptyState";
import { RowActions } from "../common/RowActions";
import type { InterviewReviewRecord } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  /** ``null`` 表示尚未加载完成（与父组件 useApi 的 data 语义对齐）。 */
  reviews: InterviewReviewRecord[] | null;
  loading: boolean;
  error: string | null;
  /** 点击「查看详情」时回调，由父组件接管选中。 */
  onOpenRecord?: (record: InterviewReviewRecord) => void;
  onRemove: (id: number) => void;
}

export default function ReviewHistoryCard({
  reviews,
  loading,
  error,
  onOpenRecord,
  onRemove,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const items = (reviews ?? []).map((review) => ({
    key: String(review.id),
    label: (
      <Space wrap>
        <span>
          {review.resume_title || review.job_title || t("interview.reviewHistory.fallbackTitle")}
        </span>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {review.created_at.replace("T", " ").slice(0, 16)}
        </Typography.Text>
      </Space>
    ),
    children: (
      <Space orientation="vertical" style={{ width: "100%" }}>
        {review.questions.length > 0 && (
          <>
            <Typography.Text strong>
              {t("interview.reviewHistory.section.questions")}
            </Typography.Text>
            <ul style={{ paddingLeft: 20, margin: "4px 0" }}>
              {review.questions.map((item) => (
                <li key={item}>{item}</li>
              ))}
            </ul>
          </>
        )}
        {review.analysis?.framework && (
          <Typography.Paragraph style={{ margin: 0 }}>
            {review.analysis.framework}
          </Typography.Paragraph>
        )}
        {review.suggestions.length > 0 && (
          <>
            <Typography.Text strong>{t("interview.suggestions.title")}</Typography.Text>
            <ul style={{ paddingLeft: 20, margin: "4px 0" }}>
              {review.suggestions.map((item) => (
                <li key={item.suggestion}>{item.suggestion}</li>
              ))}
            </ul>
          </>
        )}
        <Space wrap>
          {onOpenRecord && (
            <Button size="small" onClick={() => onOpenRecord(review)}>
              {t("interview.reviewHistory.action.detail")}
            </Button>
          )}
          <RowActions
            more={[
              {
                key: "delete",
                label: t("interview.reviewHistory.action.delete"),
                danger: true,
                icon: <DeleteOutlined />,
                confirm: t("interview.reviewHistory.confirm.delete"),
                onClick: () => onRemove(review.id),
              },
            ]}
          />
        </Space>
      </Space>
    ),
  }));

  return (
    <Card
      size="small"
      title={
        <Space>
          <HistoryOutlined />
          {t("interview.reviewHistory.title")}
        </Space>
      }
    >
      {loading && !reviews ? (
        <Alert type="info" showIcon title={t("interview.reviewHistory.loading")} />
      ) : error ? (
        <Alert type="error" showIcon title={error} />
      ) : (reviews ?? []).length === 0 ? (
        <EmptyState inline description={t("interview.reviewHistory.empty")} />
      ) : (
        <Collapse items={items} />
      )}
    </Card>
  );
}
