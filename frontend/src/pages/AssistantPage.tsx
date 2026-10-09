/** AI 求职助手：流式对话、历史记录、技能开关、附件与项目上下文联动。 */
import { HistoryOutlined } from "@ant-design/icons";
import { App, Button, Space, Typography } from "antd";
import { useCallback, useEffect, useLayoutEffect, useRef, useState } from "react";
import { useNavigate, useSearchParams } from "react-router-dom";
import { deleteAssistantMessage } from "../api/assistant";
import AssistantComposer from "../features/assistant/components/AssistantComposer";
import AssistantGroupModal from "../features/assistant/components/AssistantGroupModal";
import AssistantMessageList from "../features/assistant/components/AssistantMessageList";
import AssistantSelectBar from "../features/assistant/components/AssistantSelectBar";
import ConversationSidebar from "../features/assistant/components/ConversationSidebar";
import { readStoredReasoningEffort } from "../features/assistant/readStoredReasoningEffort";
import type { StarterPrompt } from "../features/assistant/assistantTypes";
import { positiveId } from "../features/assistant/assistantUtils";
import { useAssistantAttachments } from "../features/assistant/hooks/useAssistantAttachments";
import { useAssistantConversations } from "../features/assistant/hooks/useAssistantConversations";
import { useAssistantMessageSelection } from "../features/assistant/hooks/useAssistantMessageSelection";
import { useAssistantSkills } from "../features/assistant/hooks/useAssistantSkills";
import { useAssistantStream } from "../features/assistant/hooks/useAssistantStream";
import { useAssistantUrlBootstrap } from "../features/assistant/hooks/useAssistantUrlBootstrap";
import type { AssistantPageProps } from "./assistantPageTypes";
import type {
  AssistantConversationBrief,
  AssistantMessage,
  AssistantQuotedMessage,
  AssistantSurface,
  ReasoningEffort,
} from "../types";

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
  // 从工作台等页面跳转过来时可用 ?ask=... 预填提问（例如「帮我把格式模板调松一点」）。
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
    contextOptions,
    reloadConversations,
    loadDetail,
    selectConversation,
    createConversation,
    ensureWelcomeConversation,
    removeConversation,
    saveConversationTitle,
    updateConversation,
    updateConversationFlags,
    forkConversation,
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
  const [quoted, setQuoted] = useState<AssistantQuotedMessage | null>(null);
  const clearQuote = useCallback(() => setQuoted(null), []);

  const quoteMessage = useCallback(
    (target: AssistantMessage) => {
      setQuoted({
        id: target.id,
        role: target.role,
        // 与后端快照保持同样的截断长度，避免引用块里显示的长度前后不一致。
        excerpt: target.content.trim().slice(0, 500) || "[附件消息]",
      });
      message.info("已引用这条消息，输入你的追问即可");
    },
    [message],
  );

  const removeMessage = useCallback(
    async (target: AssistantMessage) => {
      if (!activeId) return;
      try {
        if (surface === "page") await deleteAssistantMessage(activeId, target.id);
        else await deleteAssistantMessage(activeId, target.id, surface);
        await loadDetail(activeId);
        message.success("消息已删除");
      } catch (error) {
        message.error(error instanceof Error ? error.message : "删除消息失败");
      }
    },
    [activeId, loadDetail, message, surface],
  );

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
    mountedRef,
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

  /** 消息右键菜单「批量选择」的动作（页头按钮已收进这里，R8）。
   *  多选只在有历史消息时才有意义；流式回复期间也不给进——那两条临时气泡还不在
   *  数据库里，勾不上。 */
  const enterMessageSelecting = useCallback(() => {
    if (messageCount > 0 && !sending) setSelecting(true);
  }, [messageCount, sending, setSelecting]);

  useEffect(() => {
    mountedRef.current = true;
    return () => {
      mountedRef.current = false;
      stop();
    };
  }, [stop]);

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
  const jobOptions = (contextOptions?.jobs ?? []).map((job) => ({
    value: job.id,
    label: `${job.company ? `${job.company} · ` : ""}${job.title}`,
  }));
  const resumeOptions = (contextOptions?.resumes ?? []).map((resume) => ({
    value: resume.id,
    label: resume.title,
  }));
  const chooseStarterPrompt = (prompt: StarterPrompt) => {
    setContent(prompt.content);
    if (prompt.enableWebSearch) setWebSearch(true);
  };

  const handleToggleSkill = useCallback(
    async (skill: (typeof skills)[number], enabled: boolean) => {
      try {
        await toggleSkill(skill, enabled);
        message.success(`已${enabled ? "启用" : "停用"}技能「${skill.name}」`);
      } catch (error) {
        message.error(error instanceof Error ? error.message : "切换技能失败");
        await reloadSkills();
      }
    },
    [message, reloadSkills, toggleSkill],
  );

  // 会话列表的操作回调全部 useCallback：ConversationSidebar 包了 memo，流式期间
  // 页面级 state（streamingText）每个 delta 都在变，props 引用不稳定的话 memo 形同虚设。
  const handleSidebarCreate = useCallback(() => {
    setHistoryOpen(false);
    void createConversation();
  }, [createConversation]);

  const handleSidebarSelect = useCallback(
    (id: number) => {
      setHistoryOpen(false);
      selectConversation(id);
    },
    [selectConversation],
  );

  const handleSidebarDelete = useCallback(
    (id: number) => void removeConversation(id),
    [removeConversation],
  );

  const handleSidebarBatchDelete = useCallback(
    (ids: number[]) => {
      // 批量删除：逐条走同一条删除通路（内部会刷新列表）。
      for (const id of ids) void removeConversation(id);
    },
    [removeConversation],
  );

  const handleSidebarRename = useCallback(
    (id: number, title: string) => void saveConversationTitle(id, title),
    [saveConversationTitle],
  );

  const handleSidebarToggleFlag = useCallback(
    (conversation: AssistantConversationBrief, field: "pinned" | "favorite") =>
      void updateConversationFlags(conversation, field),
    [updateConversationFlags],
  );

  const handleSidebarArchive = useCallback(
    (conversation: AssistantConversationBrief, archived: boolean) =>
      void updateConversation(conversation.id, { archived }),
    [updateConversation],
  );

  const handleSidebarFork = useCallback(
    (conversation: AssistantConversationBrief) => void forkConversation(conversation.id),
    [forkConversation],
  );

  const openGroupModal = useCallback((conversation: AssistantConversationBrief) => {
    setGroupTarget(conversation);
    setGroupValue(conversation.group_name);
  }, []);

  const confirmGroup = async () => {
    if (!groupTarget) return;
    const updated = await updateConversation(groupTarget.id, { group_name: groupValue.trim() });
    if (updated) {
      message.success(groupValue.trim() ? `已移动到「${groupValue.trim()}」` : "已移出分组");
      setGroupTarget(null);
    }
  };

  // 在浏览器绘制前定位到末尾，避免详情刷新时先闪现旧的顶部位置。
  useLayoutEffect(() => {
    if (awaitingConversation || (!historyMessages.length && !isActiveStream)) return;
    messageEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [awaitingConversation, detail?.id, detail?.messages, historyMessages.length, isActiveStream]);

  useEffect(() => {
    if (!sending || !isActiveStream) return;
    messageEndRef.current?.scrollIntoView({ behavior: "auto", block: "end" });
  }, [
    isActiveStream,
    pendingUserText,
    progressText,
    sending,
    streamError,
    streamingSources,
    streamingReasoning,
    streamingTools,
    streamingText,
  ]);

  // 浮窗的历史抽屉是盖在内容上的：除了点背板，键盘用户还需要一条直接退出的路。
  useEffect(() => {
    if (!compact || !historyOpen) return;
    const handleKeyDown = (event: KeyboardEvent) => {
      if (event.key === "Escape") setHistoryOpen(false);
    };
    window.addEventListener("keydown", handleKeyDown);
    return () => window.removeEventListener("keydown", handleKeyDown);
  }, [compact, historyOpen]);

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
      {(!compact || historyOpen) && (
        <ConversationSidebar
          surface={surface}
          conversations={conversations}
          loading={conversationsLoading}
          activeId={activeId}
          onCreate={handleSidebarCreate}
          onSelect={handleSidebarSelect}
          onDelete={handleSidebarDelete}
          onBatchDelete={handleSidebarBatchDelete}
          onRename={handleSidebarRename}
          onToggleFlag={handleSidebarToggleFlag}
          onArchive={handleSidebarArchive}
          onFork={handleSidebarFork}
          onMoveToGroup={openGroupModal}
          className={compact ? "assistant-sidebar--floating" : undefined}
        />
      )}
      <section className={`assistant-workspace${selecting ? " is-selecting" : ""}`}>
        <header className="assistant-header">
          <div className="assistant-header-titles">
            <Typography.Title level={3}>{detail?.title || "AI 求职助手"}</Typography.Title>
            <Typography.Text type="secondary">当前回复由「设置」中的模型配置提供。</Typography.Text>
          </div>
          {/* 多选入口已收进消息右键菜单（R8）；浮窗这里只剩历史按钮。
              header 是 space-between 布局，只剩两个子元素时操作全部靠右。 */}
          <Space size={4} className="assistant-header-actions">
            {compact && (
              <Button
                type="text"
                icon={<HistoryOutlined />}
                aria-label="查看投投历史"
                aria-expanded={historyOpen}
                onClick={() => setHistoryOpen((current) => !current)}
              >
                历史
              </Button>
            )}
          </Space>
        </header>
        {selecting && (
          <AssistantSelectBar
            selectedCount={selectedIds.size}
            disabled={selectedIds.size === 0}
            onDelete={removeSelected}
            onExit={exitSelecting}
          />
        )}
        <AssistantMessageList
          detail={detail}
          showLoading={awaitingConversation}
          activeStream={isActiveStream}
          sending={sending}
          pendingUserText={pendingUserText}
          pendingSentAt={pendingSentAt}
          pendingUserAttachments={pendingUserAttachments}
          streamingText={streamingText}
          streamingReasoning={streamingReasoning}
          streamingSources={streamingSources}
          streamingSourceMap={streamingSourceMap}
          streamingTools={streamingTools}
          progressText={progressText}
          streamError={streamError}
          messageEndRef={messageEndRef}
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
        />
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
          jobOptions={jobOptions}
          resumeOptions={resumeOptions}
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
