// SPDX-License-Identifier: Apache-2.0
/** 对话消息、流式回复和加载状态展示。 */

import { UpOutlined } from "@ant-design/icons";
import { Alert, Button, Checkbox, Tag, Typography } from "antd";
import { Fragment, memo } from "react";
import type { RefObject } from "react";
import type {
  AssistantConversationDetail,
  AssistantMessage,
  AssistantMessageReferences,
  AssistantMessageSkill,
  AssistantReferenceKind,
  AssistantSource,
  AssistantSourceNumber,
  AssistantToolCall,
} from "../../../types";
import { formatDateTime } from "../../../utils/format";
import { RowContextMenu } from "../../../components/common/RowActions";
import PageSkeleton from "../../../components/common/PageSkeleton";
import AssistantEmptyState from "./AssistantEmptyState";
import CompactionBoundary from "./CompactionBoundary";
import LegacySkillsNotice from "./LegacySkillsNotice";
import MemoryReferenceNote from "./MemoryReferenceNote";
import MessageActionsMore from "./MessageActionsMore";
import MessageCollapse from "./MessageCollapse";
import MessageReferences from "./MessageReferences";
import { useMessageMenuItems } from "./useMessageMenuItems";
import { useSaveKnowledge } from "./useSaveKnowledge";
import ProposalResultNote from "./ProposalResultNote";
import {
  AssistantMessageContent,
  MessageAttachments,
  MessageReasoning,
  MessageSources,
  MessageToolCalls,
  StreamingStatus,
} from "./AssistantMessageContent";
import { toolLabel } from "./MessageToolCalls";
import type { PendingAttachment } from "../assistantUtils";
import type { StarterPrompt } from "../assistantTypes";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  assistantLabel?: string;
  emptyVariant?: "page" | "floating";
  detail: AssistantConversationDetail | null;
  showLoading: boolean;
  activeStream: boolean;
  sending: boolean;
  pendingUserText: string;
  /** 正在发送的那条消息的发出时刻（服务端时间戳还没有）。 */
  pendingSentAt: string;
  pendingUserAttachments: PendingAttachment[];
  /** 正在发送的那条用户消息引用了哪个岗位/简历（发送后输入区已清空，靠这份快照显示）。 */
  pendingUserRefs?: AssistantMessageReferences | null;
  /** 正在发送的那条用户消息勾选了哪些技能（T24，发送后输入区已清空）。 */
  pendingUserSkills?: AssistantMessageSkill[];
  streamingText: string;
  /** 正在流式产出的思考内容（开启思考强度时才有）。 */
  streamingReasoning: string;
  streamingSources: AssistantSource[];
  streamingSourceMap: AssistantSourceNumber[];
  streamingTools: AssistantToolCall[];
  progressText: string;
  streamError: string;
  messageEndRef: RefObject<HTMLDivElement | null>;
  /** 还有更早的消息未加载（B5 按需加载）：列表顶部出「加载更早」。 */
  hasEarlier?: boolean;
  /** 「加载更早」请求进行中（按钮转圈，防连点）。 */
  earlierLoading?: boolean;
  onLoadEarlier?: () => void;
  /** 会话消息总数（B5：消息被截断时如实显示全量数；0 = 未知，不显示）。 */
  messagesTotal?: number;
  enabledSkillCount: number;
  skillsLoaded: boolean;
  onChoosePrompt: (prompt: StarterPrompt) => void;
  onManageSkills: () => void;
  /** 引用某条历史消息追问（右键菜单）。 */
  onQuote: (message: AssistantMessage) => void;
  onDeleteMessage: (message: AssistantMessage) => void;
  /** #13A 重新生成最后一条回答（生成期间按钮 disabled）。 */
  onRegenerate?: (message: AssistantMessage) => void;
  /** 右键菜单「批量选择」的动作：进入消息多选模式（页头按钮已收进这里，R8）。 */
  onEnterSelecting: () => void;
  /** 多选模式：勾选多条后一次删掉。 */
  selecting: boolean;
  selectedIds: ReadonlySet<number>;
  onToggleSelected: (message: AssistantMessage) => void;
  /** 滚动容器（.assistant-messages）ref：页面侧实现 stick-to-bottom（问题 A）用。 */
  messagesScrollRef?: RefObject<HTMLDivElement | null>;
  /** 用户滚动容器时回调：页面侧据此判断是否吸底。 */
  onMessagesScroll?: () => void;
  /** 点击气泡里的岗位/简历引用片（F36）；缺省不可点。 */
  onOpenReference?: (kind: AssistantReferenceKind, id: number) => void;
}

/**
 * 一条用户消息用到的技能（T24，消息级）。
 *
 * 落库消息读 `context.skills`，乐观气泡读发送瞬间的快照——两处同一份渲染，
 * 前缀都写「使用」，不会一边「使用」一边「本对话启用」。
 */
function MessageSkills({ skills }: { skills: AssistantMessageSkill[] }) {
  if (skills.length === 0) return null;
  return (
    <div className="assistant-message-skills assistant-message-refs">
      <span className="assistant-message-refs-label">
        {t("conversationSkills.message.usedLabel")}
      </span>
      {skills.map((skill) => (
        <Tag key={skill.id} className="assistant-ref-chip">
          <span className="assistant-ref-chip-text">{skill.name}</span>
        </Tag>
      ))}
    </div>
  );
}

interface BubbleProps {
  item: AssistantMessage;
  assistantLabel: string;
  selected: boolean;
  /** 只在最后一条助手回答上显示「重新生成」（#13A）。 */
  showRegenerate: boolean;
  /** 流式生成中：重新生成按钮 disabled，避免两条流同时写同一会话。 */
  regenerateDisabled: boolean;
  onQuote: (message: AssistantMessage) => void;
  onDeleteMessage: (message: AssistantMessage) => void;
  onRegenerate?: (message: AssistantMessage) => void;
  /** 右键菜单「批量选择」的动作：进入消息多选模式（页头按钮已收进这里，R8）。 */
  onEnterSelecting: () => void;
  /** 点击气泡里的岗位/简历引用片（F36）；缺省不可点。 */
  onOpenReference?: (kind: AssistantReferenceKind, id: number) => void;
}

/**
 * 单条历史消息气泡（含右键菜单）。
 *
 * 流式期间每个 delta 都会更新页面级 state（streamingText）并让整棵助手页重渲染；
 * 历史气泡的 props（message 对象引用 + 两个稳定回调 + selected 布尔）在流式期间
 * 全部不变，包一层 memo 把它们整个挡在渲染之外——否则长对话下每次 delta 都要
 * 重渲染全部历史气泡（正文解析有内层 useMemo 兜着，但工具调用折叠面板、附件、
 * 右键菜单这些仍然整树重跑）。右键菜单一并收进 memo 边界：`actionsFor` 每次渲染
 * 都是新数组，留在外面会连累 RowContextMenu 一起重渲染。
 */
const AssistantMessageBubble = memo(function AssistantMessageBubble({
  item,
  assistantLabel,
  selected,
  showRegenerate,
  regenerateDisabled,
  onQuote,
  onDeleteMessage,
  onRegenerate,
  onEnterSelecting,
  onOpenReference,
}: BubbleProps) {
  useLocale();
  // #29B：保存弹窗与「已存」链接挂在这条气泡上，菜单项只负责调 openModal。
  const knowledge = useSaveKnowledge(item);
  // 每条消息的操作只在右键 / 窄档「⋯」里出现（F37）；菜单项一份实现，两处共用。
  const menuItems = useMessageMenuItems({
    message: item,
    showRegenerate: item.role === "assistant" && showRegenerate,
    regenerateDisabled,
    onQuote,
    onDelete: onDeleteMessage,
    onRegenerate,
    onEnterSelecting,
    onSaveKnowledge:
      item.role === "assistant" && item.content.trim() ? knowledge.openModal : undefined,
  });

  // T01-A：写操作终态的派生回写渲染成一行状态提示，不再是普通助手气泡——
  // 它不代表模型说话，只代表"那次写入最后怎么样了"。
  const proposalResult = item.context.proposal_result;
  if (item.kind === "proposal_result" && proposalResult) {
    return <ProposalResultNote result={proposalResult} />;
  }

  return (
    <RowContextMenu items={menuItems}>
      <article
        className={`assistant-message assistant-message--${item.role}${
          selected ? " assistant-message--selected" : ""
        }`}
      >
        <div className="assistant-message-head">
          <Typography.Text strong>
            {item.role === "user" ? t("assistantUi.messageList.role.self") : assistantLabel}
          </Typography.Text>
          <Typography.Text type="secondary" className="assistant-message-time">
            {formatDateTime(item.created_at)}
          </Typography.Text>
        </div>
        {item.context.quoted ? (
          <div className="assistant-quoted-block">
            <span className="assistant-quoted-label">
              {item.context.quoted.role === "user"
                ? t("assistantComposer.quote.user")
                : t("assistantComposer.quote.assistant")}
            </span>
            <span className="assistant-quoted-text">{item.context.quoted.excerpt}</span>
          </div>
        ) : null}
        {/* F36：本轮引用的岗位/简历（快照标题，可点击跳到岗位/简历详情）。 */}
        {item.role === "user" ? (
          <MessageReferences refs={item.context} onOpenReference={onOpenReference} />
        ) : null}
        {/* 思考过程置顶（A2）：先给思考，再给正文——用户最关心"它想清楚没"。 */}
        <MessageReasoning
          reasoning={item.context.reasoning}
          truncated={item.context.reasoning_truncated}
        />
        {/* #13B 长回答折叠：只对助手消息生效，折叠不影响复制（复制取完整正文）。 */}
        <MessageCollapse enabled={item.role === "assistant"} content={item.content}>
          <AssistantMessageContent content={item.content} sourceMap={item.context.source_map} />
        </MessageCollapse>
        <MessageAttachments attachments={item.attachments} />
        <MessageSources sources={item.context.sources ?? []} />
        <MessageToolCalls calls={item.context.tool_calls ?? []} />
        {/* T24 可追溯：这条**用户消息**发送时用了哪些技能（消息级，只记名字）。
            F36：与「本轮引用」同款 chip；前缀写「使用」——技能只作用于这一条消息。 */}
        {item.role === "user" ? <MessageSkills skills={item.context.skills ?? []} /> : null}
        {/* T23：这一轮注入过哪些记忆（一行小字，可展开快照）。 */}
        {item.role === "assistant" ? (
          <MemoryReferenceNote memories={item.context.memories} />
        ) : null}
        {item.status === "error" && item.error && <Alert type="error" title={item.error} />}
        {/* #29B 保存结果：一行「已存：标题」链接，不是操作行。 */}
        {knowledge.savedLink}
        {/* F37 窄档（≤767px）的操作入口：桌面只用右键，触屏没有右键。 */}
        <MessageActionsMore items={menuItems} />
        {knowledge.modal}
      </article>
    </RowContextMenu>
  );
});

export default function AssistantMessageList({
  assistantLabel,
  emptyVariant = "page",
  detail,
  showLoading,
  activeStream,
  sending,
  pendingUserText,
  pendingSentAt,
  pendingUserAttachments,
  pendingUserRefs = null,
  pendingUserSkills = [],
  streamingText,
  streamingReasoning,
  streamingSources,
  streamingSourceMap,
  streamingTools,
  progressText,
  streamError,
  messageEndRef,
  hasEarlier = false,
  earlierLoading = false,
  onLoadEarlier,
  messagesTotal = 0,
  enabledSkillCount,
  skillsLoaded,
  onChoosePrompt,
  onManageSkills,
  onQuote,
  onDeleteMessage,
  onRegenerate,
  onEnterSelecting,
  selecting,
  selectedIds,
  onToggleSelected,
  messagesScrollRef,
  onMessagesScroll,
  onOpenReference,
}: Props) {
  useLocale();
  // 页面总会传已翻译的显示名；缺省时按整页形态的「求职助手」兜底。
  const resolvedAssistantLabel = assistantLabel ?? t("responsive.assistant.label");
  const historyMessages = detail?.messages ?? [];
  // #13A：「重新生成」只对**最后一条**助手回答出现——历史回答重跑会打乱后面的上下文。
  const lastAssistantId =
    [...historyMessages]
      .reverse()
      .find((message) => message.role === "assistant" && message.kind !== "proposal_result")?.id ??
    null;
  // T25：压缩边界插在摘要覆盖到的最后一条消息下方；分页把它挤出已加载范围时退化到顶部。
  const compaction = detail?.compaction ?? null;
  const anchorId = compaction?.covered_until_message_id ?? null;
  const anchorVisible = anchorId !== null && historyMessages.some((item) => item.id === anchorId);

  return (
    <div
      className="assistant-messages"
      aria-live="polite"
      ref={messagesScrollRef}
      onScroll={onMessagesScroll}
    >
      {/* T24：旧会话的技能关联已不生效；给一次可关闭的说明（按会话记 localStorage）。 */}
      {detail && (detail.legacy_skills?.length ?? 0) > 0 ? (
        <LegacySkillsNotice
          key={detail.id}
          conversationId={detail.id}
          skills={detail.legacy_skills ?? []}
        />
      ) : null}
      {showLoading ? (
        <PageSkeleton rows={6} card={false} />
      ) : historyMessages.length === 0 && !(sending && activeStream) ? (
        <AssistantEmptyState
          variant={emptyVariant}
          onChoosePrompt={onChoosePrompt}
          enabledSkillCount={enabledSkillCount}
          skillsLoaded={skillsLoaded}
          onManageSkills={onManageSkills}
        />
      ) : (
        <>
          {/* B5 按需加载：消息被截断时，顶部提供「加载更早」并如实展示总条数。 */}
          {(hasEarlier || messagesTotal > 0) && (
            <div className="assistant-messages-head">
              {hasEarlier && (
                <Button
                  size="small"
                  icon={<UpOutlined />}
                  loading={earlierLoading}
                  onClick={onLoadEarlier}
                >
                  {t("assistantUi.messageList.loadEarlier")}
                </Button>
              )}
              {messagesTotal > 0 && (
                <Typography.Text type="secondary">
                  {t("assistantUi.messageList.total", { count: messagesTotal })}
                </Typography.Text>
              )}
            </div>
          )}
          {/* T25：锚点不在已加载范围（分页截断）时退化到列表顶部，说明更早的轮次已压缩。 */}
          {compaction && !anchorVisible ? (
            <CompactionBoundary conversationId={detail?.id ?? 0} compaction={compaction} degraded />
          ) : null}
          {historyMessages.map((item) => {
            const bubble = (
              <AssistantMessageBubble
                item={item}
                assistantLabel={resolvedAssistantLabel}
                selected={selectedIds.has(item.id)}
                showRegenerate={item.id === lastAssistantId}
                regenerateDisabled={sending}
                onQuote={onQuote}
                onDeleteMessage={onDeleteMessage}
                onRegenerate={onRegenerate}
                onEnterSelecting={onEnterSelecting}
                onOpenReference={onOpenReference}
              />
            );
            // T25：摘要覆盖到的最后一条消息下方画边界（不是上方：边界之后的消息仍然在上下文里）。
            const content =
              compaction && anchorVisible && item.id === anchorId ? (
                <>
                  {bubble}
                  <CompactionBoundary conversationId={detail?.id ?? 0} compaction={compaction} />
                </>
              ) : (
                bubble
              );
            // 多选时不挂右键菜单：那套操作（引用、复制）此时都用不上，右键还要和勾选抢交互。
            if (selecting) {
              return (
                <label key={item.id} className="assistant-message-pick">
                  <Checkbox
                    checked={selectedIds.has(item.id)}
                    onChange={() => onToggleSelected(item)}
                    aria-label={
                      item.role === "user"
                        ? t("assistantUi.messageList.aria.selectOwn")
                        : t("assistantUi.messageList.aria.selectAssistant")
                    }
                  />
                  {content}
                </label>
              );
            }
            return <Fragment key={item.id}>{content}</Fragment>;
          })}
        </>
      )}
      {activeStream && (pendingUserText || pendingUserAttachments.length > 0) && (
        <article className="assistant-message assistant-message--user">
          <div className="assistant-message-head">
            <Typography.Text strong>{t("assistantUi.messageList.role.self")}</Typography.Text>
            <Typography.Text type="secondary" className="assistant-message-time">
              {formatDateTime(pendingSentAt)}
            </Typography.Text>
          </div>
          {/* F36 乐观气泡：发送后输入区已清空，引用的岗位/简历靠发送瞬间的快照显示。 */}
          <MessageReferences refs={pendingUserRefs ?? {}} onOpenReference={onOpenReference} />
          <MessageSkills skills={pendingUserSkills} />
          <AssistantMessageContent content={pendingUserText} />
          <MessageAttachments attachments={pendingUserAttachments} />
        </article>
      )}
      {activeStream && sending && (
        <article className="assistant-message assistant-message--assistant">
          <div className="assistant-message-head">
            <Typography.Text strong>{resolvedAssistantLabel}</Typography.Text>
            <Typography.Text type="secondary" className="assistant-message-time">
              {formatDateTime(pendingSentAt)}
            </Typography.Text>
          </div>
          <MessageReasoning reasoning={streamingReasoning} active />
          <AssistantMessageContent
            content={streamingText || progressText || t("assistantUi.messageList.thinking")}
            sourceMap={streamingSourceMap}
          />
          <StreamingStatus
            message={
              streamingText
                ? t("assistantUi.messageList.streaming")
                : progressText || t("assistantUi.messageList.preparing")
            }
          />
          {/* #13C 步骤视图：只报「已执行 N 步 · 当前 xxx」。后端没有 plan 事件，
              所以不写「第 N/M 步」这种没有分母的假进度。 */}
          {streamingTools.length > 0 ? (
            <div className="assistant-steps-hint" data-testid="assistant-steps-hint">
              {t("assistantUi.steps.executed", {
                count: streamingTools.length,
                current:
                  progressText.trim() || toolLabel(streamingTools[streamingTools.length - 1].name),
              })}
            </div>
          ) : null}
          <MessageSources sources={streamingSources} />
          <MessageToolCalls calls={streamingTools} />
        </article>
      )}
      {activeStream && streamError && <Alert type="error" showIcon title={streamError} />}
      <div ref={messageEndRef} />
    </div>
  );
}
