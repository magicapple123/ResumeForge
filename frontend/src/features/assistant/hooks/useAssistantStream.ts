/**
 * 求职助手流式发送 hook：薄封装，状态本体在 assistantStreamStore（跨路由存活）。
 *
 * 问题 B 修复：原来这里的 10 余个 useState 都在组件实例上，切页卸载即丢失，
 * 且卸载 effect 会 abort 掉请求。现在 hook 只做三件事：
 * 1. 用 useSyncExternalStore 订阅全局 store（page/floating 共享同一份状态）；
 * 2. 把当前挂载实例的刷新回调注册给 store，供流结束收尾使用（卸载时注销）；
 * 3. 暴露 send/stop 两个动作（stop 只来自用户手动停止，卸载不再触发）。
 */

import { useCallback, useEffect, useSyncExternalStore } from "react";
import type { RefObject } from "react";
import type { AssistantSurface, ReasoningEffort } from "../../../types";
import type { PendingAttachment } from "../assistantUtils";
import { useTouTou } from "../../tou-tou/touTouContext";
import {
  abortAssistantStream,
  getAssistantStreamState,
  registerAssistantStreamInstance,
  sendAssistantStreamMessage,
  subscribeAssistantStream,
} from "./assistantStreamStore";

interface Options {
  activeIdRef: RefObject<number | null>;
  reloadConversations: () => Promise<unknown>;
  loadDetail: (id: number) => Promise<void>;
  createConversation: () => Promise<number | null>;
  clearAttachments: () => void;
  attachmentReadsRef: RefObject<number>;
  attachmentsRef: RefObject<PendingAttachment[]>;
  jobId: number | undefined;
  resumeId: number | undefined;
  webSearch: boolean;
  reasoningEffort: ReasoningEffort;
  surface?: AssistantSurface;
  /** 当前引用的消息 id；发送时随请求带上，之后清空。 */
  quotedMessageId: number | null;
  clearQuote: () => void;
}

export function useAssistantStream(options: Options) {
  const { setStatus: setTouTouStatus } = useTouTou();
  const {
    activeIdRef,
    reloadConversations,
    loadDetail,
    createConversation,
    clearAttachments,
    attachmentReadsRef,
    attachmentsRef,
    jobId,
    resumeId,
    webSearch,
    reasoningEffort,
    surface = "page",
    quotedMessageId,
    clearQuote,
  } = options;
  const state = useSyncExternalStore(subscribeAssistantStream, getAssistantStreamState);
  // 流结束收尾（含离场期间结束的场景）需要刷新数据：把当前实例的回调注册给
  // store。这些回调都是稳定引用，注册只发生一次；卸载时注销。
  useEffect(
    () => registerAssistantStreamInstance({ activeIdRef, reloadConversations, loadDetail }),
    [activeIdRef, loadDetail, reloadConversations],
  );
  const send = useCallback(
    (text: string, clearContent: () => void) =>
      sendAssistantStreamMessage(text, clearContent, {
        activeIdRef,
        reloadConversations,
        loadDetail,
        createConversation,
        clearAttachments,
        attachmentReadsRef,
        attachmentsRef,
        setTouTouStatus,
        jobId,
        resumeId,
        webSearch,
        reasoningEffort,
        surface,
        quotedMessageId,
        clearQuote,
      }),
    [
      activeIdRef,
      attachmentReadsRef,
      attachmentsRef,
      clearAttachments,
      clearQuote,
      createConversation,
      jobId,
      loadDetail,
      quotedMessageId,
      reasoningEffort,
      reloadConversations,
      resumeId,
      setTouTouStatus,
      surface,
      webSearch,
    ],
  );
  const stop = useCallback(() => abortAssistantStream(), []);
  return { ...state, send, stop };
}
