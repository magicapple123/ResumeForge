// SPDX-License-Identifier: Apache-2.0
/** 会话列表的单行渲染（从 ConversationSidebar 拆出，压 500 行预算）。
 *
 * 只负责一行的外观与行内交互：标题/元信息、重命名输入框、批量选择勾选框、
 * 三点操作菜单。操作清单本身由父组件生成后传入（保持"一处逻辑一份实现"）。
 */
import { MoreOutlined, SaveOutlined } from "@ant-design/icons";
import { Button, Checkbox, Input, Popconfirm, Popover, Tooltip, Typography } from "antd";
import type { RowActionItem } from "../../../components/common/RowActions";
import { ListyItem } from "../../../components/common/ListyItem";
import type { AssistantConversationBrief } from "../../../types";
import { formatDateTime } from "../../../utils/format";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import { ConversationTitle } from "./AssistantMessageContent";

interface ConversationSidebarRowProps {
  conversation: AssistantConversationBrief;
  activeId: number | null;
  /** 批量选择模式：行动作区换成勾选框。 */
  selecting: boolean;
  selected: boolean;
  onToggleSelected: () => void;
  /** 该行的完整操作清单（三点菜单与整行右键共用父组件那一份）。 */
  actions: RowActionItem[];
  /** 三点菜单是否展开。 */
  menuOpen: boolean;
  onMenuOpenChange: (open: boolean) => void;
  editing: boolean;
  editingTitle: string;
  onEditingTitleChange: (value: string) => void;
  /** 保存重命名（Enter 与对勾按钮共用）。 */
  onFinishEditing: () => void;
  /** 行点击：选择模式下切换勾选，否则打开会话。 */
  onSelect: () => void;
}

export default function ConversationSidebarRow({
  conversation,
  activeId,
  selecting,
  selected,
  onToggleSelected,
  actions,
  menuOpen,
  onMenuOpenChange,
  editing,
  editingTitle,
  onEditingTitleChange,
  onFinishEditing,
  onSelect,
}: ConversationSidebarRowProps) {
  // 本组件用模块级 t()：必须订阅语言变化。
  useLocale();
  return (
    <ListyItem
      className={conversation.id === activeId ? "is-active" : ""}
      actions={
        selecting
          ? [
              // 多选模式：行动作区换成勾选框，点行（标题）也切换勾选。
              <Checkbox
                key="pick"
                aria-label={t("assistantUi.sidebar.aria.selectConversation", {
                  title: conversation.title,
                })}
                checked={selected}
                onChange={onToggleSelected}
              />,
            ]
          : [
              <Popover
                key="more"
                trigger="click"
                placement="bottomRight"
                open={menuOpen}
                onOpenChange={onMenuOpenChange}
                content={
                  <div className="assistant-conversation-actions-menu">
                    {actions.map((item) =>
                      item.confirm ? (
                        <Popconfirm
                          key={item.key}
                          title={item.confirm}
                          // 这个「···」菜单是手写的 Popover（不走 useRowActionMenu），
                          // 所以正文要在这里显式传，否则右键菜单有后果段、这里没有。
                          description={item.confirmBody}
                          onConfirm={() => {
                            onMenuOpenChange(false);
                            item.onClick?.();
                          }}
                        >
                          <Button type="text" size="small" danger={item.danger} icon={item.icon}>
                            {item.label}
                          </Button>
                        </Popconfirm>
                      ) : (
                        <Button
                          key={item.key}
                          type="text"
                          size="small"
                          danger={item.danger}
                          icon={item.icon}
                          onClick={item.onClick}
                        >
                          {item.label}
                        </Button>
                      ),
                    )}
                  </div>
                }
              >
                <Tooltip title={t("assistantUi.sidebar.moreTooltip")}>
                  <Button
                    type="text"
                    size="small"
                    aria-label={t("assistantUi.sidebar.moreAria")}
                    className="assistant-conversation-more-button"
                    icon={<MoreOutlined />}
                  />
                </Tooltip>
              </Popover>,
            ]
      }
    >
      {editing ? (
        <Input
          size="small"
          value={editingTitle}
          autoFocus
          maxLength={128}
          suffix={
            <Tooltip title={t("assistantUi.sidebar.saveTitleTooltip")}>
              <Button
                type="text"
                size="small"
                aria-label={t("assistantUi.sidebar.saveTitleAria")}
                icon={<SaveOutlined />}
                onClick={onFinishEditing}
              />
            </Tooltip>
          }
          onChange={(event) => onEditingTitleChange(event.target.value)}
          onPressEnter={onFinishEditing}
        />
      ) : (
        <div className="assistant-conversation-item">
          <ConversationTitle
            title={conversation.title}
            pinned={conversation.pinned}
            favorite={conversation.favorite}
            onSelect={onSelect}
          />
          <Typography.Text type="secondary" className="assistant-conversation-meta">
            {conversation.group_name ? `${conversation.group_name} · ` : ""}
            {t("assistantUi.sidebar.messageCount", {
              count: conversation.message_count,
            })}
            {" · "}
            {formatDateTime(conversation.updated_at)}
            {conversation.memory_off ? (
              <Tooltip title={t("assistantUi.memory.offBadge")}>
                {/* 文字胶囊而不是眼睛：同页页头「视角」用的是睁眼图标，两个眼睛两种含义会混（I-32）。
                    节点本身已是文字，不再挂 role="img"/aria-label，否则读屏会读两遍。 */}
                <span className="assistant-conversation-memory-off">
                  {t("assistantUi.memory.offShort")}
                </span>
              </Tooltip>
            ) : null}
          </Typography.Text>
        </div>
      )}
    </ListyItem>
  );
}
