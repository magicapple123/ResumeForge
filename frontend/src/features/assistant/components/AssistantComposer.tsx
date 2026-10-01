/** 求职助手消息输入、上下文选择、技能开关与附件预览。 */

import { useState } from "react";
import {
  CloseOutlined,
  ExperimentOutlined,
  FilePdfOutlined,
  FileTextOutlined,
  FileWordOutlined,
  PaperClipOutlined,
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
import FileDropZone from "../../../components/common/FileDropZone";

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
  jobOptions: Array<{ value: number; label: string }>;
  resumeOptions: Array<{ value: number; label: string }>;
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
  jobOptions,
  resumeOptions,
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
  const { message } = App.useApp();
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
      hint="松开即可把文件加进对话"
      onFiles={(dropped) => dropped.forEach((file) => onAddAttachment(file))}
      onRejected={(count) => message.warning(`已忽略 ${count} 个不支持的附件`)}
    >
      <div className="assistant-composer">
        {!compact && (
          <div className="assistant-context-controls">
            <div className="assistant-context-selects">
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="关联岗位"
                value={jobId}
                options={jobOptions}
                onChange={onJobChange}
              />
              <Select
                allowClear
                showSearch
                optionFilterProp="label"
                placeholder="关联简历"
                value={resumeId}
                options={resumeOptions}
                onChange={onResumeChange}
              />
            </div>
          </div>
        )}
        {quoted ? (
          <div className="assistant-quote-chip">
            <span className="assistant-quote-chip-label">
              引用{quoted.role === "user" ? "你的消息" : "助手的回复"}
            </span>
            <span className="assistant-quote-chip-text">{quoted.excerpt}</span>
            <Button
              type="text"
              size="small"
              aria-label="取消引用"
              className="assistant-quote-chip-close"
              icon={<CloseOutlined />}
              onClick={onClearQuote}
            />
          </div>
        ) : null}
        {!compact && attachments.length > 0 && (
          <Alert type="info" showIcon message="已选择的附件或个人资料会发送给当前配置的模型服务" />
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
                    aria-label={`移除附件 ${attachment.name}`}
                    onClick={() => onRemoveAttachment(attachment.id)}
                  >
                    移除
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
          placeholder="输入求职、岗位、简历或项目经历相关问题"
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
              <Tooltip
                title={
                  compact
                    ? "添加图片或文档（也可以直接粘贴截图）；附件会发送给当前配置的模型服务"
                    : "添加文本、图片或文档附件（也可以直接粘贴截图）"
                }
              >
                <Button
                  aria-label="添加附件"
                  icon={<PaperClipOutlined />}
                  loading={attachmentReads > 0}
                  // 选满时 Upload 自己会吞掉点击，但按钮还亮着——看起来能点却没反应。
                  // 把同一个条件写全，界面上才是"真的不能点"。
                  disabled={
                    sending || attachmentReads > 0 || attachments.length >= MAX_ATTACHMENT_COUNT
                  }
                >
                  附件
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
                      label: <span className="assistant-skill-menu-hint">勾选要启用的技能</span>,
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
                    { key: "manage", label: "打开工作台" },
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
                <Tooltip title="点击开关助手技能；勾选表示已启用">
                  <Button
                    aria-label="技能"
                    icon={<ExperimentOutlined />}
                    loading={!skillsLoaded}
                    disabled={sending}
                  >
                    技能{enabledSkills.length > 0 ? `（${enabledSkills.length}）` : ""}
                  </Button>
                </Tooltip>
              </Dropdown>
            )}
            <div className="assistant-context-toggles">
              <label className="assistant-context-toggle">
                <Switch size="small" checked={webSearch} onChange={onWebSearchChange} />
                <span>联网搜索</span>
              </label>
              {/* 带文字标签：只放一个「默认」下拉，用户看不出这是在调什么（截图反馈）。 */}
              <Tooltip title="有思考模式的大模型可以在这里调推理强度。各家档位词汇不同（low/medium/high、minimal、xhigh、max…），选「自定义…」可以自己填；不支持该参数的服务商会忽略它，被拒绝时还会自动去掉重试一次">
                <span className="assistant-reasoning-control">
                  <span className="assistant-reasoning-label">思考强度</span>
                  {customEffort ? (
                    <span className="assistant-reasoning-custom">
                      <Input
                        size="small"
                        className="assistant-reasoning-input"
                        value={reasoningEffort}
                        maxLength={MAX_REASONING_EFFORT_CHARS}
                        placeholder="如 xhigh / max / 4096"
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
                        aria-label="自定义思考强度"
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
                        用预设
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
                        ...REASONING_EFFORT_OPTIONS,
                        { value: CUSTOM_EFFORT_OPTION, label: "自定义…" },
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
                      aria-label="思考强度"
                    />
                  )}
                </span>
              </Tooltip>
            </div>
          </div>
          {sending ? (
            <Button danger aria-label="停止生成" icon={<StopOutlined />} onClick={onStop}>
              停止
            </Button>
          ) : (
            <Button
              type="primary"
              aria-label="发送消息"
              icon={<SendOutlined />}
              disabled={attachmentReads > 0 || (!content.trim() && attachments.length === 0)}
              onClick={onSend}
            >
              发送
            </Button>
          )}
        </div>
      </div>
    </FileDropZone>
  );
}
