// SPDX-License-Identifier: Apache-2.0
/** 简历改进建议卡片：反向优化产出的建议列表（优先级标签 + 依据）。
 *
 * 从 InterviewReviewPanel 拆出（2026-10-07，接近 500 行预算的预防性拆分）。
 * 只负责渲染；建议的生成与写回历史由父组件处理。
 */
import { BulbOutlined } from "@ant-design/icons";
import { Alert, Button, Card, Listy, Space, Tag, Typography } from "antd";
import { ListyItem, ListyMeta } from "../common/ListyItem";
import type { InterviewOptimizeResult } from "../../types";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

interface Props {
  suggestions: InterviewOptimizeResult["suggestions"];
  /** 提供时显示「去简历中心对照修改」入口。 */
  onGoToResume?: () => void;
}

const priorityColor = (priority: string) =>
  priority === "high" ? "red" : priority === "medium" ? "gold" : "default";

export default function SuggestionsCard({ suggestions, onGoToResume }: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <Card size="small" title={t("interview.suggestions.title")}>
      {suggestions.length === 0 ? (
        <Alert type="info" showIcon title={t("interview.suggestions.empty")} />
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
                        {t("interview.suggestions.evidence", {
                          evidence: item.evidence.join(t("interview.listSeparator")),
                        })}
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
          {t("interview.suggestions.goToResume")}
        </Button>
      )}
    </Card>
  );
}
