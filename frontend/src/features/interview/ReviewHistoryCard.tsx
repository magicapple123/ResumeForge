// SPDX-License-Identifier: Apache-2.0
/** 历史复盘折叠列表：加载/错误/空态 + 行尾操作 + 折叠摘要。
 *
 * 从 InterviewReviewPanel 拆出（2026-10-07，接近 500 行预算的预防性拆分）。
 * 只负责展示与行内操作；数据的增删改查（删除/刷新）由父组件经回调提供。
 *
 * Q3 起三处口径变化（都是"屏幕上只该有一份内容"的直接后果）：
 * 1. **操作在行尾**：`查看详情` 与删除移进 `Collapse` 的 `extra`，不必先展开再找按钮；
 * 2. **整行可进**：点标题直接打开富还原视图（父组件接管，历史列表随之消失），
 *    `extra` 里的按钮 `stopPropagation`，不会连带触发；
 * 3. **折叠内容降级为摘要**：问题首句 + framework 前 N 字 + "N 条改进建议"。以前这里
 *    把 questions / framework / suggestions 三段完整渲染，展开一条就等于把详情页又抄一遍。
 */
import { DeleteOutlined, HistoryOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Collapse, Space, Typography } from "antd";
import EmptyState from "../../components/common/EmptyState";
import { RowActions } from "../../components/common/RowActions";
import type { InterviewReviewRecord } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { formatServerTime } from "../../utils/serverTime";

interface Props {
  /** ``null`` 表示尚未加载完成（与父组件 useApi 的 data 语义对齐）。 */
  reviews: InterviewReviewRecord[] | null;
  loading: boolean;
  error: string | null;
  /** 点击「查看详情」或整行时回调，由父组件接管选中。 */
  onOpenRecord?: (record: InterviewReviewRecord) => void;
  onRemove: (id: number) => void;
}

/** 摘要长度：够看出这是哪一段，又不至于把折叠区撑成一屏。 */
const QUESTION_CHARS = 80;
const FRAMEWORK_CHARS = 60;

/** 截断并补省略号；两端都去空白，避免多行输入把摘要撑开。 */
function clip(text: string | undefined, limit: number): string {
  const cleaned = (text ?? "").replace(/\s+/g, " ").trim();
  if (cleaned.length <= limit) return cleaned;
  return `${cleaned.slice(0, limit)}…`;
}

/** 历史记录的 framework 可能是纯文本（旧版）或被模型写成非字符串：取值一律兜底。 */
function frameworkOf(review: InterviewReviewRecord): string {
  const framework = (review.analysis as { framework?: unknown } | null)?.framework;
  return typeof framework === "string" ? framework : "";
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
  const items = (reviews ?? []).map((review) => {
    const question = clip(review.questions?.[0], QUESTION_CHARS);
    const framework = clip(frameworkOf(review), FRAMEWORK_CHARS);
    const suggestionCount = review.suggestions?.length ?? 0;
    const open = onOpenRecord ? () => onOpenRecord(review) : undefined;
    return {
      key: String(review.id),
      label: (
        <Space
          wrap
          // 整行可点：不用先展开折叠、再找行尾的「查看详情」。
          onClick={open}
          style={{ cursor: open ? "pointer" : undefined }}
        >
          <span>
            {review.resume_title || review.job_title || t("interview.reviewHistory.fallbackTitle")}
          </span>
          <Typography.Text type="secondary" style={{ fontSize: 12 }}>
            {formatServerTime(review.created_at)}
          </Typography.Text>
        </Space>
      ),
      // 行尾操作：`stopPropagation` 让「删除」/「查看详情」不连带触发整行的打开。
      extra: (
        <Space size={4} onClick={(event) => event.stopPropagation()}>
          {onOpenRecord && (
            <Button size="small" type="link" onClick={() => onOpenRecord(review)}>
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
      ),
      children: (
        <Space orientation="vertical" style={{ width: "100%" }} size={4}>
          {/* 摘要而不是全文：完整的 questions / framework / suggestions 在「查看详情」里。 */}
          {question && <Typography.Text>{question}</Typography.Text>}
          {framework && <Typography.Text type="secondary">{framework}</Typography.Text>}
          {suggestionCount > 0 && (
            <Typography.Text type="secondary">
              {t("interviewReview.history.summary.suggestions", { count: suggestionCount })}
            </Typography.Text>
          )}
          {!question && !framework && suggestionCount === 0 && (
            <Typography.Text type="secondary">
              {t("interviewReview.history.summary.empty")}
            </Typography.Text>
          )}
        </Space>
      ),
    };
  });

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
