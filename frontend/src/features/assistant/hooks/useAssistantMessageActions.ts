// SPDX-License-Identifier: Apache-2.0
/** 助手消息动作域：引用追问、单条删除与「进入多选」入口。
 *
 * 从 AssistantPage 整域下沉。引用状态必须在 `useAssistantStream` 之前建立——流式 hook 要
 * 拿 `quoted.id` 当 `quotedMessageId`；而「进入多选」要读流式 hook 吐出的 `sending` 与
 * 消息条数，只能在其后调用。因此本文件带两个 hook，调用点各自留在原位置。
 */
import { App } from "antd";
import { useCallback, useState } from "react";
import { deleteAssistantMessage } from "../../../api/assistant";
import { t } from "../../../i18n";
import type { AssistantMessage, AssistantQuotedMessage, AssistantSurface } from "../../../types";

type MessageApi = ReturnType<typeof App.useApp>["message"];

interface QuoteOptions {
  message: MessageApi;
}

export function useAssistantQuote({ message }: QuoteOptions) {
  // 引用追问：右键消息「引用这条继续问」后出现，只对下一次提问有效。
  const [quoted, setQuoted] = useState<AssistantQuotedMessage | null>(null);
  const clearQuote = useCallback(() => setQuoted(null), []);

  const quoteMessage = useCallback(
    (target: AssistantMessage) => {
      setQuoted({
        id: target.id,
        role: target.role,
        // 与后端快照保持同样的截断长度，避免引用块里显示的长度前后不一致。
        excerpt:
          target.content.trim().slice(0, 500) ||
          t("assistantHooks.messageActions.quote.attachmentOnly"),
      });
      message.info(t("assistantHooks.messageActions.quote.info"));
    },
    [message],
  );

  return { quoted, clearQuote, quoteMessage };
}

interface ActionsOptions {
  activeId: number | null;
  loadDetail: (conversationId: number) => Promise<void>;
  message: MessageApi;
  surface: AssistantSurface;
  messageCount: number;
  sending: boolean;
  setSelecting: (selecting: boolean) => void;
}

export function useAssistantMessageActions({
  activeId,
  loadDetail,
  message,
  surface,
  messageCount,
  sending,
  setSelecting,
}: ActionsOptions) {
  const removeMessage = useCallback(
    async (target: AssistantMessage) => {
      if (!activeId) return;
      try {
        if (surface === "page") await deleteAssistantMessage(activeId, target.id);
        else await deleteAssistantMessage(activeId, target.id, surface);
        await loadDetail(activeId);
        message.success(t("assistantHooks.messageActions.success.deleted"));
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : t("assistantHooks.messageActions.error.delete"),
        );
      }
    },
    [activeId, loadDetail, message, surface],
  );

  /** 消息右键菜单「批量选择」的动作（页头按钮已收进这里，R8）。
   *  多选只在有历史消息时才有意义；流式回复期间也不给进——那两条临时气泡还不在
   *  数据库里，勾不上。 */
  const enterMessageSelecting = useCallback(() => {
    if (messageCount > 0 && !sending) setSelecting(true);
  }, [messageCount, sending, setSelecting]);

  return { removeMessage, enterMessageSelecting };
}
