// SPDX-License-Identifier: Apache-2.0
/** 求职助手消息输入区：关联上下文 chip、引用、附件、数据权限提示与工具栏。 */

import {
  CloseOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileWordOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Image, Input, Tag, Tooltip } from "antd";
import type { GetRef } from "antd";
import { useEffect, useRef } from "react";
import {
  ASSISTANT_ACCEPT,
  MAX_ATTACHMENT_COUNT,
  canPreviewImage,
  clipboardImages,
  type PendingAttachment,
} from "../assistantUtils";
import type {
  AssistantMessageReferences,
  AssistantQuotedMessage,
  AssistantSkill,
} from "../../../types";
import type { ContextUsage, ReasoningEffort } from "../../../types/assistant";
import type {
  ConversationSkillBudget,
  ConversationSkillItem,
} from "../../../api/conversationSkills";
import FileDropZone from "../../../components/common/FileDropZone";
import { appendTranscript } from "../../interview-voice/appendTranscript";
import { VoiceButton } from "../../interview-voice/VoiceButton";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { useAssistantPermission } from "../assistantPermission";
import ComposerToolbar from "./composer/ComposerToolbar";
import ContextChips from "./composer/ContextChips";
import PermissionConfirmModal from "./composer/PermissionConfirmModal";
import SkillChips from "./composer/SkillChips";
import { useContextLabels } from "./composer/useContextLabels";

/** 文档按扩展名区分图标：pdf 和 docx 混在一串标签里时，图标比文件名更好认。 */
function attachmentIcon(attachment: PendingAttachment) {
  if (attachment.kind !== "document") return <FileTextOutlined />;
  return attachment.name.toLowerCase().endsWith(".pdf") ? (
    <FilePdfOutlined />
  ) : (
    <FileWordOutlined />
  );
}

/** 输入框的 ref 类型从 antd 自己的组件上取，不深路径 import（见 AGENTS「Ant Design 使用规范」第 9 条）。 */
type ComposerTextAreaRef = GetRef<typeof Input.TextArea>;

interface Props {
  compact?: boolean;
  /** 当前会话 id；新会话还没有 id（数据权限覆盖按会话存本机）。 */
  conversationId?: number | null;
  content: string;
  attachments: PendingAttachment[];
  sending: boolean;
  attachmentReads: number;
  jobId: number | undefined;
  /** T29：已选简历的复合引用（`internal:12` / `external:7`）。 */
  resumeRef: string | undefined;
  webSearch: boolean;
  reasoningEffort: ReasoningEffort;
  /** 技能库（菜单候选）：新建/导入技能后由页面重挂载刷新。 */
  skillCatalog: AssistantSkill[];
  /** 本对话已启用（草稿态 = 暂存）的技能，按启用顺序。 */
  selectedSkills: ConversationSkillItem[];
  /** 本对话的技能注入预算；草稿态为 null。 */
  skillBudget: ConversationSkillBudget | null;
  skillsLoaded: boolean;
  togglingSkillId: number | null;
  onContentChange: (value: string) => void;
  onJobChange: (value: number | undefined) => void;
  onResumeRefChange: (value: string | undefined) => void;
  onWebSearchChange: (value: boolean) => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  onToggleSkill: (skill: AssistantSkill, enabled: boolean) => void;
  onManageSkills: () => void;
  onAddAttachment: (file: File) => void;
  onRemoveAttachment: (id: number) => void;
  /** 当前引用的消息（右键消息「引用这条继续问」后出现）。 */
  quoted: AssistantQuotedMessage | null;
  onClearQuote: () => void;
  /** 上下文用量（需求 #6）：`null` = 还没拿到，chip 显示「—」。 */
  contextUsage?: ContextUsage | null;
  /** 弹层里改了上下文窗口后的本地重算。 */
  onContextWindowSaved?: (windowTokens: number) => void;
  /** 压缩或还原成功后让上层重取用量（#10）。 */
  onContextChanged?: () => void;
  onSend: (refs?: AssistantMessageReferences) => void;
  onStop: () => void;
  /**
   * 挂载后把焦点送进输入框（投投浮窗打开时用）。
   *
   * 为什么是「挂载后聚焦」而不是 `autoFocus`：浮窗里的 `AssistantPage` 走
   * `Suspense` + 懒加载，会话历史也可能还在取，textarea 会晚于卡片挂载；裸
   * `autoFocus` 只在元素首次插入时生效一次，晚挂载就完全落空。
   */
  autoFocusOnMount?: boolean;
}

export default function AssistantComposer({
  compact = false,
  conversationId,
  content,
  attachments,
  sending,
  attachmentReads,
  jobId,
  resumeRef,
  webSearch,
  reasoningEffort,
  skillCatalog,
  selectedSkills,
  skillBudget,
  skillsLoaded,
  togglingSkillId,
  onContentChange,
  onJobChange,
  onResumeRefChange,
  onWebSearchChange,
  onReasoningEffortChange,
  onToggleSkill,
  onManageSkills,
  onAddAttachment,
  onRemoveAttachment,
  quoted,
  onClearQuote,
  contextUsage = null,
  onContextWindowSaved,
  onContextChanged,
  onSend,
  onStop,
  autoFocusOnMount = false,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后输入区不重渲染。
  useLocale();
  const { message } = App.useApp();
  // 数据权限（D19/D20）：默认「跟随全局」，有会话时按会话覆盖。
  const permission = useAssistantPermission(conversationId ?? null);
  // 岗位/简历的展示口径与「本轮引用」快照（F36 一处实现）：发送时随消息带上，
  // 发送后页面清空选择，乐观气泡仍能显示这段引用。
  const { jobLabel, resumeLabel, refs: contextRefs } = useContextLabels(jobId, resumeRef);
  const textAreaRef = useRef<ComposerTextAreaRef | null>(null);
  // 一次打开只聚焦一次：`sending` 变化会让下面的 effect 重跑，不能变成"每轮回复结束
  // 都把焦点从用户手里抢回输入框"。
  const autoFocusDoneRef = useRef(false);
  useEffect(() => {
    if (!autoFocusOnMount || autoFocusDoneRef.current) return;
    // 无论最终聚没聚上，这次请求都算处理完：发送中不抢焦点，也不排队等发送结束。
    autoFocusDoneRef.current = true;
    if (sending) return;
    const node = textAreaRef.current;
    if (node === null) return;
    try {
      node.focus();
    } catch {
      // 聚焦失败静默：打开浮窗不能因为聚焦不了而报错（例如元素已在卸载途中）。
    }
  }, [autoFocusOnMount, sending]);

  /**
   * 直接往输入框里粘贴截图。
   *
   * 只有剪贴板里**真的有图片**时才拦：粘贴文本、链接、代码时必须原样放行，
   * 否则换行会被吃掉（`clipboardImages` 对非图片返回空数组，这里直接 return）。
   * 截图粘贴是加速器，「附件」按钮才是键盘、读屏和手机上的正式入口。
   */
  const handlePaste = (event: React.ClipboardEvent<HTMLTextAreaElement>) => {
    if (sending) return;
    const pasted = clipboardImages(event.clipboardData);
    if (pasted.length === 0) return;
    event.preventDefault();
    // 额度在 addAttachment 里同步预占，连着粘几张也不会超额。
    pasted.forEach((file) => onAddAttachment(file));
  };

  return (
    <FileDropZone
      accept={ASSISTANT_ACCEPT}
      disabled={
        compact || sending || attachmentReads > 0 || attachments.length >= MAX_ATTACHMENT_COUNT
      }
      hint={t("assistantComposer.dropHint")}
      onFiles={(dropped) => dropped.forEach((file) => onAddAttachment(file))}
      onRejected={(count) => message.warning(t("assistantComposer.toast.rejectedCount", { count }))}
    >
      <div className="assistant-composer">
        {/* 关联上下文 chip 行（R06-A）：只在已选时出现，入口在工具栏的 `+` 面板里。 */}
        {!compact && (
          <ContextChips
            jobId={jobId}
            resumeRef={resumeRef}
            jobLabel={jobLabel}
            resumeLabel={resumeLabel}
            onJobChange={onJobChange}
            onResumeRefChange={onResumeRefChange}
          />
        )}
        {/* 对话技能 chip 行（T14）：只在已选时出现（空态入口同样收进 `+`）。 */}
        <SkillChips
          catalog={skillCatalog}
          selected={selectedSkills}
          budget={skillBudget}
          togglingId={togglingSkillId}
          disabled={sending}
          onToggle={onToggleSkill}
        />
        {quoted ? (
          <div className="assistant-quote-chip">
            <span className="assistant-quote-chip-label">
              {quoted.role === "user"
                ? t("assistantComposer.quote.user")
                : t("assistantComposer.quote.assistant")}
            </span>
            <span className="assistant-quote-chip-text">{quoted.excerpt}</span>
            <Button
              type="text"
              size="small"
              aria-label={t("assistantComposer.aria.clearQuote")}
              className="assistant-quote-chip-close"
              icon={<CloseOutlined />}
              onClick={onClearQuote}
            />
          </div>
        ) : null}
        {!compact && attachments.length > 0 && (
          <Alert type="info" showIcon title={t("assistantComposer.notice.attachments")} />
        )}
        {attachments.length > 0 && (
          <div className="assistant-composer-attachments">
            {attachments.map((attachment) =>
              attachment.kind === "image" && canPreviewImage(attachment.mime_type) ? (
                <div key={attachment.id} className="assistant-composer-image-item">
                  <Image
                    src={attachment.data}
                    alt={attachment.name}
                    className="assistant-message-image"
                  />
                  <Button
                    type="text"
                    size="small"
                    danger
                    aria-label={t("assistantComposer.aria.remove", { name: attachment.name })}
                    onClick={() => onRemoveAttachment(attachment.id)}
                  >
                    {t("assistantComposer.action.remove")}
                  </Button>
                </div>
              ) : (
                // 文件名没有长度上限，标签又不换行；截断但把全名放进悬停提示。
                <Tooltip key={attachment.id} title={attachment.name}>
                  <Tag
                    className="assistant-attachment-tag"
                    icon={attachmentIcon(attachment)}
                    closable={!sending}
                    onClose={() => onRemoveAttachment(attachment.id)}
                  >
                    {attachment.name}
                  </Tag>
                </Tooltip>
              ),
            )}
          </div>
        )}
        {/* #12：常驻琥珀横幅已删除，档位可见性由输入区那颗 chip 承担；
            高风险档位改为选中时弹一次性确认卡（挂在组件尾部）。 */}
        <Input.TextArea
          ref={textAreaRef}
          value={content}
          autoSize={{ minRows: compact ? 2 : 3, maxRows: 8 }}
          disabled={sending}
          placeholder={t("assistantComposer.placeholder.content")}
          onPaste={handlePaste}
          onChange={(event) => onContentChange(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              onSend(contextRefs);
            }
          }}
        />
        <ComposerToolbar
          compact={compact}
          content={content}
          sending={sending}
          attachmentsCount={attachments.length}
          attachmentReads={attachmentReads}
          webSearch={webSearch}
          reasoningEffort={reasoningEffort}
          permission={{
            conversationId: conversationId ?? null,
            choice: permission.choice,
            effectiveLevel: permission.effectiveLevel,
            editable: permission.editable,
            onChange: permission.requestChoice,
          }}
          // 左侧「+」面板（R06-A）：附件 / 关联岗位 / 关联简历 / 技能 四组一个入口。
          addMenu={{
            compact,
            sending,
            attachmentReads,
            attachmentsCount: attachments.length,
            jobId,
            resumeRef,
            skillCatalog,
            selectedSkills,
            skillBudget,
            skillsLoaded,
            togglingSkillId,
            onJobChange,
            onResumeRefChange,
            onToggleSkill,
            onManageSkills,
            onAddAttachment,
          }}
          // 语音槽位（T12）：录音 → 转写 → 追加到已输入文字后面；只写 state，绝不自动发送。
          // R06-C：它渲染在右侧组里（ReasoningChip → 语音 → 发送），仍由语音线填。
          voiceSlot={
            <div className="composer-voice-slot">
              <VoiceButton
                maxSeconds={180}
                disabled={sending}
                onTranscribed={(text) => onContentChange(appendTranscript(content, text))}
              />
            </div>
          }
          onWebSearchChange={onWebSearchChange}
          onReasoningEffortChange={onReasoningEffortChange}
          contextUsage={contextUsage}
          onContextWindowSaved={onContextWindowSaved}
          contextConversationId={conversationId ?? null}
          onContextChanged={onContextChanged}
          onSend={() => onSend(contextRefs)}
          onStop={onStop}
        />
      </div>
      {/* #12 一次性确认卡：只在 needsConfirm 命中时打开；卡片开着时发送仍用旧档位。 */}
      <PermissionConfirmModal
        level={permission.pendingLevel}
        onConfirm={permission.confirmPending}
        onCancel={permission.cancelPending}
      />
    </FileDropZone>
  );
}
