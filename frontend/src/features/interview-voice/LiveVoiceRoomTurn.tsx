// SPDX-License-Identifier: Apache-2.0
/**
 * 时间线末尾的「当前轮」（F15 从 `LiveVoiceRoomStage` 拆出，I-27 再改成时间线的一段）。
 *
 * 为什么不再是一张独立卡：它和上方的历史记录本来就是同一条对话流，另开一张卡会让
 * "最新 → 历史 → 又是最新"的错觉复活（I-25 刚修掉顺序）。现在它是时间线的**尾巴**：
 * 左侧一条强调竖线 + 「正在问」标记，视觉上接着上一条气泡，语义上仍是当前轮。
 *
 * 编辑态留在组件内部：草稿只在"正在改这一条回答"时有意义，换一轮（`answer.id` 变）就
 * 丢弃——否则草稿会挂到下一轮上，看起来像"改错了题"。
 */
import { EditOutlined } from "@ant-design/icons";
import { Button, Input, Typography } from "antd";
import { useState } from "react";
import MarkdownBlock from "../../components/common/MarkdownBlock";
import { t } from "../../i18n";
import { useLocale } from "../../i18n/i18nContext";

export interface CurrentTurn {
  question: string | null;
  answer: { id: number; content: string } | null;
}

export function LiveVoiceRoomTurn({
  turn,
  revising,
  onRevise,
}: {
  turn: CurrentTurn;
  /** 正在重新生成：改文字按钮禁用，避免重复提交。 */
  revising: boolean;
  onRevise?: (messageId: number, content: string) => void;
}) {
  useLocale();
  // 编辑态**按回答 id 归属**：换一轮（`answer.id` 变）时它自然为 false，
  // 不需要 effect 去"重置"——否则草稿会挂到下一轮上，看起来像"改错了题"。
  const [editingId, setEditingId] = useState<number | null>(null);
  const [draft, setDraft] = useState("");
  const editing = editingId !== null && editingId === turn.answer?.id;

  const startEditing = () => {
    setDraft(turn.answer?.content ?? "");
    setEditingId(turn.answer?.id ?? null);
  };

  // 没有当前轮时整段不渲染：空态由时间线那句「等待面试官提问」负责，两处各说一句
  // 会在同一屏上出现两个"还没有内容"的提示。
  if (!turn.question && !turn.answer) return null;

  return (
    <section
      className="interview-live-room__turn"
      aria-label={t("interviewVoice.room.currentTurn")}
      data-current-turn="true"
    >
      <div className="interview-live-room__turn-head">
        {turn.question ? (
          <span className="interview-live-room__asking-pill">
            {t("interviewVoice.room.asking")}
          </span>
        ) : null}
        <Typography.Text type="secondary" className="interview-live-room__turn-label">
          {t("interviewVoice.room.currentTurn")}
        </Typography.Text>
      </div>
      {turn.question ? (
        <div className="interview-live-room__turn-question">
          <MarkdownBlock content={turn.question} />
        </div>
      ) : null}
      {turn.answer ? (
        <div className="interview-live-room__turn-answer">
          {editing ? (
            <>
              <Input.TextArea
                value={draft}
                autoSize={{ minRows: 2, maxRows: 6 }}
                onChange={(event) => setDraft(event.target.value)}
                aria-label={t("interviewVoice.room.revise")}
              />
              <Typography.Text type="secondary" className="interview-live-room__turn-hint">
                {t("interviewVoice.room.reviseHint")}
              </Typography.Text>
              <div className="interview-live-room__turn-actions">
                <Button size="small" onClick={() => setEditingId(null)}>
                  {t("interviewVoice.room.reviseCancel")}
                </Button>
                <Button
                  size="small"
                  type="primary"
                  danger
                  disabled={!draft.trim() || revising}
                  onClick={() => {
                    onRevise?.(turn.answer!.id, draft.trim());
                    setEditingId(null);
                  }}
                >
                  {t("interviewVoice.room.reviseSubmit")}
                </Button>
              </div>
            </>
          ) : (
            <>
              <MarkdownBlock content={turn.answer.content} />
              {onRevise ? (
                <Button
                  size="small"
                  type="text"
                  icon={<EditOutlined aria-hidden="true" />}
                  className="interview-live-room__turn-edit"
                  onClick={startEditing}
                >
                  {t("interviewVoice.room.revise")}
                </Button>
              ) : null}
            </>
          )}
        </div>
      ) : null}
    </section>
  );
}

export default LiveVoiceRoomTurn;
