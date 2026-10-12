/** 批量选择模式的操作条：已选计数 + 「全选本页」(可选) + 调用方操作 + 退出多选。 */
import { Button, Checkbox, Space, Typography } from "antd";
import type { ReactNode } from "react";

export interface PageSelectAll {
  allSelected: boolean;
  someSelected: boolean;
  onToggle: (checked: boolean) => void;
  disabled?: boolean;
}

interface Props {
  count: number;
  /** 「全选本页」：卡片网格类列表传这个（表格类自带表头全选，不用传）。 */
  pageSelectAll?: PageSelectAll;
  /** 操作区：通常是「删除所选」等危险按钮（由调用方给确认）。 */
  children?: ReactNode;
  onExit: () => void;
}

export default function BatchActionBar({ count, pageSelectAll, children, onExit }: Props) {
  return (
    <div
      className="batch-action-bar"
      role="toolbar"
      aria-label="批量操作"
      style={{ marginBottom: 12 }}
    >
      <Space size={12} wrap>
        <Typography.Text strong>已选 {count} 项</Typography.Text>
        {pageSelectAll && (
          <Checkbox
            checked={pageSelectAll.allSelected}
            indeterminate={pageSelectAll.someSelected && !pageSelectAll.allSelected}
            disabled={pageSelectAll.disabled}
            onChange={(event) => pageSelectAll.onToggle(event.target.checked)}
          >
            全选本页
          </Checkbox>
        )}
        {children}
        <Button size="small" onClick={onExit}>
          退出多选
        </Button>
      </Space>
    </div>
  );
}
