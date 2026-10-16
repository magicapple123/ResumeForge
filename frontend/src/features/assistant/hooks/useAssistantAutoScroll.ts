/**
 * 求职助手消息列表的滚动域：吸底跟随（问题 A）、定位到底部与「加载更早」跳过。
 *
 * 滚动容器是 AssistantMessageList 里的 `.assistant-messages`；用户滚动位置距底部
 * 在阈值内视为「吸底」。流式 delta 到达时只有吸底才自动滚到底，用户上翻查看
 * 历史时不被打扰，并提供「回到底部」悬浮按钮恢复跟随。
 */

import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import type { RefObject } from "react";
import type { AssistantMessage } from "../../../types";

/** 距底部多少像素内仍视为"吸底"：留一点容差，避免差一像素就掉出跟随。 */
const STICK_TO_BOTTOM_THRESHOLD_PX = 60;

interface Options {
  /** 消息末尾哨兵元素：滚动定位的目标。 */
  messageEndRef: RefObject<HTMLDivElement | null>;
  /** 会话详情尚在加载（骨架屏阶段不做任何定位）。 */
  awaitingConversation: boolean;
  /** 当前详情的会话 id：变化即"切换了会话"，永远定位到底部并恢复吸底。 */
  detailId: number | null | undefined;
  /** 详情消息数组（仅作 effect 依赖：流结束刷新详情后，吸底方才跟随滚到底）。 */
  detailMessages: AssistantMessage[] | undefined;
  /** 详情消息条数（空列表且非流式时不定位，避免草稿态空滚动）。 */
  historyCount: number;
  isActiveStream: boolean;
  sending: boolean;
  pendingUserText: string;
  progressText: string;
  streamError: string;
  streamingSources: unknown;
  streamingReasoning: string;
  streamingTools: unknown;
  streamingText: string;
  /** 「加载更早」动作（B5）：包装一层以跳过紧接着的一次定位。 */
  loadEarlier: () => Promise<void>;
}

export function useAssistantAutoScroll(options: Options) {
  const {
    messageEndRef,
    awaitingConversation,
    detailId,
    detailMessages,
    historyCount,
    isActiveStream,
    sending,
    pendingUserText,
    progressText,
    streamError,
    streamingSources,
    streamingReasoning,
    streamingTools,
    streamingText,
    loadEarlier,
  } = options;

  const messagesScrollRef = useRef<HTMLDivElement | null>(null);
  const [stickToBottom, setStickToBottom] = useState(true);
  const stickToBottomRef = useRef(true);
  const updateStickToBottom = useCallback((value: boolean) => {
    stickToBottomRef.current = value;
    setStickToBottom(value);
  }, []);
  const handleMessagesScroll = useCallback(() => {
    const container = messagesScrollRef.current;
    if (!container) return;
    const distanceToBottom = container.scrollHeight - container.scrollTop - container.clientHeight;
    updateStickToBottom(distanceToBottom <= STICK_TO_BOTTOM_THRESHOLD_PX);
  }, [updateStickToBottom]);
  const scrollToBottom = useCallback(() => {
    updateStickToBottom(true);
    messageEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [messageEndRef, updateStickToBottom]);

  // 在浏览器绘制前定位到末尾，避免详情刷新时先闪现旧的顶部位置。
  // 「加载更早」（B5）是往顶部 prepend：这一次变化不该把视口拽到底部，跳过一次滚动，
  // 让浏览器停在用户当前查看的位置附近。
  const skipNextScrollRef = useRef(false);
  const handleLoadEarlier = useCallback(async () => {
    skipNextScrollRef.current = true;
    await loadEarlier();
  }, [loadEarlier]);

  // 会话切换（detailId 变化）永远定位到底部并恢复吸底；同一会话内的详情刷新
  // （流结束后的 loadDetail）只在吸底时跟随，不打扰正在上翻的用户。
  const prevDetailIdRef = useRef<number | null | undefined>(undefined);
  useLayoutEffect(() => {
    if (awaitingConversation || (!historyCount && !isActiveStream)) return;
    if (skipNextScrollRef.current) {
      skipNextScrollRef.current = false;
      return;
    }
    const switched = prevDetailIdRef.current !== detailId;
    prevDetailIdRef.current = detailId;
    if (switched) updateStickToBottom(true);
    if (!switched && !stickToBottomRef.current) return;
    messageEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [
    awaitingConversation,
    detailId,
    detailMessages,
    historyCount,
    isActiveStream,
    messageEndRef,
    updateStickToBottom,
  ]);

  useEffect(() => {
    if (!sending || !isActiveStream) return;
    // 问题 A：非吸底（用户上翻看历史）时不拽回，只有吸底才跟随滚动。
    if (!stickToBottomRef.current) return;
    messageEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [
    isActiveStream,
    messageEndRef,
    pendingUserText,
    progressText,
    sending,
    streamError,
    streamingSources,
    streamingReasoning,
    streamingTools,
    streamingText,
  ]);

  return {
    handleLoadEarlier,
    handleMessagesScroll,
    messagesScrollRef,
    scrollToBottom,
    /** 「回到底部」悬浮按钮的显隐：仅流式期间且用户已退出吸底时出现。 */
    showScrollBottom: isActiveStream && sending && !stickToBottom,
  };
}
