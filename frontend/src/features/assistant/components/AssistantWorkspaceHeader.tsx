// SPDX-License-Identifier: Apache-2.0
/** 助手工作区页头：标题、说明与浮窗的历史按钮，多选工具条紧随其后。 */

import { HistoryOutlined } from "@ant-design/icons";
import { Button, Space, Typography } from "antd";
import { t } from "../../../i18n";
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
}: Props) {
  return (
    <>
      <header className="assistant-header">
        <div className="assistant-header-titles">
          <Typography.Title level={3}>{title}</Typography.Title>
          <Typography.Text type="secondary">当前回复由「设置」中的模型配置提供。</Typography.Text>
        </div>
        {/* 多选入口已收进消息右键菜单（R8）；浮窗这里只剩历史按钮。
            header 是 space-between 布局，只剩两个子元素时操作全部靠右。 */}
        <Space size={4} className="assistant-header-actions">
          {compact || showHistoryButton ? (
            <Button
              type="text"
              icon={<HistoryOutlined />}
              aria-label="查看投投历史"
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
