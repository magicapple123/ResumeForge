// SPDX-License-Identifier: Apache-2.0
/** AI 求职助手：流式对话、历史记录、技能开关、附件与项目上下文联动。 */
import { ArrowDownOutlined } from "@ant-design/icons";
import { App, Drawer } from "antd";
import { useEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import AssistantComposer from "../features/assistant/components/AssistantComposer";
import AssistantGroupModal from "../features/assistant/components/AssistantGroupModal";
import AssistantMessageList from "../features/assistant/components/AssistantMessageList";
import AssistantWorkspaceHeader from "../features/assistant/components/AssistantWorkspaceHeader";
import ConversationSidebar from "../features/assistant/components/ConversationSidebar";
import { useMediaQuery } from "../hooks/useMediaQuery";
import { t } from "../i18n";
import { mqMax } from "../theme/breakpoints";
import { readStoredReasoningEffort } from "../features/assistant/readStoredReasoningEffort";
import type { StarterPrompt } from "../features/assistant/assistantTypes";
import { positiveId } from "../features/assistant/assistantUtils";
import { useAssistantAttachments } from "../features/assistant/hooks/useAssistantAttachments";
import { useAssistantAutoScroll } from "../features/assistant/hooks/useAssistantAutoScroll";
import { useAssistantConversations } from "../features/assistant/hooks/useAssistantConversations";
import {
  useAssistantMessageActions,
  useAssistantQuote,
} from "../features/assistant/hooks/useAssistantMessageActions";
import { useAssistantMessageSelection } from "../features/assistant/hooks/useAssistantMessageSelection";
import { useAssistantSidebarActions } from "../features/assistant/hooks/useAssistantSidebarActions";
import { useAssistantSkills } from "../features/assistant/hooks/useAssistantSkills";
import { useAssistantStream } from "../features/assistant/hooks/useAssistantStream";
import { useAssistantUrlBootstrap } from "../features/assistant/hooks/useAssistantUrlBootstrap";
import { useRestoreStreamingConversation } from "../features/assistant/hooks/useRestoreStreamingConversation";
import { useAssistantDisplayStream } from "../features/assistant/hooks/useThrottledStreamingText";
import type { AssistantPageProps } from "./assistantPageTypes";
import type { AssistantConversationBrief, AssistantSurface, ReasoningEffort } from "../types";

export {
  AssistantMessageContent,
  MessageReasoning,
  MessageSources,
  StreamingStatus,
} from "../features/assistant/components/AssistantMessageContent";

export default function AssistantPage({
  compact = false,
  surface: surfaceProp,
}: AssistantPageProps = {}) {
  const { message } = App.useApp();
  const navigate = useNavigate();
  const [searchParams] = useSearchParams();
  const surface: AssistantSurface =
    surfaceProp ?? (searchParams.get("surface") === "floating" ? "floating" : "page");
  // 从工作台等页面跳转过来时可用 ?ask=... 预填提问（例如「帮我把版式调松一点」）。
  // 只预填、**不自动发送**：用户能改完再点发送，避免一个链接就替用户发起一次模型调用。
  const [content, setContent] = useState(() => (searchParams.get("ask") ?? "").slice(0, 4000));
  const [jobId, setJobId] = useState<number | undefined>(() =>
    positiveId(searchParams.get("job_id")),
  );
  const [resumeId, setResumeId] = useState<number | undefined>(() =>
    positiveId(searchParams.get("resume_id")),
  );
  const [webSearch, setWebSearch] = useState(false);
  const [reasoningEffort, setReasoningEffort] =
    useState<ReasoningEffort>(readStoredReasoningEffort);
  const [groupTarget, setGroupTarget] = useState<AssistantConversationBrief | null>(null);
  const [groupValue, setGroupValue] = useState("");
  const [historyOpen, setHistoryOpen] = useState(false);
  const mountedRef = useRef(true);
  const messageEndRef = useRef<HTMLDivElement>(null);
  const requestedConversationId = positiveId(searchParams.get("conversation"));
  // ?new=1：从简历详情等入口进来时默认新开一个空对话，而不是续接/恢复上次会话。
  const startNew = searchParams.get("new") === "1";
  const conversationsState = useAssistantConversations({ message, startNew, surface });
  const {
    startDraft,
    activeId,
    activeIdRef,
    detail,
    detailLoading,
    conversations,
    conversationsLoading,
    conversationsError,
    conversationSearch,
    handleConversationSearch,
    reloadConversations,
    loadDetail,
    loadEarlier,
    earlierLoading,
    selectConversation,
    createConversation,
    ensureWelcomeConversation,
  } = conversationsState;
  const { skills, enabledSkills, skillsLoaded, togglingSkillId, toggleSkill, reloadSkills } =
    useAssistantSkills();
  const openSkillWorkbench = () => navigate("/skills");
  const attachmentsState = useAssistantAttachments({ mountedRef });
  const {
    attachments,
    attachmentsRef,
    attachmentReads,
    attachmentReadsRef,
    clearAttachments,
    removeAttachment,
    addAttachment,
  } = attachmentsState;
  // 引用追问：右键消息「引用这条继续问」后出现，只对下一次提问有效。
  const { quoted, clearQuote, quoteMessage } = useAssistantQuote({ message });

  const { selecting, setSelecting, selectedIds, toggleSelected, removeSelected, exitSelecting } =
    useAssistantMessageSelection({ activeId, loadDetail, message, surface });

  const messageCount = detail?.messages.length ?? 0;

  const stream = useAssistantStream({
    activeIdRef,
    reloadConversations,
    loadDetail,
    createConversation,
    clearAttachments,
    attachmentReadsRef,
    attachmentsRef,
    quotedMessageId: quoted?.id ?? null,
    clearQuote,
    jobId,
    resumeId,
    webSearch,
    reasoningEffort,
    surface,
  });
  const {
    sending,
    sendingConversationId,
    pendingUserText,
    pendingSentAt,
    pendingUserAttachments,
    streamingText,
    streamingReasoning,
    streamingSources,
    streamingSourceMap,
    streamingTools,
    progressText,
    streamError,
    send,
    stop,
  } = stream;
  const { displayText, displayReasoning } = useAssistantDisplayStream(stream);
  const { removeMessage, enterMessageSelecting } = useAssistantMessageActions({
    activeId,
    loadDetail,
    message,
    surface,
    messageCount,
    sending,
    setSelecting,
  });

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      // 问题 B：卸载**不再**中止流式回答。流式会话状态在全局 store
      // （assistantStreamStore）中跨路由存活，离场期间回复继续、结束后由 store
      // 完成数据刷新；abort 只来自用户手动停止（输入框的停止按钮）。
    };
  }, []);

  // 流式会话全局化（问题 B）：回到 /assistant 时恢复"发送中"的完整视图，
  // 整域下沉到 useRestoreStreamingConversation（挂载时一次性尝试，深链/?new=1 优先）。
  useRestoreStreamingConversation({
    sending,
    sendingConversationId,
    activeId,
    requestedConversationId,
    startNew,
    selectConversation,
  });

  // 思考强度：切一次记一次，下次打开助手页沿用上次的选择。
  useEffect(() => {
    window.localStorage.setItem("resumeforge.assistant.reasoning_effort", reasoningEffort);
  }, [reasoningEffort]);

  // 深链 / ?new=1 / 欢迎草稿三段引导 effect：整域下沉到 useAssistantUrlBootstrap。
  useAssistantUrlBootstrap({
    requestedConversationId,
    startNew,
    conversations,
    conversationsLoading,
    conversationsError,
    message,
    selectConversation,
    startDraft,
    ensureWelcomeConversation,
  });

  const historyMessages = detail?.messages ?? [];
  const isActiveStream = activeId !== null && activeId === sendingConversationId;
  const hasActiveDetail = detail?.id === activeId;
  // "还没有会话"和"会话还在加载"在详情为空时长得一样，但只有后者该显示骨架屏。分不清的话
  // 空态会先画出来、被骨架屏顶掉、再画回来（实测每次进入都闪一下）。
  // "草稿"（activeId 为 null）不是"正在加载"：这时候该直接显示空态与输入框，
  // 而不是骨架屏——用户点进来就是要马上开始写。
  const awaitingConversation =
    activeId !== null && (detail === null || (detailLoading && !hasActiveDetail));
  const chooseStarterPrompt = (prompt: StarterPrompt) => {
    setContent(prompt.content);
    if (prompt.enableWebSearch) setWebSearch(true);
  };

  const {
    handleToggleSkill,
    handleSidebarCreate,
    handleSidebarSelect,
    handleSidebarDelete,
    handleSidebarRestored,
    handleSidebarBatchDelete,
    handleSidebarRename,
    handleSidebarToggleFlag,
    handleSidebarArchive,
    handleSidebarFork,
    openGroupModal,
    confirmGroup,
  } = useAssistantSidebarActions({
    conversations: conversationsState,
    groupTarget,
    groupValue,
    message,
    reloadSkills,
    setGroupTarget,
    setGroupValue,
    setHistoryOpen,
    toggleSkill,
  });

  // ===== 滚动域（问题 A）：吸底跟随、定位到底部与「加载更早」跳过 =====
  // 整域下沉到 useAssistantAutoScroll；页面只消费回调与「回到底部」显隐。
  const {
    handleLoadEarlier,
    handleMessagesScroll,
    messagesScrollRef,
    scrollToBottom,
    showScrollBottom,
  } = useAssistantAutoScroll({
    messageEndRef,
    awaitingConversation,
    detailId: detail?.id,
    detailMessages: detail?.messages,
    historyCount: historyMessages.length,
    isActiveStream,
    sending,
    pendingUserText,
    progressText,
    streamError,
    streamingSources,
    streamingReasoning,
    streamingTools,
    streamingText,
    loadEarlier,
  });

  /**
   * 平板档（≤1092 且 >767）：历史列表从"压成 220px 横条"改成抽屉（方案 §4.8）。
   * 为什么要换：横条把消息区高度吃掉 220px，而 768 高的屏本来就紧；抽屉只在需要时出现，
   * 关掉就把高度还给对话。≤767 保持原样——手机档的横条是 `mobile.css` 里成型的形态。
   * 浮窗（`compact`）有自己的浮层，不参与。
   */
  const narrowViewport = useMediaQuery(mqMax("narrow"));
  const phoneViewport = useMediaQuery(mqMax("phone"));
  const historyDrawer = narrowViewport && !phoneViewport && !compact;
  const [historyDrawerOpen, setHistoryDrawerOpen] = useState(false);

  // 浮窗的历史抽屉是盖在内容上的：除了点背板，键盘用户还需要一条直接退出的路。
  useEffect(() => {
    if (!compact || !historyOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [compact, historyOpen]);

  /**
   * 历史列表**只有一份 JSX**：宽档内联、平板档进抽屉、浮窗进浮层，三处共用同一个节点。
   * 写三遍的话（曾经有过两遍）"会话搜索""批量删除"这类能力会在某一处悄悄缺失。
   */
  const sidebarNode = (
    <ConversationSidebar
      surface={surface}
      conversations={conversations}
      loading={conversationsLoading}
      activeId={activeId}
      onCreate={handleSidebarCreate}
      onSelect={handleSidebarSelect}
      onDelete={handleSidebarDelete}
      onRestored={handleSidebarRestored}
      onBatchDelete={handleSidebarBatchDelete}
      onRename={handleSidebarRename}
      onToggleFlag={handleSidebarToggleFlag}
      onArchive={handleSidebarArchive}
      onFork={handleSidebarFork}
      onMoveToGroup={openGroupModal}
      // 会话搜索（P0-2）：输入防抖后走服务端 keyword 过滤。
      search={conversationSearch}
      onSearchChange={handleConversationSearch}
      className={compact ? "assistant-sidebar--floating" : undefined}
    />
  );
  return (
    <div className={`assistant-page${compact ? " assistant-page--floating" : ""}`}>
      {compact && historyOpen && (
        <button
          type="button"
          className="assistant-sidebar-backdrop"
          aria-label="关闭历史记录"
          onClick={() => setHistoryOpen(false)}
        />
      )}
      {(!compact && !historyDrawer) || (compact && historyOpen) ? sidebarNode : null}
      {historyDrawer ? (
        <Drawer
          className="assistant-history-drawer"
          open={historyDrawerOpen}
          onClose={() => setHistoryDrawerOpen(false)}
          title={t("responsive.assistant.history.title")}
          size="default"
          destroyOnHidden
        >
          {sidebarNode}
        </Drawer>
      ) : null}
      <section className={`assistant-workspace${selecting ? " is-selecting" : ""}`}>
        <AssistantWorkspaceHeader
          compact={compact}
          // 平板档把历史收进抽屉时，页头那颗按钮改开抽屉（`aria-expanded` 也跟着走）。
          showHistoryButton={historyDrawer}
          historyOpen={historyDrawer ? historyDrawerOpen : historyOpen}
          onToggleHistory={() =>
            historyDrawer
              ? setHistoryDrawerOpen((current) => !current)
              : setHistoryOpen((current) => !current)
          }
          selecting={selecting}
          selectedIds={selectedIds}
          removeSelected={removeSelected}
          exitSelecting={exitSelecting}
          title={detail?.title || "AI 求职助手"}
        />
        <AssistantMessageList
          detail={detail}
          showLoading={awaitingConversation}
          activeStream={isActiveStream}
          sending={sending}
          pendingUserText={pendingUserText}
          pendingSentAt={pendingSentAt}
          pendingUserAttachments={pendingUserAttachments}
          streamingText={displayText}
          streamingReasoning={displayReasoning}
          streamingSources={streamingSources}
          streamingSourceMap={streamingSourceMap}
          streamingTools={streamingTools}
          progressText={progressText}
          streamError={streamError}
          messageEndRef={messageEndRef}
          hasEarlier={detail?.has_earlier ?? false}
          earlierLoading={earlierLoading}
          onLoadEarlier={() => void handleLoadEarlier()}
          messagesTotal={detail?.messages_total ?? 0}
          enabledSkillCount={enabledSkills.length}
          skillsLoaded={skillsLoaded}
          assistantLabel={compact ? "投投" : "求职助手"}
          emptyVariant={compact ? "floating" : "page"}
          onChoosePrompt={chooseStarterPrompt}
          onManageSkills={openSkillWorkbench}
          onQuote={quoteMessage}
          onDeleteMessage={removeMessage}
          onEnterSelecting={enterMessageSelecting}
          selecting={selecting}
          selectedIds={selectedIds}
          onToggleSelected={toggleSelected}
          messagesScrollRef={messagesScrollRef}
          onMessagesScroll={handleMessagesScroll}
        />
        {/* 问题 A：流式期间用户上翻退出吸底后出现的「回到底部」悬浮按钮。
            点击滚到底并恢复吸底跟随。z-index 用页面内局部浮层的个位数一档，
            不与悬浮球/浮窗（1000+）冲突。 */}
        {showScrollBottom && (
          <button
            type="button"
            className="assistant-scroll-bottom"
            aria-label="回到底部"
            title="回到底部"
            onClick={scrollToBottom}
          >
            <ArrowDownOutlined aria-hidden="true" />
          </button>
        )}
        <AssistantComposer
          compact={compact}
          content={content}
          attachments={attachments}
          sending={sending}
          attachmentReads={attachmentReads}
          jobId={jobId}
          resumeId={resumeId}
          webSearch={webSearch}
          reasoningEffort={reasoningEffort}
          skills={skills}
          skillsLoaded={skillsLoaded}
          togglingSkillId={togglingSkillId}
          onContentChange={setContent}
          onJobChange={setJobId}
          onResumeChange={setResumeId}
          onWebSearchChange={setWebSearch}
          onReasoningEffortChange={setReasoningEffort}
          onToggleSkill={(skill, enabled) => void handleToggleSkill(skill, enabled)}
          onManageSkills={openSkillWorkbench}
          onAddAttachment={(file) => void addAttachment(file)}
          onRemoveAttachment={removeAttachment}
          quoted={quoted}
          onClearQuote={clearQuote}
          onSend={() => void send(content, () => setContent(""))}
          onStop={stop}
        />
      </section>
      <AssistantGroupModal
        open={groupTarget !== null}
        onClose={() => setGroupTarget(null)}
        onConfirm={() => void confirmGroup()}
        value={groupValue}
        onChange={setGroupValue}
      />
    </div>
  );
}
