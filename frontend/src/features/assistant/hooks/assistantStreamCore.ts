// SPDX-License-Identifier: Apache-2.0
/**
 * 助手流式会话 store 的状态容器（从 assistantStreamStore.ts 拆出，压 500 行预算）。
 *
 * 只放与"请求"无关的部分：状态本体、监听器与挂载实例注册表、delta 文本缓冲与合并
 * flush、订阅入口、手动停止与测试重置。发送生命周期与 SSE 事件处理仍在
 * assistantStreamStore.ts，通过这里导出的 patch/flag/缓冲访问函数读写状态。
 */
import type { RefObject } from "react";
import type {
  AssistantSource,
  AssistantSourceNumber,
  AssistantToolCall,
  ContextUsage,
} from "../../../types";
import type { PendingAttachment } from "../assistantUtils";

/** 对外暴露的流式会话状态（与原 useAssistantStream 的 useState 一一对应）。 */
export interface AssistantStreamState {
  sending: boolean;
  sendingConversationId: number | null;
  pendingUserText: string;
  pendingSentAt: string;
  pendingUserAttachments: PendingAttachment[];
  /** F36：发送瞬间引用的岗位/简历快照（输入区已清空，乐观气泡靠它显示「本轮引用」）。 */
  pendingUserRefs: import("../../../types").AssistantMessageReferences | null;
  /** T24：发送瞬间勾选的技能快照（乐观气泡显示「使用 X」，与落库后的气泡同款）。 */
  pendingUserSkills: import("../../../types").AssistantMessageSkill[];
  streamingText: string;
  streamingReasoning: string;
  streamingSources: AssistantSource[];
  streamingSourceMap: AssistantSourceNumber[];
  streamingTools: AssistantToolCall[];
  progressText: string;
  streamError: string;
  /** 上一轮回复撞到工具轮次上限时的轮数；null = 没撞到（不显示「继续」）。 */
  roundLimitRounds: number | null;
  /**
   * 最近一次收到的上下文用量（需求 #6）。它属于 `contextUsageConversationId` 那个
   * 会话——切换会话后由 `useAssistantContextUsage` 决定还用不用它，所以这里不在流
   * 收尾时清空（清空会让面板在"刚回答完"的瞬间闪成「—」）。
   */
  contextUsage: ContextUsage | null;
  contextUsageConversationId: number | null;
}

const initialState: AssistantStreamState = {
  sending: false,
  sendingConversationId: null,
  pendingUserText: "",
  pendingSentAt: "",
  pendingUserAttachments: [],
  pendingUserRefs: null,
  pendingUserSkills: [],
  streamingText: "",
  streamingReasoning: "",
  streamingSources: [],
  streamingSourceMap: [],
  streamingTools: [],
  progressText: "",
  streamError: "",
  roundLimitRounds: null,
  contextUsage: null,
  contextUsageConversationId: null,
};

/**
 * 挂载实例注册表：流结束收尾时用它们的回调刷新数据。
 * 每个挂载的 useAssistantStream 实例注册一份，卸载时注销。
 */
export interface AssistantStreamInstance {
  activeIdRef: RefObject<number | null>;
  reloadConversations: () => Promise<unknown>;
  loadDetail: (id: number) => Promise<void>;
}

let state: AssistantStreamState = initialState;
let abortController: AbortController | null = null;
/** 发送互斥标记（原 sendingRef 的全局化形态）。 */
let sending = false;
let requestErrored = false;
const listeners = new Set<() => void>();
const instances = new Set<AssistantStreamInstance>();

/*
 * delta/reasoning 文本缓冲（T02 流式渲染性能）：这两类事件高频到达（每 token 一发），
 * 原实现每个事件都 patch + emit，50 个 delta 就是 50 次全量订阅者通知。现在先累积到
 * 模块级缓冲，用 rAF 合并成每帧最多一次 flush；后台标签页的 rAF 会暂停，补一个
 * setTimeout 兜底（两者谁先到谁触发，flushScheduled 防重复）。tool/progress/sources/
 * error 等低频事件仍走立即 patch——它们要求即时可见。
 */
let pendingTextDelta = "";
let pendingReasoningDelta = "";
let flushScheduled = false;
let flushTimerId: ReturnType<typeof setTimeout> | null = null;

/** 把缓冲里的增量一次性并入状态并通知订阅者；缓冲为空时不动状态。 */
function flushStreamText(): void {
  flushScheduled = false;
  if (flushTimerId !== null) {
    clearTimeout(flushTimerId);
    flushTimerId = null;
  }
  const textDelta = pendingTextDelta;
  const reasoningDelta = pendingReasoningDelta;
  if (!textDelta && !reasoningDelta) return;
  pendingTextDelta = "";
  pendingReasoningDelta = "";
  patchAssistantStream({
    streamingText: state.streamingText + textDelta,
    streamingReasoning: state.streamingReasoning + reasoningDelta,
  });
}

function scheduleStreamFlush(): void {
  if (flushScheduled) return;
  flushScheduled = true;
  if (typeof requestAnimationFrame === "function") {
    requestAnimationFrame(() => {
      if (flushScheduled) flushStreamText();
    });
  }
  // 兜底：rAF 被暂停（后台 tab）或被 fake timers 接管时，这把定时器保证 flush 会发生。
  flushTimerId = setTimeout(() => {
    if (flushScheduled) flushStreamText();
  }, 50);
}

function emit(): void {
  for (const listener of listeners) listener();
}

/** 并入状态并通知订阅者（发送生命周期模块用它写所有低频状态）。 */
export function patchAssistantStream(next: Partial<AssistantStreamState>): void {
  state = { ...state, ...next };
  emit();
}

/** 缓冲里的文本增量（delta 事件）。 */
export function appendAssistantStreamTextDelta(text: string): void {
  pendingTextDelta += text;
}

/** 缓冲里的推理增量（reasoning 事件）。 */
export function appendAssistantStreamReasoningDelta(text: string): void {
  pendingReasoningDelta += text;
}

/** 安排一次合并 flush（rAF 或 50ms 兜底，谁先到谁触发）。 */
export function scheduleAssistantStreamFlush(): void {
  scheduleStreamFlush();
}

/** 流结束/中止/出错时的强制收口：缓冲里的最后一批增量立即落进状态，再清掉调度。 */
export function finalizeAssistantStreamText(): void {
  flushStreamText();
}

/** useSyncExternalStore 的订阅入口。 */
export function subscribeAssistantStream(listener: () => void): () => void {
  listeners.add(listener);
  return () => {
    listeners.delete(listener);
  };
}

/** useSyncExternalStore 的快照入口：只在 patch 时替换引用，保证不变性约定。 */
export function getAssistantStreamState(): AssistantStreamState {
  return state;
}

/** 挂载实例注册；返回注销函数（组件卸载时调用）。 */
export function registerAssistantStreamInstance(instance: AssistantStreamInstance): () => void {
  instances.add(instance);
  return () => {
    instances.delete(instance);
  };
}

/** 当前仍挂载的实例快照（流收尾刷新用；全部离场时退回发送时捕获的回调）。 */
export function getAssistantStreamInstances(): AssistantStreamInstance[] {
  return [...instances];
}

/** 用户手动停止（输入框的停止按钮）。行为与原来一致：只 abort 当前请求。 */
export function abortAssistantStream(): void {
  abortController?.abort();
}

/** 发送互斥标记的读写（真正的发送流程在 assistantStreamStore.ts）。 */
export function isAssistantStreamSending(): boolean {
  return sending;
}

export function setAssistantStreamSending(value: boolean): void {
  sending = value;
}

/** 本轮是否已出过错（收尾时决定 TouTou 状态）。 */
export function isAssistantStreamRequestErrored(): boolean {
  return requestErrored;
}

export function setAssistantStreamRequestErrored(value: boolean): void {
  requestErrored = value;
}

/** 当前流的 abort 控制器（发送模块用它判断迟到事件是否属于本轮）。 */
export function getAssistantStreamAbortController(): AbortController | null {
  return abortController;
}

export function setAssistantStreamAbortController(controller: AbortController | null): void {
  abortController = controller;
}

/**
 * 仅供测试：把 store 重置回空闲。某个用例把流挂起时避免污染同文件后续用例。
 * 同时清空文本缓冲与挂起的 flush 定时器——否则上一个用例欠下的 flush 会在
 * 下一个用例的 fake timers 下突兀触发，把串了状态的文本带进新用例。
 */
export function resetAssistantStreamForTests(): void {
  abortController = null;
  sending = false;
  requestErrored = false;
  pendingTextDelta = "";
  pendingReasoningDelta = "";
  flushScheduled = false;
  if (flushTimerId !== null) {
    clearTimeout(flushTimerId);
    flushTimerId = null;
  }
  state = initialState;
  emit();
}
