// SPDX-License-Identifier: Apache-2.0
/**
 * 自答批改结果：分数 + 总评 + 亮点 / 差距 / 修改建议 + 改写示范。
 *
 * 分数用环形进度是因为它要"一眼看到"，而三段清单是"逐条对"——两种阅读节奏不同，所以
 * 分数与总评在上、清单在中、改写示范在下（示范最长，放最后才不挤掉结论）。
 */
import { BulbOutlined, FileTextOutlined, RiseOutlined, WarningOutlined } from "@ant-design/icons";
import { Collapse, Progress, Tag, Typography } from "antd";
import { t, type MessageKey } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { InterviewAnswerReview } from "../../types";
import { splitParagraphs } from "./splitParagraphs";

/** 分数档位：颜色与一句话评语都按档位走，避免"78 分算好还是差"每次都要猜。 */
function scoreTone(score: number): "good" | "fair" | "weak" {
  if (score >= 85) return "good";
  if (score >= 70) return "fair";
  return "weak";
}

const TONE_COLOR: Record<ReturnType<typeof scoreTone>, string> = {
  good: "#16a34a",
  fair: "#d97706",
  weak: "#dc2626",
};

/** 档位评语：写死成语言包 key（不能拼字符串，`t()` 的键是编译期校验的）。 */
const TONE_LABEL_KEYS: Record<ReturnType<typeof scoreTone>, MessageKey> = {
  good: "questionBankPanel.review.tone.good",
  fair: "questionBankPanel.review.tone.fair",
  weak: "questionBankPanel.review.tone.weak",
};

function ReviewList({
  title,
  icon,
  items,
  className,
}: {
  title: string;
  icon: React.ReactNode;
  items: string[] | undefined;
  className: string;
}) {
  if (!items || items.length === 0) return null;
  return (
    <div className={`answer-review-block ${className}`}>
      <Typography.Text strong className="answer-review-block-title">
        {icon} {title}
      </Typography.Text>
      <ul>
        {items.map((item, index) => (
          <li key={index}>{item}</li>
        ))}
      </ul>
    </div>
  );
}

export default function AnswerReviewView({ review }: { review: InterviewAnswerReview }) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  // 批改结果可能是历史里存下来的半成品（模型少给一段、旧版本没写某一项）：
  // 渲染层再兜一次，缺字段当"没有这一段"，绝不让整页因为一个 `.length` 崩掉。
  const score = Number.isFinite(review.score) ? review.score : 0;
  const tone = scoreTone(score);
  const revised = splitParagraphs(review.revised_answer ?? "");

  return (
    <div className="answer-review-view">
      <div className="answer-review-head">
        <Progress
          type="circle"
          size={72}
          percent={score}
          strokeColor={TONE_COLOR[tone]}
          format={(value) => (
            <span className="answer-review-score">
              {value}
              <small>{t("questionBankPanel.review.scoreUnit")}</small>
            </span>
          )}
        />
        <div className="answer-review-summary">
          <Tag color={tone === "good" ? "green" : tone === "fair" ? "orange" : "red"}>
            {t(TONE_LABEL_KEYS[tone])}
          </Tag>
          <Typography.Paragraph style={{ margin: "6px 0 0" }}>
            {review.summary || t("questionBankPanel.review.noSummary")}
          </Typography.Paragraph>
        </div>
      </div>

      <ReviewList
        title={t("questionBankPanel.review.strengths")}
        icon={<RiseOutlined />}
        items={review.strengths}
        className="answer-review-block--strengths"
      />
      <ReviewList
        title={t("questionBankPanel.review.gaps")}
        icon={<WarningOutlined />}
        items={review.gaps}
        className="answer-review-block--gaps"
      />
      <ReviewList
        title={t("questionBankPanel.review.suggestions")}
        icon={<BulbOutlined />}
        items={review.suggestions}
        className="answer-review-block--suggestions"
      />

      {revised.length > 0 && (
        <Collapse
          size="small"
          className="answer-review-revised"
          items={[
            {
              key: "revised",
              label: (
                <Typography.Text strong>
                  <FileTextOutlined /> {t("questionBankPanel.review.revisedAnswer")}
                </Typography.Text>
              ),
              children: (
                <div className="answer-review-revised-body">
                  {revised.map((paragraph, index) => (
                    <p key={index}>{paragraph}</p>
                  ))}
                </div>
              ),
            },
          ]}
        />
      )}
    </div>
  );
}
