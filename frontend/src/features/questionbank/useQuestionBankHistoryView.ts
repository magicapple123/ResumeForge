// SPDX-License-Identifier: Apache-2.0
/**
 * 题库历史的「列表 ↔ 详情」视图状态：进详情记住滚动位置，返回时恢复。
 *
 * 用 `useLayoutEffect` + rAF 恢复：要等列表重新挂载、高度算完再滚，否则会滚到一半被内容
 * 撑开的位置。判据是 record id 变化，不是路由变化——同一页内切换也要生效。
 */
import { useLayoutEffect, useRef } from "react";
import type { QuestionBankRecord } from "../../types";

/** Keep the mounted history state and return to the viewport saved before opening it. */
export function useQuestionBankHistoryView(
  record: QuestionBankRecord | null | undefined,
  onOpen?: (record: QuestionBankRecord) => void,
  onClose?: () => void,
) {
  const historyScroll = useRef(0);
  const historyRef = useRef<HTMLDivElement>(null);
  const scrollContainer = useRef<HTMLElement | null>(null);
  const containerScroll = useRef(0);
  const previousId = useRef<number | null>(null);
  const recordId = record?.id ?? null;
  useLayoutEffect(() => {
    if (previousId.current === recordId) return;
    const wasDetail = previousId.current !== null;
    previousId.current = recordId;
    if (recordId !== null) {
      window.scrollTo(0, 0);
      scrollContainer.current?.scrollTo(0, 0);
    } else if (wasDetail) {
      const frame = requestAnimationFrame(() => {
        window.scrollTo(0, historyScroll.current);
        scrollContainer.current?.scrollTo(0, containerScroll.current);
      });
      return () => cancelAnimationFrame(frame);
    }
  }, [recordId]);
  return {
    historyRef,
    openRecord: onOpen
      ? (next: QuestionBankRecord) => {
          historyScroll.current = window.scrollY;
          let parent = historyRef.current?.parentElement ?? null;
          while (parent && !/(auto|scroll)/.test(getComputedStyle(parent).overflowY)) {
            parent = parent.parentElement;
          }
          scrollContainer.current = parent;
          containerScroll.current = parent?.scrollTop ?? 0;
          onOpen(next);
        }
      : undefined,
    closeRecord: onClose,
  };
}
