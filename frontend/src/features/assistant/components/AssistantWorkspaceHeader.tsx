// SPDX-License-Identifier: Apache-2.0
/** 助手工作区页头：标题、说明与浮窗的历史按钮，多选工具条紧随其后。 */

import { HistoryOutlined } from "@ant-design/icons";
import { Button, Space, Typography } from "antd";
import AssistantSelectBar from "./AssistantSelectBar";

interface Props {
  compact: boolean;
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
          {compact && (
            <Button
              type="text"
              icon={<HistoryOutlined />}
              aria-label="查看投投历史"
              aria-expanded={historyOpen}
              onClick={onToggleHistory}
            >
              历史
            </Button>
          )}
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
