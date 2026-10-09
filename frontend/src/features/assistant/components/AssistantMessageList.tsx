/** 对话消息、流式回复和加载状态展示。 */

import {
  CheckSquareOutlined,
  CommentOutlined,
  CopyOutlined,
  DeleteOutlined,
} from "@ant-design/icons";
import { Alert, App, Checkbox, Typography } from "antd";
import { memo } from "react";
import type { RefObject } from "react";
import type {
  AssistantConversationDetail,
  AssistantMessage,
  AssistantSource,
  AssistantSourceNumber,
  AssistantToolCall,
} from "../../../types";
import { copyText } from "../../../utils/clipboard";
import { formatDateTime } from "../../../utils/format";
import { RowContextMenu, type RowActionItem } from "../../../components/common/RowActions";
import PageSkeleton from "../../../components/common/PageSkeleton";
import AssistantEmptyState from "./AssistantEmptyState";
import {
  AssistantMessageContent,
  MessageAttachments,
  MessageReasoning,
  MessageSources,
  MessageToolCalls,
  StreamingStatus,
} from "./AssistantMessageContent";
import type { PendingAttachment } from "../assistantUtils";
import type { StarterPrompt } from "../assistantTypes";

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
  streamingText: string;
  /** 正在流式产出的思考内容（开启思考强度时才有）。 */
  streamingReasoning: string;
  streamingSources: AssistantSource[];
  streamingSourceMap: AssistantSourceNumber[];
  streamingTools: AssistantToolCall[];
  progressText: string;
  streamError: string;
  messageEndRef: RefObject<HTMLDivElement | null>;
  enabledSkillCount: number;
  skillsLoaded: boolean;
  onChoosePrompt: (prompt: StarterPrompt) => void;
  onManageSkills: () => void;
  /** 引用某条历史消息追问（右键菜单）。 */
  onQuote: (message: AssistantMessage) => void;
  onDeleteMessage: (message: AssistantMessage) => void;
  /** 右键菜单「批量选择」的动作：进入消息多选模式（页头按钮已收进这里，R8）。 */
  onEnterSelecting: () => void;
  /** 多选模式：勾选多条后一次删掉。 */
  selecting: boolean;
  selectedIds: ReadonlySet<number>;
  onToggleSelected: (message: AssistantMessage) => void;
}

interface BubbleProps {
  item: AssistantMessage;
  assistantLabel: string;
  selected: boolean;
  onQuote: (message: AssistantMessage) => void;
  onDeleteMessage: (message: AssistantMessage) => void;
  /** 右键菜单「批量选择」的动作：进入消息多选模式（页头按钮已收进这里，R8）。 */
  onEnterSelecting: () => void;
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
  onQuote,
  onDeleteMessage,
  onEnterSelecting,
}: BubbleProps) {
  const { message } = App.useApp();

  /** 每条消息的操作：整块右键即可唤出（和岗位卡片、会话列表一致）。 */
  const actionsFor = (): RowActionItem[] => [
    {
      key: "batch_select",
      label: "批量选择",
      icon: <CheckSquareOutlined />,
      onClick: onEnterSelecting,
    },
    {
      key: "quote",
      label: "引用这条继续问",
      icon: <CommentOutlined />,
      onClick: () => onQuote(item),
    },
    {
      key: "copy",
      label: "复制内容",
      icon: <CopyOutlined />,
      onClick: () => {
        void copyText(item.content).then((ok) =>
          ok ? message.success("已复制这条消息") : message.warning("复制失败，可以手动选中"),
        );
      },
    },
    {
      key: "delete",
      label: "删除这条消息",
      icon: <DeleteOutlined />,
      danger: true,
      // 删除不可撤销；引用它的消息保留引用快照，所以这里明确说一下影响范围。
      confirm: "删除这条消息？引用它的提问仍会保留引用内容。",
      onClick: () => onDeleteMessage(item),
    },
  ];

  return (
    <RowContextMenu items={actionsFor()}>
      <article
        className={`assistant-message assistant-message--${item.role}${
          selected ? " assistant-message--selected" : ""
        }`}
      >
        <div className="assistant-message-head">
          <Typography.Text strong>{item.role === "user" ? "你" : assistantLabel}</Typography.Text>
          <Typography.Text type="secondary" className="assistant-message-time">
            {formatDateTime(item.created_at)}
          </Typography.Text>
        </div>
        {item.context.quoted ? (
          <div className="assistant-quoted-block">
            <span className="assistant-quoted-label">
              {item.context.quoted.role === "user" ? "引用你的消息" : "引用助手的回复"}
            </span>
            <span className="assistant-quoted-text">{item.context.quoted.excerpt}</span>
          </div>
        ) : null}
        {/* 思考过程置顶（A2）：先给思考，再给正文——用户最关心"它想清楚没"。 */}
        <MessageReasoning
          reasoning={item.context.reasoning}
          truncated={item.context.reasoning_truncated}
        />
        <AssistantMessageContent content={item.content} sourceMap={item.context.source_map} />
        <MessageAttachments attachments={item.attachments} />
        <MessageSources sources={item.context.sources ?? []} />
        <MessageToolCalls calls={item.context.tool_calls ?? []} />
        {item.status === "error" && item.error && <Alert type="error" title={item.error} />}
      </article>
    </RowContextMenu>
  );
});

export default function AssistantMessageList({
  assistantLabel = "求职助手",
  emptyVariant = "page",
  detail,
  showLoading,
  activeStream,
  sending,
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
  messageEndRef,
  enabledSkillCount,
  skillsLoaded,
  onChoosePrompt,
  onManageSkills,
  onQuote,
  onDeleteMessage,
  onEnterSelecting,
  selecting,
  selectedIds,
  onToggleSelected,
}: Props) {
  const historyMessages = detail?.messages ?? [];

  return (
    <div className="assistant-messages" aria-live="polite">
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
        historyMessages.map((item) => {
          const bubble = (
            <AssistantMessageBubble
              item={item}
              assistantLabel={assistantLabel}
              selected={selectedIds.has(item.id)}
              onQuote={onQuote}
              onDeleteMessage={onDeleteMessage}
              onEnterSelecting={onEnterSelecting}
            />
          );
          // 多选时不挂右键菜单：那套操作（引用、复制）此时都用不上，右键还要和勾选抢交互。
          if (selecting) {
            return (
              <label key={item.id} className="assistant-message-pick">
                <Checkbox
                  checked={selectedIds.has(item.id)}
                  onChange={() => onToggleSelected(item)}
                  aria-label={`选择 ${item.role === "user" ? "你的" : "助手的"}这条消息`}
                />
                {bubble}
              </label>
            );
          }
          return bubble;
        })
      )}
      {activeStream && (pendingUserText || pendingUserAttachments.length > 0) && (
        <article className="assistant-message assistant-message--user">
          <div className="assistant-message-head">
            <Typography.Text strong>你</Typography.Text>
            <Typography.Text type="secondary" className="assistant-message-time">
              {formatDateTime(pendingSentAt)}
            </Typography.Text>
          </div>
          <AssistantMessageContent content={pendingUserText} />
          <MessageAttachments attachments={pendingUserAttachments} />
        </article>
      )}
      {activeStream && sending && (
        <article className="assistant-message assistant-message--assistant">
          <div className="assistant-message-head">
            <Typography.Text strong>{assistantLabel}</Typography.Text>
            <Typography.Text type="secondary" className="assistant-message-time">
              {formatDateTime(pendingSentAt)}
            </Typography.Text>
          </div>
          <MessageReasoning reasoning={streamingReasoning} active />
          <AssistantMessageContent
            content={streamingText || progressText || "正在思考…"}
            sourceMap={streamingSourceMap}
          />
          <StreamingStatus
            message={streamingText ? "正在生成回答" : progressText || "正在准备回答"}
          />
          <MessageSources sources={streamingSources} />
          <MessageToolCalls calls={streamingTools} />
        </article>
      )}
      {activeStream && streamError && <Alert type="error" showIcon title={streamError} />}
      <div ref={messageEndRef} />
    </div>
  );
}
