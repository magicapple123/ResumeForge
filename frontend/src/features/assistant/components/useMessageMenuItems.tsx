// SPDX-License-Identifier: Apache-2.0
/**
 * 单条消息的操作项（F37）：右键菜单与窄档「⋯」共用同一份列表。
 *
 * 以前还有一条 hover 才出现的行内操作条，同一批动作两处渲染，菜单却只覆盖三项——
 * 「重新生成」（#13A）与「存为知识」（#29B）因此被锁在操作条里。现在只剩这一处定义：
 * 桌面右键、≤767px 的「⋯」下拉都读它，少一项就是两处都少。
 *
 * 顺序固定（验收要求）：引用 → 复制 → 存为知识 → 重新生成 → 批量选择 → 分隔线 → 删除。
 * 「存为知识」只在助手消息且有正文时出现（用户消息没有可沉淀的回答）；
 * 「重新生成」只在最后一条助手回答上出现，生成期间置灰。
 */
import {
  CheckSquareOutlined,
  CommentOutlined,
  CopyOutlined,
  DeleteOutlined,
  RedoOutlined,
  SaveOutlined,
} from "@ant-design/icons";
import { App } from "antd";
import type { RowMenuItem } from "../../../components/common/RowActions";
import { copyText } from "../../../utils/clipboard";
import type { AssistantMessage } from "../../../types";
import { t } from "../../../i18n";

interface Options {
  message: AssistantMessage;
  /** 只有最后一条助手回答为真（历史回答重跑会打乱后面的上下文）。 */
  showRegenerate: boolean;
  /** 生成中：重新生成置灰，避免两条流同时写同一会话。 */
  regenerateDisabled: boolean;
  onQuote: (message: AssistantMessage) => void;
  onDelete: (message: AssistantMessage) => void;
  onRegenerate?: (message: AssistantMessage) => void;
  onEnterSelecting: () => void;
  /** 打开「存为知识」弹窗；不传表示这条消息不提供该动作。 */
  onSaveKnowledge?: () => void;
}

export function useMessageMenuItems({
  message,
  showRegenerate,
  regenerateDisabled,
  onQuote,
  onDelete,
  onRegenerate,
  onEnterSelecting,
  onSaveKnowledge,
}: Options): RowMenuItem[] {
  const { message: toast } = App.useApp();

  const items: RowMenuItem[] = [
    {
      key: "quote",
      label: t("assistantUi.messageActions.quote"),
      icon: <CommentOutlined />,
      onClick: () => onQuote(message),
    },
    {
      key: "copy",
      label: t("assistantUi.messageActions.copy"),
      icon: <CopyOutlined />,
      onClick: () => {
        // 复制取全文——不是折叠后的可见部分（#13B：折叠只影响显示）。
        void copyText(message.content).then((ok) =>
          ok
            ? toast.success(t("assistantUi.messageList.toast.copied"))
            : toast.warning(t("assistantUi.messageList.toast.copyFailed")),
        );
      },
    },
  ];
  if (onSaveKnowledge) {
    items.push({
      key: "save_knowledge",
      label: t("assistantUi.saveKnowledge.button"),
      icon: <SaveOutlined />,
      onClick: onSaveKnowledge,
    });
  }
  if (showRegenerate && onRegenerate) {
    items.push({
      key: "regenerate",
      label: t("assistantUi.messageActions.regenerate"),
      icon: <RedoOutlined />,
      disabled: regenerateDisabled || undefined,
      onClick: () => onRegenerate(message),
    });
  }
  items.push(
    {
      key: "batch_select",
      label: t("common.action.batchSelect"),
      icon: <CheckSquareOutlined />,
      onClick: onEnterSelecting,
    },
    { key: "divider", type: "divider" },
    {
      key: "delete",
      label: t("assistantUi.messageActions.delete"),
      icon: <DeleteOutlined />,
      danger: true,
      // 删除不可撤销（不进回收站）：三段式确认写清后果，再执行。
      confirm: t("assistantUi.messageList.confirm.delete"),
      confirmBody: t("common.note.hardDelete"),
      confirmOkText: t("assistantUi.messageList.action.delete"),
      confirmCancelText: t("common.action.cancel"),
      onClick: () => onDelete(message),
    },
  );
  return items;
}
