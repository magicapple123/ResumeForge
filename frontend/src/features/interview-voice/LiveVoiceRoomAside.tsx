// SPDX-License-Identifier: Apache-2.0
/**
 * 通话主栏下半部（F16）：对话记录，**自己滚**。
 *
 * 两条约束支撑这个文件：
 * 1. **气泡与文字聊天页共用** `InterviewMessageBubble`。原来这里是 3px 左边框的平铺
 *    卡片，同一份消息在两处长得完全不一样；现在头像、昵称、时间、左右分列
 *    都跟对话页一致。I-27 起**点评不在气泡里**（搬到右侧点评栏），时间按 5 分钟分组显示。
 * 2. **滚动发生在消息区内部**：`main(min-height:0) → aside(flex:1,min-height:0) →
 *    messages(overflow-y:auto)` 这条接力链缺一环，右栏下方就会空一块而整页却在滚。
 *
 * 房间只展示最近 12 条：面试中要看的是"刚才说了什么"，完整记录在对话页。
 */
import { Typography } from "antd";
import { useEffect, useMemo, useRef } from "react";
import { InterviewMessageBubble } from "../interview/InterviewMessageBubble";
import { formatDateTime } from "../../utils/format";
import { parseServerTime } from "../../utils/serverTime";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { InterviewMessage } from "../../types";

/**
 * 按固定间隔给消息分组：只有每组第一条显示完整时间。
 *
 * 为什么抽成模块级函数：分组需要一个"上一条显示时间"的游标，而游标一旦写在组件体或
 * `useMemo` 回调里，就变成 **render 期间改可变状态**（React 编译期规则直接报错）。
 * 站成普通函数后 `let` 与赋值都只发生在调用栈内，语义也更直白。
 */
function groupByInterval(
  messages: InterviewMessage[],
  groupMs: number,
): { item: InterviewMessage; time: string | null }[] {
  let lastShownAt: number | null = null;
  return messages.map((item) => {
    // 时间戳统一走 `parseServerTime`：后端给的是无时区的本地串，裸 `new Date()` 在
    // 部分引擎上会把 "YYYY-MM-DD HH:mm" 当 UTC（`serverTime.guard` 守的就是这条）。
    const at = parseServerTime(item.created_at)?.getTime() ?? Number.NaN;
    const show = lastShownAt === null || !Number.isFinite(at) || at - lastShownAt >= groupMs;
    if (show && Number.isFinite(at)) lastShownAt = at;
    return { item, time: show ? formatDateTime(item.created_at) : null };
  });
}

export function LiveVoiceRoomAside({
  messages,
  pendingAnswer,
  streamingQuestion,
  faceSrc,
  emptyText,
}: {
  messages: InterviewMessage[];
  pendingAnswer: string | null;
  streamingQuestion: string | null;
  /** 面试官形象：与左轨同一个来源，由 `LiveVoiceRoom` 透传。 */
  faceSrc: string;
  /**
   * 记录区为空时的说明。默认「等待面试官提问」；I-25 换序后，历史为空但下方已有当前问答
   * 是常态，那时必须换一句，否则同一屏上"等待面试官提问"与卡片里的提问自相矛盾。
   */
  emptyText?: string;
}) {
  useLocale();
  const recentMessages = messages.filter((item) => item.role !== "note").slice(-12);
  const empty = recentMessages.length === 0 && !pendingAnswer && !streamingQuestion;
  const listRef = useRef<HTMLDivElement>(null);
  // I-25：历史在上、最新的一轮在下，新内容进来必须跟到底；否则长对话里第一眼看到的是
  // 最早的一轮。只滚消息区（不是整页），与主对话页的 `endRef.scrollIntoView` 同一条意图。
  const signature = `${recentMessages.length}|${pendingAnswer ? 1 : 0}|${streamingQuestion ? 1 : 0}`;
  useEffect(() => {
    const list = listRef.current;
    if (list) list.scrollTop = list.scrollHeight;
  }, [signature]);

  /**
   * I-27：时间**分组显示**（同一条时间线里 5 分钟内只标一次）。
   *
   * 缺陷原形：每条气泡都带完整的 `2026-11-18 17:02`，一屏里重复五次——实时通话里
   * 这个精度没有信息价值，只会把注意力从正文拉走。对话页仍然逐条显示（默认不变）。
   */
  const GROUP_MS = 5 * 60 * 1000;
  const rows = useMemo(() => groupByInterval(recentMessages, GROUP_MS), [recentMessages]);

  return (
    <aside
      className="interview-live-room__conversation"
      aria-label={t("interviewVoice.room.conversation")}
    >
      <Typography.Text type="secondary" className="interview-live-room__conversation-title">
        {t("interviewVoice.room.conversation")}
      </Typography.Text>
      {/* 复用对话页的 `.interview-messages` 容器，房间侧的覆盖集中在 panels.css。 */}
      <div className="interview-messages" aria-live="polite" ref={listRef}>
        {empty ? (
          <Typography.Text type="secondary">
            {emptyText ?? t("interviewVoice.room.waiting")}
          </Typography.Text>
        ) : null}
        {rows.map(({ item, time }) => (
          <InterviewMessageBubble
            key={item.id}
            role={item.role === "user" ? "user" : "interviewer"}
            name={
              item.role === "user"
                ? t("interviewVoice.room.you")
                : t("interviewVoice.room.interviewer")
            }
            time={time}
            content={item.content}
            // I-27：点评搬进右侧独立一栏，气泡里不再重复渲染（它是评分，不是对话）。
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
