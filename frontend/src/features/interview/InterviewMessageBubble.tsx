// SPDX-License-Identifier: Apache-2.0
/**
 * 一条面试消息的气泡（F16）：头像 + 昵称 + 时间 + 正文 + 面试官点评。
 *
 * 为什么抽出来：同一份"消息"原来有两套渲染——文字聊天页是左右分列的彩色气泡，
 * 实时语音房间的对话记录却是 3px 左边框的平铺卡片。同一个东西两套视觉语言，用户
 * 在两处看到的"刚才说了什么"长得完全不像。
 *
 * 三个刻意的边界：
 * - **只接已格式化的时间字符串**，不 import `pages/interview/janeFaces`——否则
 *   `features/` 会反向依赖 `pages/`。头像由调用方传 `faceSrc`。
 * - **不渲染"我"的头像**：候选人没有形象素材，头像位留空由 head 的 gap 承担。
 * - **`children` 留给调用方的特殊分支**（如「这一轮没答完 → 重新回答」），
 *   气泡本身不知道"中断""待确认"这些业务状态。
 */
import type { ReactNode } from "react";
import { Typography } from "antd";
import MarkdownBlock from "../../components/common/MarkdownBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export function InterviewMessageBubble({
  role,
  name,
  time,
  content,
  feedback,
  faceSrc,
  children,
}: {
  role: "interviewer" | "user";
  /** 显示名（面试官名 / 「我」）：由调用方从语言包取，组件不自带称呼。 */
  name: string;
  /** 已格式化的时间；本地占位气泡不传（写"刚刚"反而是假信息）。 */
  time?: string | null;
  /** 正文（Markdown）。 */
  content: string;
  /** 面试官对上一答的点评；没有就不渲染点评块。 */
  feedback?: string | null;
  /** 面试官头像（候选人没有形象素材）。 */
  faceSrc?: string;
  /** 特殊情况下的附加块：重新回答、待确认操作等。 */
  children?: ReactNode;
}) {
  useLocale();
  return (
    <div
      className={`interview-message interview-message--${role === "interviewer" ? "interviewer" : "me"}`}
    >
      <div className="interview-message-head">
        {faceSrc ? <img className="jane-avatar" src={faceSrc} alt="" aria-hidden="true" /> : null}
        <b>{name}</b>
        {time ? (
          <Typography.Text type="secondary" className="assistant-message-time">
            {time}
          </Typography.Text>
        ) : null}
      </div>
      {/* 面试官的回答是模型输出，本身就是 Markdown（分点、加粗、表格）：
          交给公共渲染器，正文里的 `**` / `-` 才不会是裸露的字符。 */}
      <div className="interview-message-body">
        <MarkdownBlock content={content} />
      </div>
      {feedback ? (
        <div className="interview-feedback">
          <b>{t("interview.role.comment")}</b>
          {feedback}
        </div>
      ) : null}
      {children}
    </div>
  );
}

export default InterviewMessageBubble;
