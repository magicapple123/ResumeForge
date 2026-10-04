/** 助手页 URL 引导域：深链定位 / ?new=1 草稿 / 首次进入欢迎草稿三段 effect。
 *
 * 从 AssistantPage 整域下沉，内部代码逐字搬家。**Router 钩子不进 hook**：
 * searchParams 的解析（requestedConversationId / startNew）由页面完成并传入，
 * hook 只持有「只认一次」的两个 ref 与三段 effect 的语义。
 * 零 api 导入。
 */
import { App } from "antd";
import { useEffect, useRef } from "react";
import type { AssistantConversationBrief } from "../../../types";
import { markAssistantWelcomeShown } from "../welcomeGate";

interface Options {
  /** 深链要定位的会话 id（页面用 positiveId 解析，undefined 表示无深链）。 */
  requestedConversationId: number | undefined;
  /** 是否以 `?new=1` 进入（页面解析后也传给 useAssistantConversations）。 */
  startNew: boolean;
  conversations: AssistantConversationBrief[] | undefined;
  conversationsLoading: boolean;
  conversationsError: string;
  message: ReturnType<typeof App.useApp>["message"];
  selectConversation: (conversationId: number | null) => void;
  startDraft: () => void;
  /** 依赖数组逐字照抄所需（effect 内不再直接调用）。 */
  ensureWelcomeConversation: () => void;
}

export function useAssistantUrlBootstrap({
  requestedConversationId,
  startNew,
  conversations,
  conversationsLoading,
  conversationsError,
  message,
  selectConversation,
  startDraft,
  ensureWelcomeConversation,
}: Options) {
  /** 深链已经定位过的会话 id：只认一次，之后列表怎么刷新都不再抢焦点。 */
  const deepLinkAppliedRef = useRef<number | null>(null);
  const newConversationAppliedRef = useRef(false);

  // 深链：从「复制分享链接」打开时直接定位到那一段对话。
  //
  // **只认一次**：会话列表每次刷新都是一个新数组，而这个 effect 依赖它。不加这道判断的话，
  // 用户点开深链后再切到别的会话，只要发生任何刷新（发消息、重命名、归档、删除……）就会被
  // 拽回深链那一条，正在流式的回复也跟着消失。换一个 conversation 参数时仍然会重新定位。
  useEffect(() => {
    if (requestedConversationId === undefined || conversationsLoading) return;
    if (deepLinkAppliedRef.current === requestedConversationId) return;
    if (conversations === undefined) return;
    deepLinkAppliedRef.current = requestedConversationId;
    if (!conversations.some((item) => item.id === requestedConversationId)) {
      // 链接指向的会话不在已加载的列表里（列表只取最近 100 条）。静默不响应会让用户
      // 以为链接坏了，所以明说一次。
      message.info("链接里的对话不在当前列表中，可能超出了最近 100 条对话的范围。");
      return;
    }
    selectConversation(requestedConversationId);
  }, [conversations, conversationsLoading, message, requestedConversationId, selectConversation]);

  // ?new=1：进入一个**草稿对话**——不落库，只在界面上进入"可以开始写"的状态。
  //
  // 这里以前是直接 `createConversation()`，于是"点一下问助手、什么都没写就退出"也会在
  // 列表里留下一条空对话。真正的记录改由发送时懒创建（`send()` 里
  // `activeIdRef.current ?? await createConversation()`），所以只要用户不发送，就没有记录。
  useEffect(() => {
    if (!startNew || conversationsLoading || conversations === undefined) return;
    if (newConversationAppliedRef.current) return;
    newConversationAppliedRef.current = true;
    startDraft();
  }, [startNew, conversationsLoading, conversations, startDraft]);

  // 首次进入且一条会话都没有：自动创建带欢迎消息的引导对话。
  useEffect(() => {
    if (
      startNew ||
      conversationsLoading ||
      conversationsError ||
      requestedConversationId !== undefined
    ) {
      return;
    }
    // 列表还没回来时 `conversations` 是 undefined，"空"和"没加载"必须分开——
    // 请求失败也走这条分支的话，会因为一次网络抖动就多建一条引导对话。
    if (conversations === undefined) return;
    // 无论是"第一次来"还是"已经用过"，进入这一页都只给一个**草稿**：
    // 空对话的引导提示由 AssistantEmptyState 就地渲染，不需要为它建一条数据库记录
    // （用户要的是"没发送就不产生记录"）。标记仍然记下，语义不变：引导文案只需要出现一次。
    markAssistantWelcomeShown();
    if (conversations.length === 0) startDraft();
  }, [
    conversations,
    conversationsError,
    conversationsLoading,
    ensureWelcomeConversation,
    requestedConversationId,
    startNew,
  ]);
}
