// SPDX-License-Identifier: Apache-2.0
/**
 * 助手工作区页头：标题、视角下拉、说明与浮窗的历史按钮，多选工具条紧随其后。
 *
 * 视角（T26）从正文首行搬到这里：它是**会话属性**，与"这条消息带哪些技能"无关，
 * 放在标题右侧才符合"整段对话的一个模式"。搬走后正文首行少了一排 Segmented，
 * 标题与消息的垂直节奏也不再被 16px 内缩打断。
 */

import { HistoryOutlined } from "@ant-design/icons";
import { Button, Space, Switch, Tooltip, Typography } from "antd";
import { t } from "../../../i18n";
import { useLocale } from "../../../i18n/i18nContext";
import PersonaSwitcher from "../personas/PersonaSwitcher";
import AssistantSelectBar from "./AssistantSelectBar";

interface Props {
  compact: boolean;
  /**
   * 平板档（768–1092）把历史列表收进抽屉时，页头要有入口。
   * 浮窗（`compact`）本来就有这颗按钮，两者共用一个渲染分支。
   */
  showHistoryButton?: boolean;
  historyOpen: boolean;
  onToggleHistory: () => void;
  selecting: boolean;
  selectedIds: ReadonlySet<number>;
  removeSelected: () => Promise<void>;
  exitSelecting: () => void;
  title: string;
  /**
   * 当前会话 id（`null` = 草稿态）。视角下拉要挂在这一段会话上，
   * 所以页头必须拿到它——这是 T26 新增的唯一入参。
   */
  conversationId?: number | null;
  /**
   * 临时对话（F34）：会话标题区的「本次不记忆」开关。
   * `undefined` = 草稿态（还没有会话），此时不渲染开关——没有可切换的对象。
   */
  memoryOff?: boolean;
  onMemoryOffChange?: (value: boolean) => void;
}

export default function AssistantWorkspaceHeader({
  compact,
  showHistoryButton = false,
  historyOpen,
  onToggleHistory,
  selecting,
  selectedIds,
  removeSelected,
  exitSelecting,
  title,
  conversationId = null,
  memoryOff,
  onMemoryOffChange,
}: Props) {
  useLocale();
  return (
    <>
      <header className="assistant-header">
        <div className="assistant-header-titles">
          <Typography.Title level={3}>{title}</Typography.Title>
          <Typography.Text type="secondary">{t("responsive.assistant.headerNote")}</Typography.Text>
        </div>
        {/* 多选入口已收进消息右键菜单（R8）；浮窗这里只剩历史按钮。
            header 是 space-between 布局，只剩两个子元素时操作全部靠右。 */}
        <Space size={4} className="assistant-header-actions">
          {/* 视角：整段会话的模式，放在标题右侧；草稿态禁用并给 tooltip。 */}
          <PersonaSwitcher conversationId={conversationId} />
          {memoryOff !== undefined && onMemoryOffChange ? (
            <Tooltip title={t("assistantUi.memory.offTooltip")} placement="bottom">
              <span className="assistant-memory-toggle">
                <Typography.Text type="secondary">{t("assistantUi.memory.off")}</Typography.Text>
                <Switch
                  size="small"
                  checked={memoryOff}
                  onChange={onMemoryOffChange}
                  aria-label={t("assistantUi.memory.off")}
                />
              </span>
            </Tooltip>
          ) : null}
          {compact || showHistoryButton ? (
            <Button
              type="text"
              icon={<HistoryOutlined />}
              aria-label={t("responsive.assistant.aria.history")}
              aria-expanded={historyOpen}
              onClick={onToggleHistory}
            >
              {compact ? t("responsive.assistant.historyShort") : t("responsive.assistant.history")}
            </Button>
          ) : null}
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
    </>
  );
}
