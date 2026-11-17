// SPDX-License-Identifier: Apache-2.0
/**
 * 消息流里的压缩边界（T25）。
 *
 * 插在 `covered_until_message_id` 那条消息**下方**：用户往上翻时能看见"从这里往前的
 * 若干轮已经不发给模型了"，而不是以为消息被删除（原文一直在本地）。摘要按需展开并
 * 限高 320px——它是回溯用的证据，不是正文。
 *
 * 分页时锚点可能不在已加载范围（用户只加载了最近 N 条）：这时退化到列表顶部，
 * 文案改成「更早的若干轮已压缩」。
 */
import { App, Button, Typography } from "antd";
import { useState } from "react";
import { restoreAssistantConversation } from "../../../api/assistant";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import type { ContextCompactionState } from "../../../types";

export default function CompactionBoundary({
  conversationId,
  compaction,
  degraded = false,
}: {
  conversationId: number;
  compaction: ContextCompactionState;
  /** true = 锚点不在已加载的消息里，退化成列表顶部的一句说明。 */
  degraded?: boolean;
}) {
  useLocale();
  const { message, modal } = App.useApp();
  const [open, setOpen] = useState(false);
  const [restored, setRestored] = useState(false);
  const [busy, setBusy] = useState(false);
  if (restored) return null;

  const savedTokens = Math.max(0, compaction.tokens_before - compaction.tokens_after);
  const summary = (compaction.summary || "").trim();

  const confirmRestore = () => {
    modal.confirm({
      title: t("contextUsage.compaction.action.restore"),
      content: t("contextUsage.compaction.restoreBody"),
      okText: t("contextUsage.compaction.action.restore"),
      cancelText: t("contextUsage.compaction.action.cancel"),
      okButtonProps: { danger: true },
      onOk: async () => {
        setBusy(true);
        try {
          await restoreAssistantConversation(conversationId);
          message.success(t("contextUsage.compaction.toast.restored"));
          setRestored(true);
        } catch (err) {
          message.error(t("contextUsage.compaction.toast.failed"));
          // 抛回 onOk 让确认框保持打开（用户可重试），文案不新增第二份。
          throw err;
        } finally {
          setBusy(false);
        }
      },
    });
  };

  return (
    <div className="assistant-compaction-boundary" data-testid="assistant-compaction-boundary">
      <div className="assistant-compaction-boundary-line">
        <Typography.Text type="secondary">
          {degraded
            ? t("contextUsage.compaction.boundary.earlier", { tokens: savedTokens })
            : t("contextUsage.compaction.boundary.line", {
                turns: compaction.turns,
                tokens: savedTokens,
              })}
        </Typography.Text>
        {summary ? (
          <Button
            type="link"
            size="small"
            className="assistant-compaction-boundary-toggle"
            aria-expanded={open}
            onClick={() => setOpen((value) => !value)}
          >
            {open
              ? t("contextUsage.compaction.boundary.hide")
              : t("contextUsage.compaction.boundary.view")}
          </Button>
        ) : null}
        <Button type="link" size="small" danger loading={busy} onClick={confirmRestore}>
          {t("contextUsage.compaction.action.restore")}
        </Button>
      </div>
      {open && summary ? <pre className="assistant-compaction-summary">{summary}</pre> : null}
    </div>
  );
}
