// SPDX-License-Identifier: Apache-2.0
/** 求职助手消息输入、上下文选择、技能开关与附件预览。 */

import { useEffect, useState } from "react";
import { layer } from "../../../theme/tokens";
import {
  CloseOutlined,
  ExperimentOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileWordOutlined,
  PaperClipOutlined,
  QuestionCircleOutlined,
  SendOutlined,
  StopOutlined,
} from "@ant-design/icons";
import {
  Alert,
  App,
  Button,
  Checkbox,
  Dropdown,
  Image,
  Input,
  Select,
  Switch,
  Tag,
  Tooltip,
  Upload,
} from "antd";
import {
  ASSISTANT_ACCEPT,
  MAX_ATTACHMENT_COUNT,
  canPreviewImage,
  clipboardImages,
  type PendingAttachment,
} from "../assistantUtils";
import type { AssistantQuotedMessage, AssistantSkill } from "../../../types";
import {
  CUSTOM_EFFORT_OPTION,
  MAX_REASONING_EFFORT_CHARS,
  REASONING_EFFORT_OPTIONS,
  isValidReasoningEffort,
  type ReasoningEffort,
} from "../../../types/assistant";
import { useJobSearchSelect, useResumeSearchSelect } from "../../../hooks/remoteSearchOptions";
import FileDropZone from "../../../components/common/FileDropZone";
import { t } from "../../../i18n";
import { REASONING_EFFORT_LABEL_KEYS } from "../../../i18n/enum/assistant";
import { useLocale } from "../../../i18n/i18nContext";

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
  content: string;
  attachments: PendingAttachment[];
  sending: boolean;
  attachmentReads: number;
  jobId: number | undefined;
  resumeId: number | undefined;
  webSearch: boolean;
  reasoningEffort: ReasoningEffort;
  /** 全部技能（含停用的），用于在下拉里直接开关。 */
  skills: AssistantSkill[];
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
  content,
  attachments,
  sending,
  attachmentReads,
  jobId,
  resumeId,
  webSearch,
  reasoningEffort,
  skills,
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
  // 关联岗位 / 简历下拉改为远程搜索（P0-1）：不再由页面预拉"前 100 条"当全量。
  const jobSelect = useJobSearchSelect();
  const resumeSelect = useResumeSearchSelect();
  // 深链 / 页面侧带入的已选值保显示（P0-1）：按 id 回查补进候选。
  useEffect(() => {
    void jobSelect.ensure(jobId);
    // hook 的回调引用稳定，只跟随已选值变化。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [jobId]);
  useEffect(() => {
    void resumeSelect.ensure(resumeId);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [resumeId]);
  // 页面态下拉常驻可见：挂载即预拉第一页候选（compact 卡不显示上下文选择，跳过）。
  useEffect(() => {
    if (compact) return;
    void jobSelect.reload();
    void resumeSelect.reload();
    // hook 的回调引用稳定，只在挂载时执行一次。
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [compact]);
  const enabledSkills = skills.filter((skill) => skill.enabled);
  // 自定义档位是**界面态**（值本身仍然由页面受控）：从本地存回来的自定义值一打开就
  // 直接落在输入框里，而不是让下拉把它当未知值空着显示。
  const [customEffort, setCustomEffort] = useState(
    () => !REASONING_EFFORT_OPTIONS.some((option) => option.value === reasoningEffort),
  );

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
        {!compact && (
          <div className="assistant-context-controls">
            <div className="assistant-context-selects">
              <Select
                aria-label={t("assistantComposer.aria.jobSelect")}
                allowClear
                placeholder={t("assistantComposer.placeholder.job")}
                value={jobId}
                onChange={onJobChange}
                {...jobSelect.selectProps}
              />
              <Select
                aria-label={t("assistantComposer.aria.resumeSelect")}
                allowClear
                placeholder={t("assistantComposer.placeholder.resume")}
                value={resumeId}
                onChange={onResumeChange}
                {...resumeSelect.selectProps}
              />
            </div>
          </div>
        )}
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
        <div className="assistant-composer-actions">
          <div className="assistant-composer-utility">
            <Upload
              accept={ASSISTANT_ACCEPT}
              multiple
              showUploadList={false}
              disabled={
                sending || attachmentReads > 0 || attachments.length >= MAX_ATTACHMENT_COUNT
              }
              beforeUpload={(file) => {
                onAddAttachment(file as File);
                return Upload.LIST_IGNORE;
              }}
            >
              {/*
                compact 卡片里用短文案 + 限宽 + 显式抬层：
                - 卡片（3200）高于 antd Tooltip 默认的 1070，不抬层会被卡片盖住；
                  抬到卡片内弹层基准 layer.cardPopup（3310）才稳在卡片之上；
                - maxWidth 240 让长文案换行，贴近视口边缘时 autoAdjustOverflow 翻转，
                  Tooltip 不会水平溢出；保持挂 body（挂进卡片会被 overflow: hidden 裁掉）。
              */}
              <Tooltip
                title={
                  compact
                    ? t("assistantComposer.tooltip.attachCompact")
                    : t("assistantComposer.tooltip.attach")
                }
                placement="top"
                styles={compact ? { root: { maxWidth: 240, zIndex: layer.cardPopup } } : undefined}
              >
                <Button
                  aria-label={t("assistantComposer.aria.attach")}
                  icon={<PaperClipOutlined />}
                  loading={attachmentReads > 0}
                  // 选满时 Upload 自己会吞掉点击，但按钮还亮着——看起来能点却没反应。
                  // 把同一个条件写全，界面上才是"真的不能点"。
                  disabled={
                    sending || attachmentReads > 0 || attachments.length >= MAX_ATTACHMENT_COUNT
                  }
                >
                  {t("assistantComposer.action.attach")}
                </Button>
              </Tooltip>
            </Upload>
            {!compact && (
              <Dropdown
                trigger={["click"]}
                placement="topLeft"
                menu={{
                  // 用真实的 Checkbox 表达"已启用"：菜单自带的高亮在浅色主题下几乎看不出来，
                  // 用户会以为点击没生效。这里每项左侧都是可勾选的方框，点整行即切换。
                  items: [
                    {
                      key: "hint",
                      label: (
                        <span className="assistant-skill-menu-hint">
                          {t("assistantComposer.skills.hint")}
                        </span>
                      ),
                      disabled: true,
                    },
                    { type: "divider" as const },
                    ...skills.map((skill) => ({
                      key: String(skill.id),
                      label: (
                        <span className="assistant-skill-option">
                          <Checkbox
                            checked={skill.enabled}
                            disabled={togglingSkillId === skill.id}
                          />
                          <span className="assistant-skill-option-text">
                            <span className="assistant-skill-option-name">{skill.name}</span>
                            {skill.description ? (
                              <span className="assistant-skill-option-desc">
                                {skill.description}
                              </span>
                            ) : null}
                          </span>
                        </span>
                      ),
                      disabled: togglingSkillId === skill.id,
                    })),
                    { type: "divider" as const },
                    { key: "manage", label: t("assistantComposer.skills.manage") },
                  ],
                  onClick: ({ key }) => {
                    if (key === "manage") {
                      onManageSkills();
                      return;
                    }
                    const skill = skills.find((item) => String(item.id) === key);
                    if (skill) onToggleSkill(skill, !skill.enabled);
                  },
                }}
                disabled={sending}
              >
                <Tooltip title={t("assistantComposer.skills.toggleHint")}>
                  <Button
                    aria-label={t("assistantComposer.skills.label")}
                    icon={<ExperimentOutlined />}
                    loading={!skillsLoaded}
                    disabled={sending}
                  >
                    {enabledSkills.length > 0
                      ? t("assistantComposer.skills.count", { count: enabledSkills.length })
                      : t("assistantComposer.skills.label")}
                  </Button>
                </Tooltip>
              </Dropdown>
            )}
            <div className="assistant-context-toggles">
              <label className="assistant-context-toggle">
                <Switch size="small" checked={webSearch} onChange={onWebSearchChange} />
                <span>{t("assistantComposer.toggle.webSearch")}</span>
              </label>
              {/* 带文字标签：只放一个「默认」下拉，用户看不出这是在调什么（截图反馈）。
                  说明挂在文字旁的问号图标上——此前整块套 Tooltip，悬停「思考强度」四个字
                  就弹出一大条提示，太重；文字标签本身不再触发。 */}
              <span className="assistant-reasoning-control">
                <span className="assistant-reasoning-label">
                  {t("assistantComposer.effort.label")}
                </span>
                <Tooltip title={t("assistantComposer.effort.hint")}>
                  <QuestionCircleOutlined
                    className="assistant-reasoning-help"
                    aria-label={t("assistantComposer.aria.effortHint")}
                  />
                </Tooltip>
                {customEffort ? (
                  <span className="assistant-reasoning-custom">
                    <Input
                      size="small"
                      className="assistant-reasoning-input"
                      value={reasoningEffort}
                      maxLength={MAX_REASONING_EFFORT_CHARS}
                      placeholder={t("assistantComposer.placeholder.customEffort")}
                      disabled={sending}
                      status={isValidReasoningEffort(reasoningEffort) ? undefined : "error"}
                      onChange={(event) => onReasoningEffortChange(event.target.value)}
                      onBlur={(event) => {
                        // 填了空就退回预设：留一个空输入框在工具条上只会让人以为是坏了。
                        // 看**输入框当前的值**而不是 prop——父组件不一定同步回填。
                        if (!event.target.value.trim()) {
                          setCustomEffort(false);
                          onReasoningEffortChange("");
                        }
                      }}
                      aria-label={t("assistantComposer.aria.customEffort")}
                    />
                    <Button
                      type="link"
                      size="small"
                      className="assistant-reasoning-back"
                      disabled={sending}
                      onClick={() => {
                        setCustomEffort(false);
                        onReasoningEffortChange("");
                      }}
                    >
                      {t("assistantComposer.action.usePreset")}
                    </Button>
                  </span>
                ) : (
                  <Select
                    size="small"
                    showSearch
                    optionFilterProp="label"
                    className="assistant-reasoning-select"
                    value={reasoningEffort}
                    options={[
                      ...REASONING_EFFORT_OPTIONS.map((option) => ({
                        value: option.value,
                        // 清单仍由 types 表提供（协议层），只有显示名走 enum 映射 + t()。
                        label: t(REASONING_EFFORT_LABEL_KEYS[option.value]),
                      })),
                      { value: CUSTOM_EFFORT_OPTION, label: t("assistantComposer.effort.custom") },
                    ]}
                    disabled={sending}
                    onChange={(value) => {
                      if (value === CUSTOM_EFFORT_OPTION) {
                        setCustomEffort(true);
                        onReasoningEffortChange("");
                        return;
                      }
                      onReasoningEffortChange(value);
                    }}
                    aria-label={t("assistantComposer.effort.label")}
                  />
                )}
              </span>
            </div>
          </div>
          {sending ? (
            <Button
              danger
              aria-label={t("assistantComposer.aria.stop")}
              icon={<StopOutlined />}
              onClick={onStop}
            >
              {t("assistantComposer.action.stop")}
            </Button>
          ) : (
            <Button
              type="primary"
              aria-label={t("assistantComposer.aria.send")}
              icon={<SendOutlined />}
              disabled={attachmentReads > 0 || (!content.trim() && attachments.length === 0)}
              onClick={onSend}
            >
              {t("assistantComposer.action.send")}
            </Button>
          )}
        </div>
      </div>
    </FileDropZone>
  );
}
