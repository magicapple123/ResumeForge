// SPDX-License-Identifier: Apache-2.0
/**
 * 面试结束后的「追问」区（#41）。
 *
 * 独立成一块而不是接在正式对话后面，是因为**它是另一个阶段**：
 *
 * - 追问**不占正式轮次**，头部那句"追问不占正式轮次，也不计入评分报告"必须一直写着，
 *   否则用户会以为自己在把面试拖长；
 * - 正式对话区（`InterviewMessageList`）只渲染 `phase="interview"` 的消息，追问在这里
 *   另起一段，两段记录互不干扰——刷新页面后轮次读数也就不会因为追问而变大。
 */
import { MessageOutlined, SendOutlined, StopOutlined } from "@ant-design/icons";
import { App, Button, Card, Empty, Input, Space, Typography } from "antd";
import { useState } from "react";
import { submitInterviewFollowUp, updateInterviewFollowUpState } from "../../api/interview";
import MarkdownBlock from "../../components/common/MarkdownBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";
import type { InterviewDetail, InterviewMessage } from "../../types";

/** 追问区里的一条消息：候选人提问在前、面试官回答在后。 */
function FollowUpLine({ message }: { message: InterviewMessage }) {
  const mine = message.role === "user";
  return (
    <div
      className={
        mine ? "interview-followup-line interview-followup-line--user" : "interview-followup-line"
      }
    >
      <Typography.Text strong>
        {mine ? t("interviewPage.followUp.role.user") : t("interviewPage.interviewerName")}
      </Typography.Text>
      {/* 与正式问答区同一个渲染器（`MarkdownBlock`）：两处回答的呈现才一致。那条
          `whiteSpace: pre-wrap` 随之撤掉——块级渲染自带段落间距，留着会双倍空行。 */}
      <MarkdownBlock content={message.content} />
    </div>
  );
}

export function FollowUpCard({
  session,
  onSession,
}: {
  session: InterviewDetail;
  /** 一次追问成功后，用服务端回传的整场会话替换页面状态（含新写入的追问记录）。 */
  onSession: (detail: InterviewDetail) => void;
}) {
  useLocale();
  const { message } = App.useApp();
  const [draft, setDraft] = useState("");
  const [asking, setAsking] = useState(false);

  // 只取追问阶段的消息：正式问答已经在对话区里，不能在这里重复一遍。
  const lines = session.messages.filter((item) => item.phase === "followup");
  // 上一条追问还在等回答时也禁用提交：追问是**一问一答**，攒着一堆问题同时发会让
  // 对话记录的顺序和用户看到的顺序对不上。
  const pending = lines.length > 0 && lines[lines.length - 1].role === "user";
  // #41：追问区可以被用户收起（面试结束后不一定还有问题要问）。收起只停"继续发问"，
  // 已经问过的记录一条都不删，也不影响正式轮次与报告。
  const closed = Boolean(session.follow_up_closed_at);
  const [switching, setSwitching] = useState(false);

  const toggle = async () => {
    if (switching) return;
    setSwitching(true);
    try {
      onSession(await updateInterviewFollowUpState(session.id, !closed));
      message.success(
        t(closed ? "interviewPage.followUp.resumedToast" : "interviewPage.followUp.stoppedToast"),
      );
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("interviewPage.followUp.stateFailed"),
      );
    } finally {
      setSwitching(false);
    }
  };

  const submit = async () => {
    const content = draft.trim();
    if (!content || asking) return;
    setAsking(true);
    try {
      const result = await submitInterviewFollowUp(session.id, content);
      setDraft("");
      onSession(result.session);
    } catch (error) {
      message.error(error instanceof Error ? error.message : t("interviewPage.followUp.failed"));
    } finally {
      setAsking(false);
    }
  };

  return (
    <Card
      size="small"
      className="settings-card interview-followup"
      title={t("interviewPage.followUp.cardTitle")}
      extra={
        // 收起 / 重新打开：一个按钮两态，文案写清点下去会发生什么。
        <Button
          size="small"
          icon={closed ? <MessageOutlined /> : <StopOutlined />}
          loading={switching}
          onClick={() => void toggle()}
        >
          {t(closed ? "interviewPage.followUp.resume" : "interviewPage.followUp.stop")}
        </Button>
      }
    >
      <Typography.Text type="secondary">{t("interviewPage.followUp.hint")}</Typography.Text>
      <div className="interview-followup-list">
        {lines.length === 0 ? (
          <Empty
            image={Empty.PRESENTED_IMAGE_SIMPLE}
            description={t("interviewPage.followUp.empty")}
          />
        ) : (
          // 一问一答之间留 8px：`.interview-followup-line` 自己没有间距，原先靠
          // 段落自带的 margin-bottom，改成块级渲染后就没有了。
          <Space orientation="vertical" size={8} style={{ width: "100%" }}>
            {lines.map((item) => (
              <FollowUpLine key={item.id} message={item} />
            ))}
          </Space>
        )}
      </div>
      {asking ? (
        <Typography.Text type="secondary">{t("interviewPage.followUp.thinking")}</Typography.Text>
      ) : null}
      {closed ? (
        // 收起后连输入框一起消失：留着禁用的输入框等于告诉用户"这个坏了"。
        <Typography.Text type="secondary">{t("interviewPage.followUp.closedHint")}</Typography.Text>
      ) : (
        <Space.Compact style={{ width: "100%" }}>
          <Input
            value={draft}
            disabled={asking || pending}
            placeholder={t("interviewPage.followUp.placeholder")}
            onChange={(event) => setDraft(event.target.value)}
            onPressEnter={() => void submit()}
          />
          <Button
            type="primary"
            icon={<SendOutlined />}
            loading={asking}
            disabled={asking || pending || !draft.trim()}
            onClick={() => void submit()}
          >
            {t("interviewPage.followUp.submit")}
          </Button>
        </Space.Compact>
      )}
    </Card>
  );
}

export default FollowUpCard;
