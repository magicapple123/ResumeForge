// SPDX-License-Identifier: Apache-2.0
/**
 * 参考答案的排版渲染：正文分段、要点成列表、话术单独成块。
 *
 * 为什么要单独一个组件：模型返回的是一段**长文本**，直接 `white-space: pre-wrap` 铺出来
 * 就是一整块灰糊糊的字（用户原话"没有格式的纯文字，看起来太不美观"）。这里按"正文 →
 * 要点 → 话术"三段各自成形：正文按空行切段（段内保留换行），要点走带勾的列表，话术用
 * 引用块区分。渲染层不做语义猜测，只做分段与视觉分层。
 */
import { BulbOutlined, CheckCircleOutlined, MessageOutlined } from "@ant-design/icons";
import { Space, Typography } from "antd";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { QuestionAnswer } from "../../types";
import { splitParagraphs } from "./splitParagraphs";

export default function QuestionAnswerView({ answer }: { answer: QuestionAnswer }) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后这一块不重渲染。
  useLocale();
  const paragraphs = splitParagraphs(answer.answer ?? "");
  const points = (answer.key_points ?? []).filter((item) => item.trim().length > 0);

  return (
    <div className="question-answer-view">
      {paragraphs.length > 0 && (
        <div className="question-answer-body">
          {paragraphs.map((paragraph, index) => (
            // 段落用 index 当 key：模型给的段落可能重复（例如两次"举个例子"），
            // 用文本当 key 会撞 key 并丢段落。
            <p key={index} className="question-answer-paragraph">
              {paragraph}
            </p>
          ))}
        </div>
      )}

      {points.length > 0 && (
        <div className="question-answer-points">
          <Typography.Text strong className="question-answer-section-title">
            <BulbOutlined /> {t("questionBankPanel.group.keyPointsTitle")}
          </Typography.Text>
          <ul>
            {points.map((point, index) => (
              <li key={index}>
                <CheckCircleOutlined className="question-answer-point-icon" />
                <span>{point}</span>
              </li>
            ))}
          </ul>
        </div>
      )}

      {answer.sample_phrasing && (
        <div className="question-answer-phrasing">
          <Typography.Text strong className="question-answer-section-title">
            <MessageOutlined /> {t("questionBankPanel.group.sampleTitle")}
          </Typography.Text>
          <Space orientation="vertical" size={2} style={{ width: "100%" }}>
            <Typography.Paragraph className="question-answer-phrasing-text">
              {answer.sample_phrasing}
            </Typography.Paragraph>
            <Typography.Text type="secondary" className="question-answer-phrasing-hint">
              {t("questionBankPanel.group.sampleHint")}
            </Typography.Text>
          </Space>
        </div>
      )}
    </div>
  );
}
