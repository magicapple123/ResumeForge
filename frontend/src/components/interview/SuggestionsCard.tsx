/** 简历改进建议卡片：反向优化产出的建议列表（优先级标签 + 依据）。
 *
 * 从 InterviewReviewPanel 拆出（2026-10-07，接近 500 行预算的预防性拆分）。
 * 只负责渲染；建议的生成与写回历史由父组件处理。
 */
import { BulbOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Listy, Space, Tag, Typography } from "antd";
import { ListyItem, ListyMeta } from "../common/ListyItem";
import type { InterviewOptimizeResult } from "../../types";

interface Props {
  suggestions: InterviewOptimizeResult["suggestions"];
  /** 提供时显示「去简历中心对照修改」入口。 */
  onGoToResume?: () => void;
}

const priorityColor = (priority: string) =>
  priority === "high" ? "red" : priority === "medium" ? "gold" : "default";

export default function SuggestionsCard({ suggestions, onGoToResume }: Props) {
  return (
    <Card size="small" title="简历改进建议">
      {suggestions.length === 0 ? (
        <Alert type="info" showIcon title="没有产出建议，试试补充更多面试暴露的短板或追问" />
      ) : (
        <Listy
          items={suggestions}
          rowKey={(item) => `${item.section}|${item.issue}|${item.suggestion}`}
          itemRender={(item) => (
            <ListyItem>
              <ListyMeta
                title={
                  <Space size={6} wrap>
                    <Tag color={priorityColor(item.priority)}>{item.priority}</Tag>
                    <span>{item.section}</span>
                    <Typography.Text type="secondary">{item.issue}</Typography.Text>
                  </Space>
                }
                description={
                  <Space orientation="vertical" size={2} style={{ width: "100%" }}>
                    <span>
                      <BulbOutlined /> {item.suggestion}
                    </span>
                    {item.evidence.length > 0 && (
                      <Typography.Text type="secondary">
                        依据：{item.evidence.join("；")}
                      </Typography.Text>
                    )}
                  </Space>
                }
              />
            </ListyItem>
          )}
        />
      )}
      {onGoToResume && (
        <Button type="link" style={{ paddingLeft: 0 }} onClick={onGoToResume}>
          去简历中心对照修改 →
        </Button>
      )}
    </Card>
  );
}
