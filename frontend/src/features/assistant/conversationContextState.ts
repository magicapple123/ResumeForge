// SPDX-License-Identifier: Apache-2.0
/**
 * 对话级的临时状态（提前压缩阈值 / 连续超限次数）——**只放内存**。
 *
 * 为什么不用 localStorage：这是「这次对话临时调一下」的语义，持久化会让下一次开新对话
 * 继承上次的设置，而用户完全无法归因。离开对话即回到全局默认。
 */
/** Conversation controls live only in memory; reopening restores global defaults. */
import { useSyncExternalStore } from "react";

interface ConversationContextState {
  thresholdTokens: number | null;
  contextErrors: number;
}
const EMPTY: ConversationContextState = { thresholdTokens: null, contextErrors: 0 };
const states = new Map<number, ConversationContextState>();
const listeners = new Set<() => void>();
function emit() {
  for (const listener of listeners) listener();
}
function subscribe(listener: () => void) {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}
export function getConversationContextState(id: number | null): ConversationContextState {
  return id === null ? EMPTY : (states.get(id) ?? EMPTY);
}
export function setConversationThreshold(id: number, thresholdTokens: number | null) {
  states.set(id, { ...getConversationContextState(id), thresholdTokens });
  emit();
}
export function recordContextResult(id: number, errorCode?: string) {
  const current = getConversationContextState(id);
  states.set(id, {
    ...current,
    contextErrors: errorCode === "context_length" ? current.contextErrors + 1 : 0,
  });
  emit();
}
export function clearConversationContext(id: number) {
  states.delete(id);
  emit();
}
export function useConversationContextState(id: number | null) {
  return useSyncExternalStore(
    subscribe,
    () => getConversationContextState(id),
    () => EMPTY,
  );
}
