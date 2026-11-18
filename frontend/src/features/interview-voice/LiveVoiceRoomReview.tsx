// SPDX-License-Identifier: Apache-2.0
/**
 * 本轮点评栏（I-27）。
 *
 * 点评是**评分**，不是对话：它原来塞在面试官气泡里（`InterviewMessageBubble` 的
 * `feedback` 块），于是每一问一答都被切成"问题 → 点评 → 回答 → 问题"。搬出来之后：
 *
 * - 数据源仍是 `item.context?.feedback`（**一段 Markdown 文本**，接口没有三维分数）。
 *   不为了好看伪造"结构 / 证据 / 表达"三个分——那会在报告里变成假数据；
 * - 空态**常驻占位**且高度固定：第一条点评到达时不能把时间线顶一下（I-17 的滚动锚定）；
 * - **不挂 `aria-live`**：点评在气泡里时已经播报过一次，搬到这里再播一次就是重复。
 */
import { Typography } from "antd";
import { useState } from "react";
import MarkdownBlock from "../../components/common/MarkdownBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function LiveVoiceRoomReview({ feedback }: { feedback: string | null }) {
  useLocale();
  const [collapsed, setCollapsed] = useState(false);
  const text = (feedback ?? "").trim();
  return (
    <aside className="interview-live-room__review" aria-label={t("interviewVoice.room.review")}>
      <div className="interview-live-room__review-head">
        <Typography.Text type="secondary" className="interview-live-room__review-title">
          {t("interviewVoice.room.review")}
        </Typography.Text>
        {text ? (
          <button
            type="button"
            className="interview-live-room__review-toggle"
            onClick={() => setCollapsed((value) => !value)}
          >
            {collapsed
              ? t("interviewVoice.room.reviewExpand")
              : t("interviewVoice.room.reviewCollapse")}
          </button>
        ) : null}
      </div>
      <div className="interview-live-room__review-body">
        {text ? (
          collapsed ? (
            <Typography.Text type="secondary" className="interview-live-room__review-empty">
              {t("interviewVoice.room.reviewCollapsed")}
            </Typography.Text>
          ) : (
            <MarkdownBlock content={text} />
          )
        ) : (
          <Typography.Text type="secondary" className="interview-live-room__review-empty">
            {t("interviewVoice.room.reviewEmpty")}
          </Typography.Text>
        )}
      </div>
    </aside>
  );
}

export default LiveVoiceRoomReview;
