// SPDX-License-Identifier: Apache-2.0
/**
 * 消息操作条（#13A）：复制 / 引用 / 重新生成 / 删除。
 *
 * 位置在气泡底部，hover 或 focus-within 显示，≤767px 触屏常显（CSS 控制，见
 * assistant-content.css 的 .assistant-message-actions）。右键菜单保留作快捷方式。
 *
 * 复制取 `message.content` 全文——不是折叠后的可见部分（#13B：折叠只影响显示）。
 * 「重新生成」只渲染在最后一条助手回答上；生成中置灰，避免两条流同时写同一会话。
 */
import { CommentOutlined, CopyOutlined, DeleteOutlined, RedoOutlined } from "@ant-design/icons";
import { App, Button, Popconfirm } from "antd";
import type { AssistantMessage } from "../../../types";
import AssistantSaveKnowledgeButton from "./AssistantSaveKnowledgeButton";
import { copyText } from "../../../utils/clipboard";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";

interface Props {
  message: AssistantMessage;
  /** 只有最后一条助手回答显示「重新生成」（历史回答重跑会打乱后面的上下文）。 */
  showRegenerate: boolean;
  /** 生成中：重新生成按钮 disabled。 */
  regenerateDisabled: boolean;
  onQuote: (message: AssistantMessage) => void;
  onDelete: (message: AssistantMessage) => void;
  onRegenerate?: (message: AssistantMessage) => void;
}

export default function AssistantMessageActions({
  message,
  showRegenerate,
  regenerateDisabled,
  onQuote,
  onDelete,
  onRegenerate,
}: Props) {
  useLocale();
  const { message: messageApi } = App.useApp();

  const handleCopy = async () => {
    const copied = await copyText(message.content);
    if (copied) messageApi.success(t("assistantUi.messageList.toast.copied"));
    else messageApi.warning(t("assistantUi.messageList.toast.copyFailed"));
  };

  return (
    <div
      className="assistant-message-actions"
      role="group"
      aria-label={t("assistantUi.messageActions.aria")}
    >
      <Button type="text" size="small" icon={<CopyOutlined />} onClick={() => void handleCopy()}>
        {t("assistantUi.messageActions.copy")}
      </Button>
      <Button type="text" size="small" icon={<CommentOutlined />} onClick={() => onQuote(message)}>
        {t("assistantUi.messageActions.quote")}
      </Button>
      {/* #29B：助手长回答回流入口（用户消息没有可沉淀的回答正文）。 */}
      {message.role === "assistant" && message.content.trim() ? (
        <AssistantSaveKnowledgeButton message={message} />
      ) : null}
      {showRegenerate && onRegenerate ? (
        <Button
          type="text"
          size="small"
          icon={<RedoOutlined />}
          disabled={regenerateDisabled || undefined}
          onClick={() => onRegenerate(message)}
        >
          {t("assistantUi.messageActions.regenerate")}
        </Button>
      ) : null}
      <Popconfirm
        title={t("assistantUi.messageList.confirm.delete")}
        // 确认按钮写清"删哪条"，不能只写「删除」——和触发按钮同名会分不清点的是哪个。
        okText={t("assistantUi.messageList.action.delete")}
        cancelText={t("common.action.cancel")}
        onConfirm={() => onDelete(message)}
      >
        <Button type="text" size="small" danger icon={<DeleteOutlined />}>
          {t("assistantUi.messageActions.delete")}
        </Button>
      </Popconfirm>
    </div>
  );
}
