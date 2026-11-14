// SPDX-License-Identifier: Apache-2.0
/**
 * 通话主栏顶部的「当前问答」卡（F15 从 `LiveVoiceRoomStage` 拆出）。
 *
 * 为什么搬出左栏：左栏原来是"形象 + 当前问答"两件事挤在一列，问答卡被 `flex: 1` 拉到
 * 整列高度，两行内容时留下大块空白，而右栏的对话记录反倒被压到 300–420px。现在左栏只
 * 留形象与摄像头，主栏是"当前问答（可滚） → 对话记录"，重心落在真正有内容的一侧。
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

  return (
    <section
      className="interview-live-room__turn"
      aria-label={t("interviewVoice.room.currentTurn")}
    >
      <Typography.Text type="secondary" className="interview-live-room__turn-label">
        {t("interviewVoice.room.currentTurn")}
      </Typography.Text>
      {turn.question || turn.answer ? (
        <>
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
        </>
      ) : (
        <Typography.Text type="secondary">{t("interviewVoice.room.noTurn")}</Typography.Text>
      )}
    </section>
  );
}

export default LiveVoiceRoomTurn;
