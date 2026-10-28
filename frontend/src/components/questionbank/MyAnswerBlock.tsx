// SPDX-License-Identifier: Apache-2.0
/**
 * 「我的作答」区块：自己先写一版，再交给 AI 批改（打分 + 解析 + 修改建议）。
 *
 * 为什么放在每道题下面而不是另开一个页面：批改的价值在于**对着题目改**——写的时候抬头
 * 就能看到题目、考察意图与回答提示，改完立刻能看到分数与差距，闭环在这里。
 *
 * 输入框默认收起（只留一行入口）：题库一次列二三十道题，全展开会把页面撑得很长；
 * 已经写过答案的题默认展开，否则用户会以为自己的答案丢了。
 */
import { FormOutlined, ThunderboltOutlined } from "@ant-design/icons";
import { Alert, Button, Input, Space, Typography } from "antd";
import { useState } from "react";
import AbortButton from "../common/AbortButton";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { InterviewAnswerReview } from "../../types";
import AnswerReviewView from "./AnswerReviewView";

/** 与后端 `InterviewAnswerReviewRequest.my_answer` 的上限保持一致。 */
export const MAX_MY_ANSWER_CHARS = 12_000;

interface Props {
  /** 已保存的作答（历史记录里带回来的）。 */
  value: string;
  /** 已保存的批改结果；没有就传 null。 */
  review: InterviewAnswerReview | null;
  loading: boolean;
  error: string;
  open: boolean;
  onToggle: () => void;
  /** 停止正在跑的批改：面板当场回到可再点，不弹错误。 */
  onCancel: () => void;
  onSubmit: (answer: string) => void;
}

export default function MyAnswerBlock({
  value,
  review,
  loading,
  error,
  open,
  onToggle,
  onCancel,
  onSubmit,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const [draft, setDraft] = useState(value);

  // 外部值变化（切题 / 打开历史记录）时把草稿同步过来；用户正在打字时 value 不变，
  // 所以不会覆盖未提交的输入。用渲染期守卫而不是 effect：后者会多一次空渲染，
  // 也会撞上 `react-hooks/set-state-in-effect`（本仓库的既有约定就是这样写的）。
  const [syncedValue, setSyncedValue] = useState(value);
  if (syncedValue !== value) {
    setSyncedValue(value);
    setDraft(value);
  }

  const trimmed = draft.trim();
  const changed = trimmed !== (value ?? "").trim();

  return (
    <div className="my-answer-block">
      <Space size={8} wrap>
        <Button
          size="small"
          type="link"
          icon={<FormOutlined />}
          className="my-answer-toggle"
          onClick={onToggle}
        >
          {open ? t("questionBankPanel.myAnswer.collapse") : t("questionBankPanel.myAnswer.expand")}
        </Button>
        {!open && value ? (
          <Typography.Text type="secondary" className="my-answer-saved-hint">
            {t("questionBankPanel.myAnswer.savedHint")}
            {review
              ? ` · ${t("questionBankPanel.myAnswer.scoredHint", { score: review.score })}`
              : ""}
          </Typography.Text>
        ) : null}
      </Space>

      {open && (
        <div className="my-answer-body">
          <Input.TextArea
            value={draft}
            maxLength={MAX_MY_ANSWER_CHARS}
            autoSize={{ minRows: 4, maxRows: 12 }}
            placeholder={t("questionBankPanel.myAnswer.placeholder")}
            onChange={(event) => setDraft(event.target.value)}
          />
          <Space size={8} wrap className="my-answer-actions">
            <Button
              type="primary"
              size="small"
              icon={<ThunderboltOutlined />}
              loading={loading}
              disabled={trimmed.length === 0}
              onClick={() => onSubmit(trimmed)}
            >
              {review
                ? t("questionBankPanel.myAnswer.rescore")
                : t("questionBankPanel.myAnswer.submit")}
            </Button>
            {/* 批改是一次长文生成：等待期间可以停，停完还能立刻再点。 */}
            {loading ? <AbortButton size="small" onClick={onCancel} /> : null}
            <Typography.Text type="secondary" className="my-answer-counter">
              {t("questionBankPanel.myAnswer.counter", {
                count: trimmed.length,
                max: MAX_MY_ANSWER_CHARS,
              })}
            </Typography.Text>
            {review && changed ? (
              <Typography.Text type="warning" className="my-answer-dirty">
                {t("questionBankPanel.myAnswer.dirty")}
              </Typography.Text>
            ) : null}
          </Space>

          {error ? <Alert type="error" showIcon title={error} /> : null}

          {review ? <AnswerReviewView review={review} /> : null}
        </div>
      )}
    </div>
  );
}
