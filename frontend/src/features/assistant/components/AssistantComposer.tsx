// SPDX-License-Identifier: Apache-2.0
/** 求职助手消息输入区：关联上下文 chip、引用、附件、数据权限提示与工具栏。 */

import {
  CloseOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileWordOutlined,
} from "@ant-design/icons";
import { Alert, App, Button, Image, Input, Tag, Tooltip } from "antd";
import {
  ASSISTANT_ACCEPT,
  MAX_ATTACHMENT_COUNT,
  canPreviewImage,
  clipboardImages,
  type PendingAttachment,
} from "../assistantUtils";
import type { AssistantQuotedMessage, AssistantSkill } from "../../../types";
import type { ReasoningEffort } from "../../../types/assistant";
import type {
  ConversationSkillBudget,
  ConversationSkillItem,
} from "../../../api/conversationSkills";
import FileDropZone from "../../../components/common/FileDropZone";
import { appendTranscript } from "../../../components/voice/appendTranscript";
import { VoiceButton } from "../../../components/voice/VoiceButton";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { useAssistantPermission } from "../assistantPermission";
import ComposerToolbar from "./composer/ComposerToolbar";
import ContextChips from "./composer/ContextChips";
import { PermissionNotice } from "./composer/PermissionMenu";
import SkillChips from "./composer/SkillChips";

/** 文档按扩展名区分图标：pdf 和 docx 混在一串标签里时，图标比文件名更好认。 */
function attachmentIcon(attachment: PendingAttachment) {
  if (attachment.kind !== "document") return <FileTextOutlined />;
  return attachment.name.toLowerCase().endsWith(".pdf") ? (
    <FilePdfOutlined />
  ) : (
    <FileWordOutlined />
  );
}

interface Props {
  compact?: boolean;
  /** 当前会话 id；新会话还没有 id（数据权限覆盖按会话存本机）。 */
  conversationId?: number | null;
  content: string;
  attachments: PendingAttachment[];
  sending: boolean;
  attachmentReads: number;
  jobId: number | undefined;
  resumeId: number | undefined;
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
  onResumeChange: (value: number | undefined) => void;
  onWebSearchChange: (value: boolean) => void;
  onReasoningEffortChange: (value: ReasoningEffort) => void;
  onToggleSkill: (skill: AssistantSkill, enabled: boolean) => void;
  onManageSkills: () => void;
  onAddAttachment: (file: File) => void;
  onRemoveAttachment: (id: number) => void;
  /** 当前引用的消息（右键消息「引用这条继续问」后出现）。 */
  quoted: AssistantQuotedMessage | null;
  onClearQuote: () => void;
  onSend: () => void;
  onStop: () => void;
}

export default function AssistantComposer({
  compact = false,
  conversationId,
  content,
  attachments,
  sending,
  attachmentReads,
  jobId,
  resumeId,
  webSearch,
  reasoningEffort,
  skillCatalog,
  selectedSkills,
  skillBudget,
  skillsLoaded,
  togglingSkillId,
  onContentChange,
  onJobChange,
  onResumeChange,
  onWebSearchChange,
  onReasoningEffortChange,
  onToggleSkill,
  onManageSkills,
  onAddAttachment,
  onRemoveAttachment,
  quoted,
  onClearQuote,
  onSend,
  onStop,
}: Props) {
  // 本组件用模块级 t()：必须订阅语言变化，否则切语言后输入区不重渲染。
  useLocale();
  const { message } = App.useApp();
  // 数据权限（D19/D20）：默认「跟随全局」，有会话时按会话覆盖。
  const permission = useAssistantPermission(conversationId ?? null);

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
            resumeId={resumeId}
            onJobChange={onJobChange}
            onResumeChange={onResumeChange}
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
        {/* 放宽读取 / 完全权限生效时的琥珀提示条（可关闭，换档位后重新出现）。 */}
        {permission.noticeVisible ? (
          <PermissionNotice level={permission.effectiveLevel} onClose={permission.dismissNotice} />
        ) : null}
        <Input.TextArea
          value={content}
          autoSize={{ minRows: compact ? 2 : 3, maxRows: 8 }}
          disabled={sending}
          placeholder={t("assistantComposer.placeholder.content")}
          onPaste={handlePaste}
          onChange={(event) => onContentChange(event.target.value)}
          onPressEnter={(event) => {
            if (!event.shiftKey) {
              event.preventDefault();
              onSend();
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
            resumeId,
            skillCatalog,
            selectedSkills,
            skillBudget,
            skillsLoaded,
            togglingSkillId,
            onJobChange,
            onResumeChange,
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
          onSend={onSend}
          onStop={onStop}
        />
      </div>
    </FileDropZone>
  );
}
