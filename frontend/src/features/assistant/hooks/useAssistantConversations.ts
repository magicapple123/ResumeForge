// SPDX-License-Identifier: Apache-2.0
/** 求职助手会话列表、详情加载与会话管理操作。 */

import { App } from "antd";
import { useCallback, useEffect, useRef, useState } from "react";
import {
  createAssistantConversation,
  deleteAssistantConversation,
  forkAssistantConversation,
  getAssistantConversation,
  getEarlierAssistantMessages,
  listAssistantConversations,
  renameAssistantConversation,
  updateAssistantConversation,
} from "../../../api/assistant";
import { useApi } from "../../../hooks/useApi";
import { t } from "../../../i18n";
import { hasShownAssistantWelcome, markAssistantWelcomeShown } from "../welcomeGate";
import type {
  AssistantConversationBrief,
  AssistantConversationDetail,
  AssistantSurface,
} from "../../../types";

/** 会话搜索的防抖间隔（毫秒）：与远程搜索下拉的节奏保持一致。 */
const SEARCH_DEBOUNCE_MS = 300;
/** 详情首屏只拉最新 N 条消息（B5 按需加载）；更早的靠「加载更早」分页补齐。 */
const DETAIL_MESSAGE_LIMIT = 50;

interface Options {
  message: ReturnType<typeof App.useApp>["message"];
  surface?: AssistantSurface;
  /** 为真时进入「新对话」模式：不自动恢复最近会话（由页面负责新建空会话）。 */
  /** 是否以"新对话"进入（`?new=1`）。会话钩子不再用它——草稿状态由页面侧决定；
   *  保留参数是为了不打断调用方签名，也留下"这个入口存在"的痕迹。 */
  startNew?: boolean;
}

/** 会话可以被单独修改的字段（置顶/收藏/归档/分组名）。 */
export type ConversationPatch = Partial<
  Pick<AssistantConversationBrief, "pinned" | "favorite" | "archived" | "group_name">
>;

export function useAssistantConversations({ message, surface = "page" }: Options) {
  const [activeId, setActiveId] = useState<number | null>(null);
  const [detail, setDetail] = useState<AssistantConversationDetail | null>(null);
  const [detailLoading, setDetailLoading] = useState(false);
  const activeIdRef = useRef<number | null>(null);
  const detailRequestRef = useRef(0);
  const welcomeRequestedRef = useRef(false);

  // 会话搜索（P0-2）：输入框值立即回显，防抖后再作为服务端 keyword 触发重拉——
  // 不再靠"前 100 条"兜底，第 101 条之后的会话也能按关键词搜到。
  const [conversationSearch, setConversationSearch] = useState("");
  const [searchKeyword, setSearchKeyword] = useState("");
  const searchTimerRef = useRef<number | null>(null);
  const handleConversationSearch = useCallback((value: string) => {
    setConversationSearch(value);
    if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    searchTimerRef.current = window.setTimeout(() => {
      searchTimerRef.current = null;
      setSearchKeyword(value.trim());
    }, SEARCH_DEBOUNCE_MS);
  }, []);
  // 卸载时清掉未触发的防抖定时器。
  useEffect(
    () => () => {
      if (searchTimerRef.current !== null) window.clearTimeout(searchTimerRef.current);
    },
    [],
  );

  const {
    data: conversations,
    loading: conversationsLoading,
    error: conversationsError,
    reload: reloadConversations,
  } = useApi(
    () =>
      surface === "page"
        ? listAssistantConversations("page", searchKeyword)
        : listAssistantConversations(surface, searchKeyword),
    [surface, searchKeyword],
  );

  const selectConversation = useCallback((conversationId: number | null) => {
    activeIdRef.current = conversationId;
    setActiveId(conversationId);
  }, []);

  /**
   * 进入"草稿"对话：界面上是一段可以马上写的空对话，**数据库里什么都不建**。
   *
   * 记录由第一次发送时懒创建（见 `useAssistantStream.send`）。这样"点进来看看、
   * 什么都没写就退出"不会留下一堆空对话——用户明确要求过这一点。
   */
  const startDraft = useCallback(() => {
    selectConversation(null);
    setDetail(null);
  }, [selectConversation]);

  useEffect(() => {
    if (conversationsError) message.error(conversationsError);
  }, [conversationsError, message]);

  // 进入助手页**不再自动打开最近那条会话**：用户要的是"点进来就是一段可以马上写的新对话"，
  // 记录由第一次发送时懒创建（见 useAssistantStream.send）。历史会话仍在左侧列表里，
  // 点一下就切过去；?conversation= 深链也照旧能直接定位。
  // （以前这里会自动选中 conversations[0]，于是每次进来先看到上次的对话。）

  // 无 activeId 时清空详情。Compiler 规范：随 activeId 变化的重置用渲染期守卫式
  // 调整（哨兵 undefined 覆盖挂载场景）。
  const [prevActiveId, setPrevActiveId] = useState<number | null | undefined>(activeId);
  if (prevActiveId !== activeId) {
    setPrevActiveId(activeId);
    if (!activeId) {
      setDetail(null);
      setDetailLoading(false);
    } else {
      setDetailLoading(true);
    }
  }

  // 纯取数（不含任何 setState）：effect 内联调用时 Compiler 才能验证非同步更新；
  // 返回 invalidated 标记区分"已被更新请求作废"与"出错/成功"。
  const fetchDetail = useCallback(
    async (
      conversationId: number,
    ): Promise<{ invalidated: boolean; detail: AssistantConversationDetail | null }> => {
      const requestId = ++detailRequestRef.current;
      try {
        const next = await getAssistantConversation(conversationId, surface, {
          message_limit: DETAIL_MESSAGE_LIMIT,
        });
        if (requestId !== detailRequestRef.current) return { invalidated: true, detail: null };
        return { invalidated: false, detail: next };
      } catch (error) {
        const invalidated = requestId !== detailRequestRef.current;
        if (!invalidated)
          message.error(
            error instanceof Error
              ? error.message
              : t("assistantHooks.conversations.error.loadDetail"),
          );
        return { invalidated, detail: null };
      }
    },
    [message, surface],
  );

  useEffect(() => {
    if (!activeId) return;
    let cancelled = false;
    void fetchDetail(activeId).then((result) => {
      if (cancelled) return;
      if (!result.invalidated) setDetail(result.detail);
      setDetailLoading(false);
    });
    return () => {
      cancelled = true;
      detailRequestRef.current += 1;
    };
  }, [activeId, fetchDetail]);

  // 事件路径（切换会话、发消息后刷新）：含 loading 前置，供事件处理器调用。
  const loadDetail = useCallback(
    async (conversationId: number) => {
      setDetailLoading(true);
      const result = await fetchDetail(conversationId);
      if (!result.invalidated) setDetail(result.detail);
      setDetailLoading(false);
    },
    [fetchDetail],
  );

  // 「加载更早」（B5）：prepend 到现有消息前，并同步 has_earlier；失败只提示不清屏。
  const [earlierLoading, setEarlierLoading] = useState(false);
  const loadEarlier = useCallback(async () => {
    const current = detail;
    if (!current || current.id !== activeIdRef.current) return;
    const oldest = current.messages[0];
    if (!oldest) return;
    setEarlierLoading(true);
    try {
      const resp = await getEarlierAssistantMessages(current.id, oldest.id, 50, surface);
      setDetail((prev) =>
        prev && prev.id === current.id
          ? {
              ...prev,
              messages: [...resp.items, ...prev.messages],
              has_earlier: resp.has_earlier,
            }
          : prev,
      );
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : t("assistantHooks.conversations.error.loadEarlier"),
      );
    } finally {
      setEarlierLoading(false);
    }
  }, [detail, message, surface]);

  const createConversation = useCallback(async () => {
    try {
      const created =
        surface === "page"
          ? await createAssistantConversation()
          : await createAssistantConversation("", { surface });
      selectConversation(created.id);
      setDetail({ ...created, messages: [] });
      await reloadConversations();
      return created.id;
    } catch (error) {
      message.error(
        error instanceof Error ? error.message : t("assistantHooks.conversations.error.create"),
      );
      return null;
    }
  }, [message, reloadConversations, selectConversation, surface]);

  /**
   * 内置引导对话：**第一次**用助手且一条会话都没有时，自动建一条带欢迎消息的会话。
   *
   * 两道闸：`welcomeRequestedRef` 挡住同一次挂载里的重复调用（创建失败也不循环重试，
   * 否则一个持续报错的后端会让页面不停发请求），`hasShownAssistantWelcome()` 挡住
   * 跨挂载的重复——不然用户删光会话后每次回到这一页都会被再塞一条。
   */
  const ensureWelcomeConversation = useCallback(async () => {
    if (welcomeRequestedRef.current) return;
    welcomeRequestedRef.current = true;
    if (hasShownAssistantWelcome()) return;
    try {
      const created =
        surface === "page"
          ? await createAssistantConversation("", { welcome: true })
          : await createAssistantConversation("", { welcome: true, surface });
      markAssistantWelcomeShown();
      selectConversation(created.id);
      await loadDetail(created.id);
      await reloadConversations();
    } catch (error) {
      message.error(
        error instanceof Error
          ? error.message
          : t("assistantHooks.conversations.error.createWelcome"),
      );
    }
  }, [loadDetail, message, reloadConversations, selectConversation, surface]);

  /**
   * 删除一段对话。
   *
   * @returns 是否真的删掉了。软删的撤销入口（见 `useDeleteUndo`）只应在成功之后出现，
   *   所以这里必须把失败如实报回来，而不是一律 resolve。
   */
  const removeConversation = useCallback(
    async (id: number): Promise<boolean> => {
      try {
        if (surface === "page") await deleteAssistantConversation(id);
        else await deleteAssistantConversation(id, surface);
        if (activeIdRef.current === id) {
          selectConversation(null);
          setDetail(null);
        }
        await reloadConversations();
        return true;
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : t("assistantHooks.conversations.error.delete"),
        );
        return false;
      }
    },
    [message, reloadConversations, selectConversation, surface],
  );

  const saveConversationTitle = useCallback(
    async (id: number, nextTitle: string) => {
      const title = nextTitle.trim();
      if (!title) {
        message.warning(t("assistantHooks.conversations.warning.emptyTitle"));
        return;
      }
      try {
        const updated =
          surface === "page"
            ? await renameAssistantConversation(id, title)
            : await renameAssistantConversation(id, title, surface);
        setDetail((current) =>
          current?.id === id ? { ...current, title: updated.title } : current,
        );
        await reloadConversations();
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : t("assistantHooks.conversations.error.rename"),
        );
      }
    },
    [message, reloadConversations, surface],
  );

  const updateConversation = useCallback(
    async (id: number, patch: ConversationPatch) => {
      try {
        const updated =
          surface === "page"
            ? await updateAssistantConversation(id, patch)
            : await updateAssistantConversation(id, patch, surface);
        setDetail((current) => (current?.id === id ? { ...current, ...updated } : current));
        await reloadConversations();
        return updated;
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : t("assistantHooks.conversations.error.update"),
        );
        return null;
      }
    },
    [message, reloadConversations, surface],
  );

  /** 兼容旧调用点：切换置顶/收藏。 */
  const updateConversationFlags = useCallback(
    async (
      conversation: Pick<AssistantConversationBrief, "id" | "pinned" | "favorite">,
      field: "pinned" | "favorite",
    ) => {
      await updateConversation(conversation.id, { [field]: !conversation[field] });
    },
    [updateConversation],
  );

  /** 「在新对话中继续」：复制最近若干条消息到一段新会话并切过去。 */
  const forkConversation = useCallback(
    async (id: number) => {
      try {
        const forkPayload = {
          message_limit: 10,
          title: `${(conversations ?? []).find((item) => item.id === id)?.title ?? ""}${t(
            "assistantHooks.conversations.forkTitleSuffix",
          )}`,
        };
        const created =
          surface === "page"
            ? await forkAssistantConversation(id, forkPayload)
            : await forkAssistantConversation(id, forkPayload, surface);
        selectConversation(created.id);
        setDetail(created);
        await reloadConversations();
        return created.id;
      } catch (error) {
        message.error(
          error instanceof Error ? error.message : t("assistantHooks.conversations.error.fork"),
        );
        return null;
      }
    },
    [conversations, message, reloadConversations, selectConversation, surface],
  );

  return {
    startDraft,
    activeId,
    activeIdRef,
    detail,
    detailLoading,
    conversations,
    conversationsLoading,
    conversationsError,
    /** 会话搜索输入框的受控值（未防抖，输入即时回显）。 */
    conversationSearch,
    /** 输入变化 → 300ms 防抖后触发服务端 keyword 搜索（P0-2）。 */
    handleConversationSearch,
    reloadConversations,
    loadDetail,
    loadEarlier,
    earlierLoading,
    selectConversation,
    createConversation,
    ensureWelcomeConversation,
    removeConversation,
    saveConversationTitle,
    updateConversation,
    updateConversationFlags,
    forkConversation,
  };
}
