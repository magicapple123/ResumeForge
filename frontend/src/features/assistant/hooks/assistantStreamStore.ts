// SPDX-License-Identifier: Apache-2.0
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
 *
 * 拆分（行数预算）：状态容器 / 订阅 / delta 缓冲在 assistantStreamCore.ts；本文件保留
 * 发送生命周期与对外导出（导出名一个未变）。
 */

import type { RefObject } from "react";
import { regenerateAssistantMessage, sendAssistantMessage } from "../../../api/assistant";
import { resolvePermissionAxes } from "../assistantPermission";
import { buildAssistantClientContext } from "../clientContext";
import { getConversationContextState, recordContextResult } from "../conversationContextState";
import { t } from "../../../i18n";
import type {
  AssistantMessageReferences,
  AssistantMessageSkill,
  AssistantStreamEvent,
  AssistantSurface,
  ReasoningEffort,
} from "../../../types";
import type { PendingAttachment } from "../assistantUtils";
import type { TouTouStatus } from "../../tou-tou/touTouTypes";
import {
  appendAssistantStreamReasoningDelta,
  appendAssistantStreamTextDelta,
  type AssistantStreamInstance,
  finalizeAssistantStreamText,
  getAssistantStreamAbortController,
  getAssistantStreamInstances,
  getAssistantStreamState,
  isAssistantStreamRequestErrored,
  isAssistantStreamSending,
  patchAssistantStream,
  scheduleAssistantStreamFlush,
  setAssistantStreamAbortController,
  setAssistantStreamRequestErrored,
  setAssistantStreamSending,
} from "./assistantStreamCore";

export type { AssistantStreamInstance, AssistantStreamState } from "./assistantStreamCore";
export {
  abortAssistantStream,
  getAssistantStreamState,
  registerAssistantStreamInstance,
  resetAssistantStreamForTests,
  subscribeAssistantStream,
} from "./assistantStreamCore";

/**
 * 「重新生成」目标（#13A）：重跑会话里最后一条助手回答。
 *
 * 与发送共用同一套流式生命周期（handleEvent / 收尾刷新），差别只有三处：
 * 不建会话、不插用户消息、请求打到 regenerate 端点。
 */
export interface RegenerateStreamTarget {
  conversationId: number;
  messageId: number;
}

export interface SendAssistantStreamOptions extends AssistantStreamInstance {
  createConversation: () => Promise<number | null>;
  clearAttachments: () => void;
  attachmentReadsRef: RefObject<number>;
  attachmentsRef: RefObject<PendingAttachment[]>;
  setTouTouStatus: (status: TouTouStatus) => void;
  jobId: number | undefined;
  resumeId: number | undefined;
  /** 本轮引用的岗位/简历快照（F36，乐观气泡用）。 */
  contextRefs?: AssistantMessageReferences;
  /** F36：发送成功后清空关联选择（拿到 conversationId 之后才调，失败不能清）。 */
  clearContextRefs?: () => void;
  webSearch: boolean;
  reasoningEffort: ReasoningEffort;
  surface: AssistantSurface;
  /** 当前引用的消息 id；发送时随请求带上，之后清空。 */
  quotedMessageId: number | null;
  clearQuote: () => void;
  /**
   * T24：**这一条消息**要使用的技能 id（消息级）。空数组时请求里不带 `skill_ids`，
   * 避免旧后端因 `extra="forbid"` 把空字段当成未知参数。
   */
  skillIds?: number[];
  /** 同一批技能的 id+名字快照（乐观气泡显示「使用 X」）；发送后由页面清空选择。 */
  skillRefs?: AssistantMessageSkill[];
  /** 发送已经发起（且会话已拿到）后清空输入区的技能选择：技能只作用于下一条消息。 */
  clearSkills?: () => void;
}

/**
 * 发送一条消息并接管整个流式生命周期（原 useAssistantStream.send 的 store 化）。
 * 期间无论组件是否卸载，状态都写进全局 store，收尾刷新始终执行。
 */
/**
 * 发送一条消息并接管整个流式生命周期（原 useAssistantStream.send 的 store 化）。
 * 期间无论组件是否卸载，状态都写进全局 store，收尾刷新始终执行。
 *
 * ``regenerate``（#13A）非空时走「重新生成最后一条回答」分支：不建会话、不插用户
 * 消息、请求打到 regenerate 端点；流式状态与收尾刷新与发送完全共用。
 */
export async function sendAssistantStreamMessage(
  text: string,
  clearContent: () => void,
  options: SendAssistantStreamOptions,
  regenerate?: RegenerateStreamTarget,
): Promise<void> {
  const trimmedText = text.trim();
  if (isAssistantStreamSending()) return;
  // 重新生成不读输入框/附件，只关心"当前没有别的流正在写同一会话"。
  if (
    !regenerate &&
    ((!trimmedText && options.attachmentsRef.current.length === 0) ||
      options.attachmentReadsRef.current > 0)
  ) {
    return;
  }
  setAssistantStreamSending(true);
  setAssistantStreamRequestErrored(false);
  patchAssistantStream({ sending: true, streamError: "" });
  options.setTouTouStatus("thinking");
  let conversationId: number | null;
  try {
    conversationId =
      regenerate?.conversationId ??
      options.activeIdRef.current ??
      (await options.createConversation());
  } catch (error) {
    setAssistantStreamSending(false);
    patchAssistantStream({
      sending: false,
      streamError:
        error instanceof Error
          ? error.message
          : t("assistantHooks.stream.error.createConversation"),
    });
    options.setTouTouStatus("error");
    return;
  }
  if (!conversationId) {
    setAssistantStreamSending(false);
    patchAssistantStream({
      sending: false,
      streamError: t("assistantHooks.stream.error.createConversation"),
    });
    options.setTouTouStatus("error");
    return;
  }
  // T11 四档权限：请求体永远发送**解算后的两轴布尔**（跟随全局在这里解算成具体档位），
  // 不发中间态——后端只认布尔。解算所需的全局默认取不到时按「仅查看」处理（少发安全）。
  const permissionAxes = await resolvePermissionAxes(conversationId);
  const thresholdTokens = getConversationContextState(conversationId).thresholdTokens;
  const attachmentPayload = regenerate
    ? []
    : options.attachmentsRef.current.map(({ name, mime_type, data }) => ({
        name,
        mime_type,
        data,
      }));
  const optimisticAttachments = regenerate ? [] : [...options.attachmentsRef.current];
  if (!regenerate) {
    clearContent();
    // 引用只对这一次提问有效：发出去就清掉，避免用户以为下一条也带着引用。
    options.clearQuote();
    options.clearContextRefs?.(); // F36：只对这次提问有效，且已拿到 conversationId
    // T24：技能同样只作用于下一条消息；非空才清（空选择不需要一次无意义的 setState）。
    if (options.skillIds?.length) options.clearSkills?.();
  }
  const controller = new AbortController();
  setAssistantStreamAbortController(controller);
  patchAssistantStream({
    // 重新生成：用户消息已经在历史里，不再画一条乐观气泡。
    pendingUserText: regenerate ? "" : trimmedText || t("assistantHooks.stream.attachmentOnly"),
    // 正在发送的这条消息还没有服务端时间戳，用它被发出的时刻顶上。
    pendingSentAt: new Date().toISOString(),
    pendingUserAttachments: optimisticAttachments,
    pendingUserRefs: regenerate ? null : (options.contextRefs ?? null),
    // T24：乐观气泡立刻显示「使用 X」；落库后同一条信息来自 context.skills。
    pendingUserSkills: regenerate ? [] : (options.skillRefs ?? []),
    streamingText: "",
    streamingReasoning: "",
    streamingSources: [],
    streamingSourceMap: [],
    streamingTools: [],
    progressText: "",
    sendingConversationId: conversationId,
    // 新的一轮开始：上一轮撞到的轮次上限提示作废（否则「继续」会跟着旧回答赖着不走）。
    roundLimitRounds: null,
  });
  if (!regenerate) options.clearAttachments();
  const handleEvent = (event: AssistantStreamEvent) => {
    // 手动停止后立刻重发的场景：旧流的迟到事件不能写进新一轮会话状态。
    if (getAssistantStreamAbortController() !== controller) return;
    if (event.type === "delta") {
      appendAssistantStreamTextDelta(event.text);
      scheduleAssistantStreamFlush();
    }
    if (event.type === "reasoning") {
      appendAssistantStreamReasoningDelta(event.text);
      scheduleAssistantStreamFlush();
    }
    if (event.type === "progress") patchAssistantStream({ progressText: event.message });
    if (event.type === "sources") {
      patchAssistantStream({
        streamingSources: event.sources,
        streamingSourceMap: event.source_map ?? [],
        ...(event.error ? { progressText: event.error } : {}),
      });
    }
    if (event.type === "tool") {
      // 显式挑字段，而不是解构剔除 type：仓库的 lint 不允许未使用的变量。
      patchAssistantStream({
        streamingTools: [
          ...getAssistantStreamState().streamingTools,
          {
            name: event.name,
            arguments: event.arguments,
            args_preview: event.args_preview,
            preview: event.preview,
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
      if (getAssistantStreamState().streamingTools.length === 0) return;
      const next = [...getAssistantStreamState().streamingTools];
      next[next.length - 1] = { ...next[next.length - 1], proposal: event.proposal };
      patchAssistantStream({ streamingTools: next });
    }
    if (event.type === "error") {
      recordContextResult(conversationId, event.code);
      setAssistantStreamRequestErrored(true);
      // 出错也先把缓冲的文本冲出去：用户看到的错误前文要与已收到的内容一致。
      finalizeAssistantStreamText();
      patchAssistantStream({ streamError: event.message });
      options.setTouTouStatus("error");
    }
    if (event.type === "done") {
      recordContextResult(conversationId);
      options.setTouTouStatus("done");
    }
    if (event.type === "round_limit") {
      // 撞到轮次上限：留着轮数，流收尾后仍要给用户一个「继续」入口（下一轮发送时复位）。
      patchAssistantStream({ roundLimitRounds: event.rounds });
    }
    if (event.type === "context_usage") {
      // 归到发送时那个会话：面板只在"这条会话"上显示，切换会话时不串号。
      patchAssistantStream({
        contextUsage: event.usage,
        contextUsageConversationId: conversationId,
      });
    }
    if (event.type === "start") void options.reloadConversations();
  };
  try {
    if (regenerate) {
      // #13A：只带"这一次怎么生成"的运行参数；问题与上下文由后端从原消息里取。
      await regenerateAssistantMessage(
        regenerate.conversationId,
        regenerate.messageId,
        {
          reasoning_effort: options.reasoningEffort,
          compaction_threshold_tokens: thresholdTokens,
          relaxed_mode: permissionAxes.relaxed,
          allow_write: permissionAxes.allowWrite,
        },
        handleEvent,
        controller.signal,
        options.surface,
      );
      return;
    }
    // surface 只影响请求 URL 的查询参数，请求通路完全相同，无需分叉。
    await sendAssistantMessage(
      conversationId,
      {
        content: trimmedText,
        compaction_threshold_tokens: thresholdTokens,
        job_id: options.jobId,
        resume_id: options.resumeId,
        // 后端保留这个字段只是兼容旧客户端；助手现在始终读取本地个人资料。
        include_profile: true,
        web_search: options.webSearch,
        // T11：四档权限解算后的两轴（relaxed_mode = 读真实资料，allow_write = 直接写库）。
        relaxed_mode: permissionAxes.relaxed,
        allow_write: permissionAxes.allowWrite,
        reasoning_effort: options.reasoningEffort,
        quoted_message_id: options.quotedMessageId,
        // T24：技能只作用于这一条消息；空选择时整个字段都不发（后端 extra=forbid）。
        ...(options.skillIds && options.skillIds.length > 0 ? { skill_ids: options.skillIds } : {}),
        attachments: attachmentPayload,
        // T25：带上"用户在哪一页、选中了哪条"的结构化线索；标题由后端按当前数据集重查。
        // 查询串只用于白名单参数（`/jobs?job_id=N` 这类抽屉选中），路由表全是静态页，
        // 不给它 selected 会一直是 undefined。
        client_context: buildAssistantClientContext(
          typeof window === "undefined" ? "" : window.location.pathname,
          typeof window === "undefined" ? "" : window.location.search,
        ),
      },
      handleEvent,
      controller.signal,
      options.surface,
    );
  } catch (error) {
    if (!controller.signal.aborted) {
      recordContextResult(conversationId);
      setAssistantStreamRequestErrored(true);
      patchAssistantStream({
        streamError: error instanceof Error ? error.message : t("assistantHooks.stream.error.send"),
      });
      options.setTouTouStatus("error");
    }
  } finally {
    if (getAssistantStreamAbortController() === controller) setAssistantStreamAbortController(null);
    setAssistantStreamSending(false);
    const aborted = controller.signal.aborted;
    const errored = isAssistantStreamRequestErrored();
    // done/abort/error 的统一收口（T02）：强制把缓冲里的最后一批 delta flush 出去，
    // 保证最终展示的流式文本与随后落库的消息逐字节一致，再清空流式视图。
    finalizeAssistantStreamText();
    // 收尾（问题 B 核心）：无论组件是否还挂载，都清空流式视图并完成数据刷新，
    // 保证离场期间回复完整落库、会话列表与命中会话详情被刷新。
    patchAssistantStream({
      sending: false,
      sendingConversationId: null,
      pendingUserText: "",
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
    });
    const targets: AssistantStreamInstance[] = getAssistantStreamInstances();
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
