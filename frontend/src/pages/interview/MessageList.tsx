// SPDX-License-Identifier: Apache-2.0
/**
 * 面试房间的消息流：历史消息 + **尚未回包的本地回答** + 面试官「正在思考」气泡。
 *
 * 自 InterviewPage 拆出（0066）：页面本体贴着 500 行预算，而这一段是纯粹的渲染。
 *
 * 顺序是产品要求的一部分：用户刚提交的那段话要**先**出现，然后才是 Jane 的
 * "正在思考下一个问题…"。服务端要等模型把点评与下一题都生成完才回包，界面如果只显示
 * 思考气泡，用户会怀疑自己的回答没提交上去。
 *
 * T04-c：被中断的一轮（``status === "interrupted"``，或本地刚 abort 掉的那一轮）要能看出
 * "上次没答完"，并给一个「重新回答」入口——重答走的是原来的提问链路，服务端会复用这条
 * 回答，不会写出第二条消息。
 */
import type { RefObject } from "react";
import { Button, Space, Typography } from "antd";
import { ReloadOutlined } from "@ant-design/icons";
import LoadingBlock from "../../components/common/LoadingBlock";
import type { InterviewMessage } from "../../types";
import { formatDateTime } from "../../utils/format";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import { JANE_FACE_SOURCES, janeFaceForStyle } from "./janeFaces";

/** 被中断的那一轮的标记 + 「重新回答」。两种来源共用这一块（服务端记录 / 本地刚停的）。 */
function InterruptedNotice({
  onRetry,
  retryDisabled,
}: {
  onRetry: () => void;
  retryDisabled: boolean;
}) {
  return (
    <div className="interview-interrupted">
      <Space size={8} wrap>
        <Typography.Text type="secondary">{t("interview.interrupted.hint")}</Typography.Text>
        <Button size="small" icon={<ReloadOutlined />} disabled={retryDisabled} onClick={onRetry}>
          {t("interview.action.retryRound")}
        </Button>
      </Space>
    </div>
  );
}

export function InterviewMessageList({
  messages,
  interviewerStyle,
  pendingAnswer,
  pendingInterrupted,
  retryDisabled,
  onRetry,
  thinking,
  finishing,
  streamingQuestion,
  endRef,
}: {
  messages: InterviewMessage[];
  interviewerStyle: string;
  /** 已提交但服务端还没回包的回答：先用"我"的气泡占位。 */
  pendingAnswer: string | null;
  /** 本地这条占位回答是被用户「停止本轮」掐断的：要显示未完成标记与重答入口。 */
  pendingInterrupted: boolean;
  /** 正在生成时禁用重答按钮，避免连点重复提交。 */
  retryDisabled: boolean;
  /** 重答某一轮（重走原来的提问链路）。 */
  onRetry: (content: string) => void;
  /** 面试官是否正在生成（`submitting && !finished`）。 */
  thinking: boolean;
  /** 这一轮之后要出报告：气泡文案换成「本场面试结束，正在生成报告」。 */
  finishing: boolean;
  /** 流式中的面试官问题（question_delta 渐进填充）；非流式时为空。 */
  streamingQuestion: string | null;
  /** 底部锚点：新内容进来后滚到这里。 */
  endRef: RefObject<HTMLDivElement | null>;
}) {
  useLocale();
  return (
    <div className="interview-messages">
      {messages.map((item) =>
        item.role === "note" ? (
          <div key={item.id} className="interview-note">
            {item.content}
          </div>
        ) : (
          <div
            key={item.id}
            className={`interview-message interview-message--${item.role === "interviewer" ? "interviewer" : "me"}`}
          >
            <div className="interview-message-head">
              {item.role === "interviewer" ? (
                <img
                  className="jane-avatar"
                  src={JANE_FACE_SOURCES[janeFaceForStyle(interviewerStyle)]}
                  alt=""
                  aria-hidden="true"
                />
              ) : null}
              <b>
                {item.role === "interviewer"
                  ? t("interviewPage.interviewerName")
                  : t("interview.role.you")}
              </b>
              <Typography.Text type="secondary" className="assistant-message-time">
                {formatDateTime(item.created_at)}
              </Typography.Text>
            </div>
            <div className="interview-message-body">{item.content}</div>
            {item.context.feedback ? (
              <div className="interview-feedback">
                <b>{t("interview.role.comment")}</b>
                {item.context.feedback}
              </div>
            ) : null}
            {item.role === "user" && item.status === "interrupted" ? (
              // 上次没答完的那一轮：刷新回来也认得出，并可以原样重答一次。
              <InterruptedNotice
                retryDisabled={retryDisabled}
                onRetry={() => onRetry(item.content)}
              />
            ) : null}
          </div>
        ),
      )}
      {pendingAnswer ? (
        // 本地占位气泡：服务端回包后被 setActive 的真实消息取代（同一句话不会留两条）。
        // 不带时间戳——它不是服务端记录，写"刚刚"反而是假信息。
        <div className="interview-message interview-message--me">
          <div className="interview-message-head">
            <b>{t("interview.role.you")}</b>
          </div>
          <div className="interview-message-body">{pendingAnswer}</div>
          {pendingInterrupted ? (
            <InterruptedNotice
              retryDisabled={retryDisabled}
              onRetry={() => onRetry(pendingAnswer)}
            />
          ) : null}
        </div>
      ) : null}
      {thinking ? (
        <div className="interview-message interview-message--interviewer">
          <div className="interview-message-head">
            <img
              className="jane-avatar"
              src={
                JANE_FACE_SOURCES[streamingQuestion ? "idle" : "thinking"] ??
                JANE_FACE_SOURCES.thinking
              }
              alt=""
              aria-hidden="true"
            />
            <b>{t("interviewPage.interviewerName")}</b>
          </div>
          <div className="interview-message-body">
            {streamingQuestion ? (
              // 流式：问题文本逐字到达（question_delta），像打字一样出现。
              <div style={{ whiteSpace: "pre-wrap" }}>{streamingQuestion}</div>
            ) : (
              <LoadingBlock
                tip={finishing ? t("interviewPage.thinkingFinishReport") : t("interview.thinking")}
                minHeight={120}
              />
            )}
            {streamingQuestion && finishing ? (
              // 收尾语已经流出来、报告还在生成：补一行说明，别让用户以为卡住了。
              <Typography.Text type="secondary" className="interview-finishing-hint">
                {t("interviewPage.thinkingFinishReport")}
              </Typography.Text>
            ) : null}
          </div>
        </div>
      ) : null}
      <div ref={endRef} />
    </div>
  );
}

export default InterviewMessageList;
