/** 复盘：三段结论 + 行动清单 + 复练队列。 */
import { Alert, Listy, Space, Tag, Typography } from "antd";
import { ListyItem } from "../../components/common/ListyItem";
import { LISTY_ITEM_PADDING_SMALL } from "../../components/common/listyPadding";
import type { DrillSession } from "../../types";
import { ACTION_KIND_HINTS } from "../../types";
import { RehearsalPanel } from "./RehearsalPanel";

export function ReviewPanel({ session }: { session: DrillSession }) {
  const review = session.review;
  return (
    <Space orientation="vertical" size={12} style={{ width: "100%" }}>
      {review.covered && (
        <Typography.Paragraph style={{ marginBottom: 0 }}>{review.covered}</Typography.Paragraph>
      )}
      {review.verified_summary && (
        <Alert type="success" showIcon title="讲得清的" description={review.verified_summary} />
      )}
      {review.gaps_summary && (
        <Alert type="warning" showIcon title="还站不住的" description={review.gaps_summary} />
      )}

      {(review.actions?.length ?? 0) > 0 && (
        <div>
          <Typography.Text strong>面试前的行动清单</Typography.Text>
          <Listy
            items={review.actions ?? []}
            rowKey={(item) => `${item.kind}|${item.claim_title}|${item.detail}`}
            styles={{ item: { ...LISTY_ITEM_PADDING_SMALL } }}
            itemRender={(item) => (
              <ListyItem>
                <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                  <Space size={6} wrap>
                    <Tag
                      color={
                        item.kind === "降表述" ? "red" : item.kind === "补知识" ? "blue" : "gold"
                      }
                    >
                      {item.kind}
                    </Tag>
                    <Typography.Text strong>{item.claim_title}</Typography.Text>
                  </Space>
                  <Typography.Text>{item.detail}</Typography.Text>
                  {ACTION_KIND_HINTS[item.kind] && (
                    <Typography.Text type="secondary" style={{ fontSize: 12 }}>
                      {ACTION_KIND_HINTS[item.kind]}
                    </Typography.Text>
                  )}
                </Space>
              </ListyItem>
            )}
          />
        </div>
      )}

      <div>
        <Typography.Text strong>复练队列</Typography.Text>
        <RehearsalPanel sessionId={session.id} />
      </div>
    </Space>
  );
}
