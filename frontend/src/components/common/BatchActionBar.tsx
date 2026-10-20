// SPDX-License-Identifier: Apache-2.0
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
  /** 勾选框不带「全选本页」文字（hover 由 title 提示含义）；简历中心等窄操作条用。 */
  pageSelectAllLabelHidden?: boolean;
  /** 操作区：通常是「删除所选」等危险按钮（由调用方给确认）。 */
  children?: ReactNode;
  onExit: () => void;
}

export default function BatchActionBar({
  count,
  pageSelectAll,
  pageSelectAllLabelHidden = false,
  children,
  onExit,
}: Props) {
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
            // 无文字版靠 aria-label 提供可达名（包在空 label 里的 input 不会回落到 title）。
            aria-label={pageSelectAllLabelHidden ? "全选本页" : undefined}
            title="全选本页"
            onChange={(event) => pageSelectAll.onToggle(event.target.checked)}
          >
            {pageSelectAllLabelHidden ? undefined : "全选本页"}
          </Checkbox>
        )}
        {children}
        {/* 默认尺寸（32px）：与各消费方传入的操作按钮（删除所选/批量删除等，均为默认
            尺寸）同一高度——此前 small 是全站批量工具条按钮不齐的唯一来源。 */}
        <Button onClick={onExit}>退出多选</Button>
      </Space>
    </div>
  );
}
