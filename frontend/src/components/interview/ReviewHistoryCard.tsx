/** 历史复盘折叠列表：加载/错误/空态与「查看详情」富还原入口。
 *
 * 从 InterviewReviewPanel 拆出（2026-10-07，接近 500 行预算的预防性拆分）。
 * 只负责展示与行内操作；数据的增删改查（删除/重新加载）由父组件经回调提供。
 */
import { DeleteOutlined, HistoryOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Collapse, Empty, Space, Typography } from "antd";
import { RowActions } from "../common/RowActions";
import type { InterviewReviewRecord } from "../../types";

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
  const items = (reviews ?? []).map((review) => ({
    key: String(review.id),
    label: (
      <Space wrap>
        <span>{review.resume_title || review.job_title || "复盘"}</span>
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          {review.created_at.replace("T", " ").slice(0, 16)}
        </Typography.Text>
      </Space>
    ),
    children: (
      <Space orientation="vertical" style={{ width: "100%" }}>
        {review.questions.length > 0 && (
          <>
            <Typography.Text strong>真实问题</Typography.Text>
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
            <Typography.Text strong>简历改进建议</Typography.Text>
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
              查看详情
            </Button>
          )}
          <RowActions
            more={[
              {
                key: "delete",
                label: "删除复盘历史",
                danger: true,
                icon: <DeleteOutlined />,
                confirm: "删除这条复盘历史？",
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
          历史复盘
        </Space>
      }
    >
      {loading && !reviews ? (
        <Alert type="info" showIcon title="加载中…" />
      ) : error ? (
        <Alert type="error" showIcon title={error} />
      ) : (reviews ?? []).length === 0 ? (
        <Empty image={Empty.PRESENTED_IMAGE_SIMPLE} description="还没有保存过复盘" />
      ) : (
        <Collapse items={items} />
      )}
    </Card>
  );
}
