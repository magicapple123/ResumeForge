// SPDX-License-Identifier: Apache-2.0
/** 三类题库分组卡：岗位基础 / 项目深挖 / 反问 HR 的题目、参考答案与我的作答。
 *
 * 纯展示组件——参考答案的生成、我的作答的批改与写回都在 `QuestionBankPanel`，经回调回传；
 * 零 api 导入（白名单契约：新文件不得触碰 api/interview）。
 *
 * 「查看参考答案」与「重新生成」是两个独立动作：收起后再点只是**展开**（缓存留着），
 * 想换一版才点旁边的重新生成。早先两者共用一个按钮，收起来再点就会白跑一次生成。
 */
import { BulbOutlined, ReloadOutlined } from "@ant-design/icons";
import { Button, Card, Space, Spin, Typography } from "antd";
import AbortButton from "../common/AbortButton";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { QUESTION_BANK_TYPES } from "../../types";
import type { InterviewAnswerReview, QuestionAnswer, QuestionBankOut } from "../../types";
import MyAnswerBlock from "./MyAnswerBlock";
import QuestionAnswerView from "./QuestionAnswerView";

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
  answerOpen: Record<string, boolean>;
  answerLoading: string | null;
  onToggleAnswer: (key: string, question: string, groupType: string, index: number) => void;
  onRegenerateAnswer: (key: string, question: string, groupType: string, index: number) => void;
  myAnswerMap: Record<string, string>;
  reviewMap: Record<string, InterviewAnswerReview>;
  myAnswerOpen: Record<string, boolean>;
  reviewLoading: string | null;
  reviewError: string;
  onToggleMyAnswer: (key: string) => void;
  /** 停止正在生成的那一条（参考答案或批改）。 */
  onCancelActive: () => void;
  onSubmitMyAnswer: (
    key: string,
    question: string,
    groupType: string,
    index: number,
    answer: string,
  ) => void;
}

export default function QuestionGroupCards({
  groups,
  answerMap,
  answerOpen,
  answerLoading,
  onToggleAnswer,
  onRegenerateAnswer,
  myAnswerMap,
  reviewMap,
  myAnswerOpen,
  reviewLoading,
  reviewError,
  onToggleMyAnswer,
  onCancelActive,
  onSubmitMyAnswer,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  return (
    <div className="question-bank-groups">
      {QUESTION_BANK_TYPES.map((type) => {
        const group = groups.find((item: QuestionGroup) => item.type === type);
        if (!group || group.questions.length === 0) return null;
        return (
          <Card
            key={type}
            size="small"
            title={groupTypeLabel(type)}
            className="question-bank-group"
          >
            <Space orientation="vertical" style={{ width: "100%" }} size="middle">
              {group.questions.map((item, index) => {
                // 复合键：分组类型 + 序号，参考答案与自答的缓存都按它索引。
                const key = `${group.type}-${index}`;
                const answer = answerMap[key];
                const open = Boolean(answerOpen[key]);
                const review = reviewMap[key] ?? null;
                return (
                  <div key={key} className="question-bank-item">
                    <Typography.Text strong className="question-bank-question">
                      {index + 1}. {item.question}
                    </Typography.Text>
                    {item.purpose && (
                      <Typography.Paragraph type="secondary" className="question-bank-purpose">
                        {t("questionBankPanel.group.purpose", { purpose: item.purpose })}
                      </Typography.Paragraph>
                    )}
                    {item.answer_hint && (
                      <Typography.Paragraph className="question-bank-hint">
                        <Typography.Text type="success">
                          {t("questionBankPanel.group.hintLabel")}
                        </Typography.Text>
                        {item.answer_hint}
                      </Typography.Paragraph>
                    )}

                    <Space size={4} wrap className="question-bank-item-actions">
                      <Button
                        size="small"
                        type="link"
                        icon={<BulbOutlined />}
                        loading={answerLoading === key}
                        onClick={() => onToggleAnswer(key, item.question, group.type, index)}
                      >
                        {/* 三态必须分开说：还没生成 → 「生成」；已生成且展开 → 「收起」；
                            已生成但收起 → 「查看」。早先"没生成"和"已生成未展开"都显示
                            「查看参考答案」，用户点下去才发现是在生成。 */}
                        {!answer
                          ? t("questionBankPanel.action.generateAnswer")
                          : open
                            ? t("questionBankPanel.action.hideAnswer")
                            : t("questionBankPanel.action.showAnswer")}
                      </Button>
                      {open && answer && (
                        <Button
                          size="small"
                          type="link"
                          icon={<ReloadOutlined />}
                          disabled={answerLoading === key}
                          onClick={() => onRegenerateAnswer(key, item.question, group.type, index)}
                        >
                          {t("questionBankPanel.action.regenerateAnswer")}
                        </Button>
                      )}
                      {/* 生成中就在旁边给「停止」：参考答案是一次长文生成，不该只能等。
                          批改链路会顺手补一份参考答案，那种情况下停止交给下方的批改区块，
                          同一道题上不出现两颗「停止」。 */}
                      {answerLoading === key && reviewLoading !== key && (
                        <AbortButton size="small" onClick={onCancelActive} />
                      )}
                    </Space>

                    {open && (
                      <div className="question-answer-panel">
                        {answer ? (
                          <QuestionAnswerView answer={answer} />
                        ) : (
                          // 首次生成没有缓存：只在真的在生成时显示占位，生成完立刻换成正文。
                          <Spin size="small" />
                        )}
                      </div>
                    )}

                    <MyAnswerBlock
                      value={myAnswerMap[key] ?? ""}
                      review={review}
                      loading={reviewLoading === key}
                      error={reviewLoading === key ? "" : reviewError}
                      open={Boolean(myAnswerOpen[key])}
                      onToggle={() => onToggleMyAnswer(key)}
                      onCancel={onCancelActive}
                      onSubmit={(draft) =>
                        onSubmitMyAnswer(key, item.question, group.type, index, draft)
                      }
                    />
                  </div>
                );
              })}
            </Space>
          </Card>
        );
      })}
    </div>
  );
}
