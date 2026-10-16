/**
 * 回到助手页时恢复"发送中"的会话视图（问题 B：流式会话全局化）。
 *
 * 离开页面时回答仍在后台继续（状态在 assistantStreamStore 中跨路由存活）。
 * 若当前实例还停在草稿态，就重新选中正在发送的会话，恢复"乐观用户消息 +
 * 流式文本/工具卡/进度"的完整视图。深链（?conversation=）与 ?new=1 是用户
 * 明确的入口意图，优先级高于恢复。
 */

import { useEffect, useRef } from "react";

interface Options {
  sending: boolean;
  sendingConversationId: number | null;
  activeId: number | null;
  /** 深链要定位的会话 id（无深链时为 undefined）。 */
  requestedConversationId: number | undefined;
  /** 是否以 `?new=1` 进入（明确要新草稿）。 */
  startNew: boolean;
  selectConversation: (conversationId: number | null) => void;
}

export function useRestoreStreamingConversation({
  sending,
  sendingConversationId,
  activeId,
  requestedConversationId,
  startNew,
  selectConversation,
}: Options) {
  // 每个实例只在挂载时尝试一次：之后用户点「新对话」不该被拽回正在发送的会话。
  const restoredRef = useRef(false);
  useEffect(() => {
    if (restoredRef.current) return;
    restoredRef.current = true;
    if (!sending || sendingConversationId === null) return;
    if (activeId !== null) return;
    if (requestedConversationId !== undefined || startNew) return;
    selectConversation(sendingConversationId);
  }, [
    sending,
    sendingConversationId,
    activeId,
    requestedConversationId,
    startNew,
    selectConversation,
  ]);
}
