// SPDX-License-Identifier: Apache-2.0
/**
 * 流式文本的展示层节流（T02）。
 *
 * store 侧已用 rAF 把高频 delta 合并成每帧一次 emit（见 assistantStreamStore.ts），
 * 但流式期间 tool/progress 等低频事件仍在立即 patch——每次 emit 都会让订阅了
 * streamingText 的组件树重渲染。本 hook 对传入的文本做 trailing 节流：
 * 值再怎么跳，最多每 STREAM_TEXT_THROTTLE_MS 提交一次，且停更后一定补发最终值，
 * 保证流结束时的文本与 store 最终状态（也就是落库消息）一致。
 *
 * 只作用于传给 AssistantMessageContent 的 streamingText/streamingReasoning；
 * 工具卡、进度、来源等低频状态不经过这里，保持即时可见。
 */

import { useEffect, useRef, useState } from "react";

/** 节流窗口（毫秒）。导出常量便于按机型/测试需要调整。 */
export const STREAM_TEXT_THROTTLE_MS = 100;

export function useThrottledStreamingText(value: string): string {
  const [committed, setCommitted] = useState(value);
  const latestRef = useRef(value);
  const timerRef = useRef<ReturnType<typeof setTimeout> | null>(null);

  useEffect(() => {
    // 最新值在 effect 内同步（渲染期写 ref 不符合 Compiler 规范）；
    // 提交定时器触发前所有 effect 都已跑过，读到的必是窗口期内最后一次的值。
    latestRef.current = value;
    // 已有窗口在跑就不再排：这是节流（固定频率提交）而不是防抖（停更才提交）。
    if (timerRef.current !== null) return;
    timerRef.current = setTimeout(() => {
      timerRef.current = null;
      setCommitted(latestRef.current);
    }, STREAM_TEXT_THROTTLE_MS);
  }, [value]);

  // 卸载时清掉挂起的提交定时器（值变化的 effect 不清理，那是节流语义的一部分）。
  useEffect(
    () => () => {
      if (timerRef.current !== null) {
        clearTimeout(timerRef.current);
        timerRef.current = null;
      }
    },
    [],
  );

  return committed;
}

/** AssistantPage 的接线形态（T02）：吸底门控（useAssistantAutoScroll）吃原始值，
 *  只有传给消息列表的两条流式文本过节流。下沉成 hook 让页面保持苗条。 */
export function useAssistantDisplayStream(stream: {
  streamingText: string;
  streamingReasoning: string;
}): { displayText: string; displayReasoning: string } {
  return {
    displayText: useThrottledStreamingText(stream.streamingText),
    displayReasoning: useThrottledStreamingText(stream.streamingReasoning),
  };
}
