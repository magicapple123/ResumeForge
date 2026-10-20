// SPDX-License-Identifier: Apache-2.0
/**
 * 页边距控件（T5）：从导出面板搬进预览的版式栏。
 *
 * 为什么搬家：页边距决定的是「眼前这份简历长什么样」，不是「导出成什么文件」。把它放在
 * 导出面板里，用户必须先开面板才能调版面，而且调完面板一关就看不到效果。搬过来之后
 * 与行距/字号并列，改完立刻重渲染。
 *
 * 取值范围与落点只有一份实现：`utils/pagePadding.ts`（`MIN/MAX` 与后端 FORMAT_FIELDS
 * 逐字一致，`clampPagePadding` 负责收口）。这里只管交互，不重复定义常量。
 */
import { UndoOutlined } from "@ant-design/icons";
import { Button, InputNumber, Space, Tooltip, Typography } from "antd";
import { MAX_PAGE_PADDING, MIN_PAGE_PADDING, clampPagePadding } from "../../utils/pagePadding";

interface Props {
  /** 当前写入的页边距（mm）；`null` = 没设过覆盖，随模板。 */
  value: number | null;
  disabled?: boolean;
  /** 传数值 = 写入覆盖；传 `null` = 删掉覆盖（回到随模板）。 */
  onChange: (pagePadding: number | null) => void;
  compact?: boolean;
}

export default function PagePaddingControl({
  value,
  disabled = false,
  onChange,
  compact = false,
}: Props) {
  return (
    <Space size={6}>
      {!compact && <Typography.Text type="secondary">页边距</Typography.Text>}
      <InputNumber
        size="small"
        min={MIN_PAGE_PADDING}
        max={MAX_PAGE_PADDING}
        step={1}
        style={{ width: 84 }}
        // 没有覆盖时留空并给占位文案：显示一个"看起来已设置"的数字会让人以为
        // 那个值被写进了这份简历。
        placeholder="随模板"
        aria-label="页边距"
        value={value ?? undefined}
        disabled={disabled}
        onChange={(next) => {
          if (typeof next === "number") {
            onChange(clampPagePadding(next));
            return;
          }
          // 清空输入框 = 回到随模板（与复位按钮同一语义）。
          if (next === null) onChange(null);
        }}
      />
      <Typography.Text type="secondary" style={{ fontSize: 12 }}>
        mm
      </Typography.Text>
      {value === null && (
        <Typography.Text type="secondary" style={{ fontSize: 12 }}>
          随模板
        </Typography.Text>
      )}
      <Tooltip title="恢复模板默认页边距">
        <Button
          size="small"
          type="text"
          icon={<UndoOutlined />}
          disabled={disabled || value === null}
          aria-label="恢复默认页边距"
          onClick={() => onChange(null)}
        />
      </Tooltip>
    </Space>
  );
}
