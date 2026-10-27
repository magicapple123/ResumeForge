// SPDX-License-Identifier: Apache-2.0
/** 三类题库分组卡：岗位基础 / 项目深挖 / 反问 HR 的题目与参考答案展开。
 *
 * 纯展示组件——参考答案的生成与写回（toggleAnswer）留在 QuestionBankPanel，经回调回传；
 * 零 api 导入（白名单契约：新文件不得触碰 api/interview）。
 */
import { BulbOutlined } from "@ant-design/icons";
import { Button, Card, Space, Typography } from "antd";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { QUESTION_BANK_TYPES } from "../../types";
import type { QuestionAnswer, QuestionBankOut } from "../../types";

type QuestionGroup = QuestionBankOut["groups"][number];

/**
 * 分组类型的显示名：键是 `types/` 里的中文协议值（协议值不改），值指向语言包 key。
 * 未登记的取值原样显示——历史记录里可能有旧版本写下的类型，别让它显示成一条裸 key。
 */
const GROUP_TYPE_LABEL_KEYS: Record<string, MessageKey> = {
  基础题: "questionBankPanel.group.basics", // i18n-ok: 协议值（types 中文枚举键）
  项目深挖题: "questionBankPanel.group.projectDeepDive", // i18n-ok: 协议值（types 中文枚举键）
  反问HR题: "questionBankPanel.group.askInterviewer", // i18n-ok: 协议值（types 中文枚举键）
};

function groupTypeLabel(type: string): string {
  const labelKey: MessageKey | undefined = GROUP_TYPE_LABEL_KEYS[type];
  return labelKey ? t(labelKey) : type;
}

interface Props {
  groups: QuestionBankOut["groups"];
  answerMap: Record<string, QuestionAnswer>;
  answerLoading: string | null;
  toggleAnswer: (
    key: string,
    question: string,
    groupType?: string,
    index?: number,
  ) => Promise<void>;
}

export default function QuestionGroupCards({
  groups,
  answerMap,
  answerLoading,
  toggleAnswer,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <>
      {QUESTION_BANK_TYPES.map((type) => {
        const group = groups.find((item: QuestionGroup) => item.type === type);
        if (!group || group.questions.length === 0) return null;
        return (
          <Card key={type} size="small" title={groupTypeLabel(type)}>
            <Space orientation="vertical" style={{ width: "100%" }} size="small">
              {group.questions.map((item, index) => {
                const key = `${group.type}-${index}`;
                const answer = answerMap[key];
                return (
                  <div
                    key={key}
                    style={{
                      borderTop: index ? "1px solid var(--rf-border)" : "none",
                      paddingTop: index ? 8 : 0,
                    }}
                  >
                    <Typography.Text strong>
                      {index + 1}. {item.question}
                    </Typography.Text>
                    {item.purpose && (
                      <Typography.Paragraph type="secondary" style={{ margin: "4px 0 0" }}>
                        {t("questionBankPanel.group.purpose", { purpose: item.purpose })}
                      </Typography.Paragraph>
                    )}
                    {item.answer_hint && (
                      <Typography.Paragraph style={{ margin: "4px 0 0" }}>
                        <Typography.Text type="success">
                          {t("questionBankPanel.group.hintLabel")}
                        </Typography.Text>
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
                        {answer
                          ? t("questionBankPanel.action.showAnswer")
                          : t("questionBankPanel.action.answer")}
                      </Button>
                    </div>
                    {answer && (
                      <div style={{ marginTop: 4 }}>
                        <Typography.Paragraph style={{ margin: "4px 0 0", whiteSpace: "pre-wrap" }}>
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
                            {t("questionBankPanel.group.samplePhrasing", {
                              text: answer.sample_phrasing,
                            })}
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
