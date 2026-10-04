/** 三类题库分组卡：岗位基础 / 项目深挖 / 反问 HR 的题目与参考答案展开。
 *
 * 纯展示组件——参考答案的生成与写回（toggleAnswer）留在 QuestionBankPanel，经回调回传；
 * 零 api 导入（白名单契约：新文件不得触碰 api/interview）。
 */
import { BulbOutlined } from "@ant-design/icons";
import { Button, Card, Space, Typography } from "antd";
import { QUESTION_BANK_TYPES } from "../../types";
import type { QuestionAnswer, QuestionBankOut } from "../../types";

type QuestionGroup = QuestionBankOut["groups"][number];

interface Props {
  groups: QuestionBankOut["groups"];
  answerMap: Record<string, QuestionAnswer>;
  answerLoading: string | null;
  toggleAnswer: (key: string, question: string, groupType?: string, index?: number) => Promise<void>;
}

export default function QuestionGroupCards({ groups, answerMap, answerLoading, toggleAnswer }: Props) {
  return (
    <>
      {QUESTION_BANK_TYPES.map((type) => {
        const group = groups.find((item: QuestionGroup) => item.type === type);
        if (!group || group.questions.length === 0) return null;
        return (
          <Card key={type} size="small" title={type}>
            <Space orientation="vertical" style={{ width: "100%" }} size="small">
              {group.questions.map((item, index) => {
                const key = `${group.type}-${index}`;
                const answer = answerMap[key];
                return (
                  <div
                    key={key}
                    style={{
                      borderTop: index ? "1px solid #f0f0f0" : "none",
                      paddingTop: index ? 8 : 0,
                    }}
                  >
                    <Typography.Text strong>
                      {index + 1}. {item.question}
                    </Typography.Text>
                    {item.purpose && (
                      <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                        考察：{item.purpose}
                      </Typography.Paragraph>
                    )}
                    {item.answer_hint && (
                      <Typography.Paragraph style={{ margin: "4px 0 0" }}>
                        <Typography.Text type="success">提示：</Typography.Text>
                        {item.answer_hint}
                      </Typography.Paragraph>
                    )}
                    <div style={{ marginTop: 4 }}>
                      <Button
                        size="small"
                        type="link"
                        icon={<BulbOutlined />}
                        loading={answerLoading === key}
                        onClick={() => void toggleAnswer(key, item.question, group.type, index)}
                      >
                        {answer ? "收起参考答案" : "参考答案"}
                      </Button>
                    </div>
                    {answer && (
                      <div style={{ marginTop: 4 }}>
                        <Typography.Paragraph
                          style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}
                        >
                          {answer.answer}
                        </Typography.Paragraph>
                        {answer.key_points.length > 0 && (
                          <ul style={{ margin: "4px 0 0", paddingLeft: 20 }}>
                            {answer.key_points.map((point) => (
                              <li key={point}>{point}</li>
                            ))}
                          </ul>
                        )}
                        {answer.sample_phrasing && (
                          <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                            话术参考：{answer.sample_phrasing}
                          </Typography.Paragraph>
                        )}
                      </div>
                    )}
                  </div>
                );
              })}
            </Space>
          </Card>
        );
      })}
    </>
  );
}
