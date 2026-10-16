/**
 * 求职助手流式会话的全局 store（问题 B 修复）。
 *
 * 流式状态（发送中、乐观用户消息、流式文本/工具卡/进度/错误）原先全部挂在
 * useAssistantStream 的组件实例上：切页即卸载，卸载 effect 还会 abort 掉进行中
 * 的请求，于是"回答到一半去别的页面"必然掐断回答。现在把"进行中的流式会话"
 * 收敛到这个模块级单例：
 *
 * - 组件用 `useSyncExternalStore` 订阅，page 与 floating 两个挂载点共享同一份状态，
 *   回到 /assistant 时自动恢复"发送中"的完整视图；一处逻辑一份实现。
 * - 组件卸载**不再**中止请求（abort 只来自用户手动停止）；流结束后由本模块负责
 *   收尾刷新（会话列表 + 命中会话的详情），刷新回调优先用当前仍挂载的实例，
 *   全部离场时退回发送时捕获的那一份——保证离场期间回复完整落库并刷新列表。
 * - 发送互斥标记（原 sendingRef）随之全局化：双实例天然不会同时发送。
 */

import type { RefObject } from "react";
import { sendAssistantMessage } from "../../../api/assistant";
import type {
  AssistantSource,
  AssistantSourceNumber,
  AssistantStreamEvent,
  AssistantToolCall,
  AssistantSurface,
  ReasoningEffort,
} from "../../../types";
import type { PendingAttachment } from "../assistantUtils";
import type { TouTouStatus } from "../../tou-tou/touTouTypes";

/** 对外暴露的流式会话状态（与原 useAssistantStream 的 useState 一一对应）。 */
export interface AssistantStreamState {
  sending: boolean;
  sendingConversationId: number | null;
  pendingUserText: string;
  pendingSentAt: string;
  pendingUserAttachments: PendingAttachment[];
  streamingText: string;
  streamingReasoning: string;
  streamingSources: AssistantSource[];
  streamingSourceMap: AssistantSourceNumber[];
  streamingTools: AssistantToolCall[];
  progressText: string;
  streamError: string;
}

const initialState: AssistantStreamState = {
  sending: false,
  sendingConversationId: null,
  pendingUserText: "",
  pendingSentAt: "",
  pendingUserAttachments: [],
  streamingText: "",
  streamingReasoning: "",
  streamingSources: [],
  streamingSourceMap: [],
  streamingTools: [],
  progressText: "",
  streamError: "",
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

export interface SendAssistantStreamOptions extends AssistantStreamInstance {
  createConversation: () => Promise<number | null>;
  clearAttachments: () => void;
  attachmentReadsRef: RefObject<number>;
  attachmentsRef: RefObject<PendingAttachment[]>;
  setTouTouStatus: (status: TouTouStatus) => void;
  jobId: number | undefined;
  resumeId: number | undefined;
  webSearch: boolean;
  reasoningEffort: ReasoningEffort;
  surface: AssistantSurface;
  /** 当前引用的消息 id；发送时随请求带上，之后清空。 */
  quotedMessageId: number | null;
  clearQuote: () => void;
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
  patch({
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

/** 流结束/中止/出错时的强制收口：缓冲里的最后一批增量立即落进状态，再清掉调度。 */
function finalizeStreamText(): void {
  flushStreamText();
}

function emit(): void {
  for (const listener of listeners) listener();
}

function patch(next: Partial<AssistantStreamState>): void {
  state = { ...state, ...next };
  emit();
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

/**
 * 用户手动停止（输入框的停止按钮）。行为与原来一致：只 abort 当前请求。
 * 注意：这里**不是**组件卸载路径——卸载不再中止回答。
 */
export function abortAssistantStream(): void {
  abortController?.abort();
}

/**
 * 发送一条消息并接管整个流式生命周期（原 useAssistantStream.send 的 store 化）。
 * 期间无论组件是否卸载，状态都写进全局 store，收尾刷新始终执行。
 */
export async function sendAssistantStreamMessage(
  text: string,
  clearContent: () => void,
  options: SendAssistantStreamOptions,
): Promise<void> {
  const trimmedText = text.trim();
  if (
    (!trimmedText && options.attachmentsRef.current.length === 0) ||
    sending ||
    options.attachmentReadsRef.current > 0
  ) {
    return;
  }
  sending = true;
  requestErrored = false;
  patch({ sending: true, streamError: "" });
  options.setTouTouStatus("thinking");
  let conversationId: number | null;
  try {
    conversationId = options.activeIdRef.current ?? (await options.createConversation());
  } catch (error) {
    sending = false;
    patch({
      sending: false,
      streamError: error instanceof Error ? error.message : "创建会话失败",
    });
    options.setTouTouStatus("error");
    return;
  }
  if (!conversationId) {
    sending = false;
    patch({ sending: false, streamError: "创建会话失败" });
    options.setTouTouStatus("error");
    return;
  }
  const attachmentPayload = options.attachmentsRef.current.map(({ name, mime_type, data }) => ({
    name,
    mime_type,
    data,
  }));
  const optimisticAttachments = [...options.attachmentsRef.current];
  clearContent();
  // 引用只对这一次提问有效：发出去就清掉，避免用户以为下一条也带着引用。
  options.clearQuote();
  const controller = new AbortController();
  abortController = controller;
  patch({
    pendingUserText: trimmedText || "[附件]",
    // 正在发送的这条消息还没有服务端时间戳，用它被发出的时刻顶上。
    pendingSentAt: new Date().toISOString(),
    pendingUserAttachments: optimisticAttachments,
    streamingText: "",
    streamingReasoning: "",
    streamingSources: [],
    streamingSourceMap: [],
    streamingTools: [],
    progressText: "",
    sendingConversationId: conversationId,
  });
  options.clearAttachments();
  const handleEvent = (event: AssistantStreamEvent) => {
    // 手动停止后立刻重发的场景：旧流的迟到事件不能写进新一轮会话状态。
    if (abortController !== controller) return;
    if (event.type === "delta") {
      pendingTextDelta += event.text;
      scheduleStreamFlush();
    }
    if (event.type === "reasoning") {
      pendingReasoningDelta += event.text;
      scheduleStreamFlush();
    }
    if (event.type === "progress") patch({ progressText: event.message });
    if (event.type === "sources") {
      patch({
        streamingSources: event.sources,
        streamingSourceMap: event.source_map ?? [],
        ...(event.error ? { progressText: event.error } : {}),
      });
    }
    if (event.type === "tool") {
      // 显式挑字段，而不是解构剔除 type：仓库的 lint 不允许未使用的变量。
      patch({
        streamingTools: [
          ...state.streamingTools,
          {
            name: event.name,
            arguments: event.arguments,
            summary: event.summary,
            link: event.link,
            ok: event.ok,
            error: event.error,
            changed: event.changed,
          },
        ],
      });
    }
    if (event.type === "write_proposal") {
      // 写入提案（RF-01）跟在对应 tool 事件之后到达：挂回最近一条工具记录，
      // 由 MessageToolCalls 渲染确认卡（待确认的写入在折叠面板外一眼可见）。
      if (state.streamingTools.length === 0) return;
      const next = [...state.streamingTools];
      next[next.length - 1] = { ...next[next.length - 1], proposal: event.proposal };
      patch({ streamingTools: next });
    }
    if (event.type === "error") {
      requestErrored = true;
      // 出错也先把缓冲的文本冲出去：用户看到的错误前文要与已收到的内容一致。
      finalizeStreamText();
      patch({ streamError: event.message });
      options.setTouTouStatus("error");
    }
    if (event.type === "done") options.setTouTouStatus("done");
    if (event.type === "start") void options.reloadConversations();
  };
  try {
    // surface 只影响请求 URL 的查询参数，请求通路完全相同，无需分叉。
    await sendAssistantMessage(
      conversationId,
      {
        content: trimmedText,
        job_id: options.jobId,
        resume_id: options.resumeId,
        // 后端保留这个字段只是兼容旧客户端；助手现在始终读取本地个人资料。
        include_profile: true,
        web_search: options.webSearch,
        reasoning_effort: options.reasoningEffort,
        quoted_message_id: options.quotedMessageId,
        attachments: attachmentPayload,
      },
      handleEvent,
      controller.signal,
      options.surface,
    );
  } catch (error) {
    if (!controller.signal.aborted) {
      requestErrored = true;
      patch({ streamError: error instanceof Error ? error.message : "发送消息失败" });
      options.setTouTouStatus("error");
    }
  } finally {
    if (abortController === controller) abortController = null;
    sending = false;
    const aborted = controller.signal.aborted;
    const errored = requestErrored;
    // done/abort/error 的统一收口（T02）：强制把缓冲里的最后一批 delta flush 出去，
    // 保证最终展示的流式文本与随后落库的消息逐字节一致，再清空流式视图。
    finalizeStreamText();
    // 收尾（问题 B 核心）：无论组件是否还挂载，都清空流式视图并完成数据刷新，
    // 保证离场期间回复完整落库、会话列表与命中会话详情被刷新。
    patch({
      sending: false,
      sendingConversationId: null,
      pendingUserText: "",
      pendingUserAttachments: [],
      streamingText: "",
      streamingReasoning: "",
      streamingSources: [],
      streamingSourceMap: [],
      streamingTools: [],
      progressText: "",
      streamError: "",
    });
    const targets: AssistantStreamInstance[] = [...instances];
    if (targets.length === 0) {
      // 所有实例都已离场：退回发送时捕获的那份回调，把刷新请求照样发出去
      // （对已卸载实例的 setState 是安全的 no-op，但请求本身会完成）。
      targets.push({
        activeIdRef: options.activeIdRef,
        reloadConversations: options.reloadConversations,
        loadDetail: options.loadDetail,
      });
    }
    const refreshes: Promise<unknown>[] = [];
    for (const instance of targets) {
      refreshes.push(instance.reloadConversations());
      if (instance.activeIdRef.current === conversationId) {
        refreshes.push(instance.loadDetail(conversationId));
      }
    }
    await Promise.all(refreshes);
    options.setTouTouStatus(aborted ? "idle" : errored ? "error" : "done");
  }
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
