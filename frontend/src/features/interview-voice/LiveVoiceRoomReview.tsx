// SPDX-License-Identifier: Apache-2.0
/**
 * 本轮点评栏（I-27，R3-02 起收起态是竖排窄轨）。
 *
 * 点评是**评分**，不是对话：它原来塞在面试官气泡里（`InterviewMessageBubble` 的
 * `feedback` 块），于是每一问一答都被切成"问题 → 点评 → 回答 → 问题"。搬出来之后：
 *
 * - 数据源仍是 `item.context?.feedback`（**一段 Markdown 文本**，接口没有三维分数）。
 *   不为了好看伪造"结构 / 证据 / 表达"三个分——那会在报告里变成假数据；
 * - 空态**常驻占位**且高度固定：第一条点评到达时不能把时间线顶一下（I-17 的滚动锚定）；
 *   空态**没有收起按钮**——没有可收的东西，多一颗按钮只会让人以为点坏了；
 * - **不挂 `aria-live`**：点评在气泡里时已经播报过一次，搬到这里再播一次就是重复。
 *
 * R3-02：收起曾经只把正文换成一行「点评已收起」，卡片仍满高满宽白占一列——用户看到的是
 * 一个空壳。现在收起 = **整个 `<aside>` 变成 44px 窄轨**：
 * - 状态落在 `data-collapsed` 上（不放第二套类名）：栅格用 `:has()` 读它收窄右列，
 *   CSS 与 DOM 只有一份真源；
 * - 收起态**不渲染 body**（和空态不同：空态仍要占位）；
 * - 窄轨 = CSS 画的箭头 + 竖排「本轮点评」，整条是一个 `<button>`，键盘可达、`aria-expanded`
 *   说清"再点会展开"；
 * - ≤860px 布局变上下堆叠，窄轨在 `liveVoiceRoomPanels.css` 里复位成通栏横条
 *   （不然会在时间线下方立一根 44px 的柱子）。
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
  // 空态永远展开：`feedback` 从 null 变成有值时若沿用上次的收起态，点评会"来了却看不见"。
  const isCollapsed = collapsed && Boolean(text);
  const label = t("interviewVoice.room.review");

  if (isCollapsed) {
    return (
      <aside className="interview-live-room__review" data-collapsed="true" aria-label={label}>
        <button
          type="button"
          className="interview-live-room__review-rail"
          aria-expanded={false}
          aria-label={t("interviewVoice.room.reviewExpand")}
          onClick={() => setCollapsed(false)}
        >
          <span className="interview-live-room__review-chevron" aria-hidden="true" />
          <span className="interview-live-room__review-rail-label">{label}</span>
        </button>
      </aside>
    );
  }

  return (
    <aside className="interview-live-room__review" data-collapsed="false" aria-label={label}>
      <div className="interview-live-room__review-head">
        <Typography.Text type="secondary" className="interview-live-room__review-title">
          {label}
        </Typography.Text>
        {text ? (
          <button
            type="button"
            className="interview-live-room__review-toggle"
            aria-expanded
            onClick={() => setCollapsed(true)}
          >
            {t("interviewVoice.room.reviewCollapse")}
          </button>
        ) : null}
      </div>
      <div className="interview-live-room__review-body">
        {text ? (
          <MarkdownBlock content={text} />
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
