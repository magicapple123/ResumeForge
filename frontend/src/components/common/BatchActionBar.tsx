/** 批量选择模式的操作条：已选计数 + 调用方操作 + 退出多选。 */
import { Button, Space, Typography } from "antd";
import type { ReactNode } from "react";

interface Props {
  count: number;
  /** 操作区：通常是「删除所选」等危险按钮（由调用方给确认）。 */
  children?: ReactNode;
  onExit: () => void;
}

export default function BatchActionBar({ count, children, onExit }: Props) {
  return (
    <div
      className="batch-action-bar"
      role="toolbar"
      aria-label="批量操作"
      style={{ marginBottom: 12 }}
    >
      <Space size={12} wrap>
        <Typography.Text strong>已选 {count} 项</Typography.Text>
        {children}
        <Button size="small" onClick={onExit}>
          退出多选
        </Button>
      </Space>
    </div>
  );
}
