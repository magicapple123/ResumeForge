// SPDX-License-Identifier: Apache-2.0
/**
 * 通话主栏下半部（F16）：对话记录，**自己滚**。
 *
 * 两条约束支撑这个文件：
 * 1. **气泡与文字聊天页共用** `InterviewMessageBubble`。原来这里是 3px 左边框的平铺
 *    卡片，同一份消息在两处长得完全不一样；现在头像、昵称、时间、左右分列、点评色块
 *    都跟对话页一致。
 * 2. **滚动发生在消息区内部**：`main(min-height:0) → aside(flex:1,min-height:0) →
 *    messages(overflow-y:auto)` 这条接力链缺一环，右栏下方就会空一块而整页却在滚。
 *
 * 房间只展示最近 12 条：面试中要看的是"刚才说了什么"，完整记录在对话页。
 */
import { Typography } from "antd";
import { InterviewMessageBubble } from "../interview/InterviewMessageBubble";
import { formatDateTime } from "../../utils/format";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { InterviewMessage } from "../../types";

export function LiveVoiceRoomAside({
  messages,
  pendingAnswer,
  streamingQuestion,
  faceSrc,
}: {
  messages: InterviewMessage[];
  pendingAnswer: string | null;
  streamingQuestion: string | null;
  /** 面试官形象：与左轨同一个来源，由 `LiveVoiceRoom` 透传。 */
  faceSrc: string;
}) {
  useLocale();
  const recentMessages = messages.filter((item) => item.role !== "note").slice(-12);
  const empty = recentMessages.length === 0 && !pendingAnswer && !streamingQuestion;

  return (
    <aside
      className="interview-live-room__conversation"
      aria-label={t("interviewVoice.room.conversation")}
    >
      <Typography.Text type="secondary" className="interview-live-room__conversation-title">
        {t("interviewVoice.room.conversation")}
      </Typography.Text>
      {/* 复用对话页的 `.interview-messages` 容器，房间侧的覆盖集中在 panels.css。 */}
      <div className="interview-messages" aria-live="polite">
        {empty ? (
          <Typography.Text type="secondary">{t("interviewVoice.room.waiting")}</Typography.Text>
        ) : null}
        {recentMessages.map((item) => (
          <InterviewMessageBubble
            key={item.id}
            role={item.role === "user" ? "user" : "interviewer"}
            name={
              item.role === "user"
                ? t("interviewVoice.room.you")
                : t("interviewVoice.room.interviewer")
            }
            time={formatDateTime(item.created_at)}
            content={item.content}
            feedback={item.context?.feedback}
            faceSrc={item.role === "user" ? undefined : faceSrc}
          />
        ))}
        {/* 待确认的本地回答：不带时间（不是服务端记录，写"刚刚"反而是假信息）。 */}
        {pendingAnswer ? (
          <InterviewMessageBubble
            role="user"
            name={t("interviewVoice.room.you")}
            content={pendingAnswer}
          />
        ) : null}
        {/* 流式中的问题：边到边显示，等回包后才算一条正式消息。 */}
        {streamingQuestion ? (
          <InterviewMessageBubble
            role="interviewer"
            name={t("interviewVoice.room.interviewer")}
            content={streamingQuestion}
            faceSrc={faceSrc}
          />
        ) : null}
      </div>
    </aside>
  );
}

export default LiveVoiceRoomAside;
