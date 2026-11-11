// SPDX-License-Identifier: Apache-2.0
/**
 * 「上下文用量」的取数（需求 #6）：一条会话一个值，两个来源合成一份。
 *
 * 1. **流式事件优先**：每轮拼装完后端下发 `context_usage`（跨挂载点存在于全局 store），
 *    它描述的是"这一轮真正发出去的内容"，比重新估算更真。
 * 2. **切会话时补一次 GET**：从历史进来看不到流式事件，读最近一条助手消息落库的用量；
 *    旧消息没有落过 → 后端返回 `partial: true` 的估算值（弹层里标「部分数据」）。
 *
 * 两个来源与"改过的窗口"都按会话 id 打标：换会话时**不靠 effect 重置状态**（那会多
 * 一次级联渲染），而是取用时判 id——不是当前会话的值一律当没有。
 *
 * 取数失败**静默**：面板是辅助信息，不能因为它失败就打断一次提问。
 */

import { useCallback, useEffect, useState, useSyncExternalStore } from "react";
import { getAssistantContextUsage } from "../../../api/assistant";
import type { ContextUsage } from "../../../types";
import { withWindowTokens } from "../contextUsageFormat";
import { getAssistantStreamState, subscribeAssistantStream } from "./assistantStreamStore";

/** 带会话 id 的值：换会话后旧值自动失效，不需要显式清理。 */
interface Scoped<T> {
  conversationId: number;
  value: T;
}

export interface AssistantContextUsageState {
  /** 当前会话的用量；null = 还不知道（chip 显示「—」，不猜数字）。 */
  contextUsage: ContextUsage | null;
  /** 窗口写回成功后本地重算（不必重新请求一次）。 */
  applyWindowTokens: (windowTokens: number) => void;
  /**
   * 重新拉一次用量（压缩 / 还原之后用）。
   *
   * 压缩改变了"发给模型的视图"，所以面板上的数字与压缩状态都必须重取——本地推算
   * 只能算百分比，算不出摘要覆盖到哪一条。
   */
  reload: () => void;
}

export function useAssistantContextUsage(
  conversationId: number | null,
): AssistantContextUsageState {
  const streamState = useSyncExternalStore(subscribeAssistantStream, getAssistantStreamState);
  const [fetched, setFetched] = useState<Scoped<ContextUsage> | null>(null);
  const [windowEdited, setWindowEdited] = useState<Scoped<number> | null>(null);
  // 每次压缩 / 还原后 +1，effect 依赖它就会重取一遍（会话没变也要重取）。
  const [reloadToken, setReloadToken] = useState(0);

  useEffect(() => {
    if (conversationId === null) return;
    let cancelled = false;
    getAssistantContextUsage(conversationId)
      .then((next) => {
        if (!cancelled) setFetched({ conversationId, value: next });
      })
      .catch(() => {
        // 静默：拿不到就显示「—」。会话可能刚被删掉，那不是用户此刻要处理的事。
      });
    return () => {
      cancelled = true;
    };
  }, [conversationId, reloadToken]);

  // 流式事件只对**发出它的那条会话**有效（store 跨路由存活，可能还留着别的会话的值）。
  const streamed =
    conversationId !== null && streamState.contextUsageConversationId === conversationId
      ? streamState.contextUsage
      : null;
  const base =
    streamed ?? (fetched && fetched.conversationId === conversationId ? fetched.value : null);

  const applyWindowTokens = useCallback(
    (windowTokens: number) => {
      if (conversationId === null) return;
      setWindowEdited({ conversationId, value: windowTokens });
    },
    [conversationId],
  );

  // 窗口是**当前模型配置**的属性，与事件无关：改完立刻在那个值上生效。
  const edited =
    windowEdited && windowEdited.conversationId === conversationId ? windowEdited.value : null;
  const contextUsage =
    base && edited !== null && base.window !== edited ? withWindowTokens(base, edited) : base;

  const reload = useCallback(() => setReloadToken((token) => token + 1), []);

  return { contextUsage, applyWindowTokens, reload };
}
