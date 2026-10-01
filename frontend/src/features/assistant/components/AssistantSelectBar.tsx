/** 助手消息多选工具条。 */

import { DeleteOutlined, CloseOutlined } from "@ant-design/icons";
import { App, Button, Space, Typography } from "antd";

interface Props {
  disabled: boolean;
  onDelete: () => Promise<void>;
  onExit: () => void;
  selectedCount: number;
}

export default function AssistantSelectBar({ disabled, onDelete, onExit, selectedCount }: Props) {
  const { modal } = App.useApp();
  return (
    <div className="assistant-select-bar">
      <Typography.Text type="secondary">已选 {selectedCount} 条</Typography.Text>
      <Space size={8}>
        <Button
          danger
          size="small"
          icon={<DeleteOutlined />}
          disabled={disabled}
          onClick={() =>
            modal.confirm({
              title: `删除选中的 ${selectedCount} 条消息？`,
              content: "删除后无法恢复。引用这些消息的提问仍会保留引用内容。",
              okText: "删除",
              okButtonProps: { danger: true },
              cancelText: "取消",
              onOk: onDelete,
            })
          }
        >
          删除所选
        </Button>
        <Button size="small" icon={<CloseOutlined />} onClick={onExit}>
          退出多选
        </Button>
      </Space>
    </div>
  );
}
